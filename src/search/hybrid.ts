import type { Client } from '@libsql/client';
import { embed } from './embeddings.js';
import type { EmbeddingProvider } from './provider.js';
import type { SearchResult } from './search.js';

/**
 * Weight given to the dense (semantic) side in the hybrid fusion. The lexical
 * (bm25) side gets `1 - DENSE_WEIGHT`. Empirically validated at 0.75: dense
 * leads, but lexical breaks ties and rescues exact-identifier / rare-term
 * queries the embedding model under-ranks. See [[cli#search#Hybrid Search]].
 */
export const DENSE_WEIGHT = 0.75;

/**
 * Baseline number of candidates to pull from each side before fusing. Scaled up
 * to the requested `limit` so a large `--limit` isn't silently capped by the
 * candidate pool (see [[src/search/hybrid.ts#hybridSearch]]).
 */
const CANDIDATES_PER_SIDE = 20;

/** A fused hybrid hit: section row data plus the combined relevance score. */
export type HybridResult = SearchResult;

/**
 * Min-max normalize a map of raw scores to [0, 1] (higher = better). When all
 * raw scores are equal (or there is a single candidate) every entry maps to 1
 * so a side with one strong hit isn't zeroed out by degenerate normalization.
 * This single/all-equal → 1.0 behavior is relied on by the LEXICAL side: a lone
 * exact-identifier FTS hit gets the full lexical weight so it can be rescued
 * (see [[search#Hybrid Fusion#FTS rescues an exact identifier]]).
 */
export function minMaxNormalize(raw: Map<string, number>): Map<string, number> {
  const values = [...raw.values()];
  if (values.length === 0) return new Map();
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const out = new Map<string, number>();
  for (const [id, v] of raw) {
    out.set(id, span === 0 ? 1 : (v - min) / span);
  }
  return out;
}

/**
 * Fuse raw dense + lexical candidate scores into a ranked list. Both sides
 * arrive as RAW higher-is-better signals — dense as cosine similarity
 * (`1 - distance`), lexical as negated bm25 — and this is the ONLY place they
 * are normalized: each side is per-query min-max normalized to [0, 1], then
 * combined as `DENSE_WEIGHT * dense + (1 - DENSE_WEIGHT) * bm25`. Feeding raw
 * cosine (not a pre-clamped per-row score) keeps the dense side's true relative
 * quality within the query — a lone or degenerate dense candidate is no longer
 * forced to the full DENSE_WEIGHT. A candidate present on only one side
 * contributes 0 from the missing side. Returns `{id, score}` sorted by
 * descending fused score. Pure — exercised directly in tests.
 */
export function fuseCandidates(
  denseRaw: Map<string, number>,
  lexicalRaw: Map<string, number>,
): { id: string; score: number }[] {
  const dense = minMaxNormalize(denseRaw);
  const lexical = minMaxNormalize(lexicalRaw);

  const ids = new Set<string>([...dense.keys(), ...lexical.keys()]);
  const fused: { id: string; score: number }[] = [];
  for (const id of ids) {
    const d = dense.get(id) ?? 0;
    const l = lexical.get(id) ?? 0;
    fused.push({ id, score: DENSE_WEIGHT * d + (1 - DENSE_WEIGHT) * l });
  }
  fused.sort((a, b) => b.score - a.score);
  return fused;
}

/**
 * Build an FTS5 MATCH expression from a free-text query. Each alphanumeric
 * token is wrapped in double quotes (so FTS5 treats it as a literal term, not
 * an operator) and OR-joined, so a query like `getConfigDir resolution` matches
 * sections containing either term. Returns null when the query has no usable
 * tokens (caller then skips the lexical side).
 */
export function buildFtsMatch(query: string): string | null {
  const tokens = query.toLowerCase().match(/[a-z0-9]+/g);
  if (!tokens || tokens.length === 0) return null;
  const unique = [...new Set(tokens)];
  return unique.map((t) => `"${t}"`).join(' OR ');
}

/**
 * Dense (vector KNN) candidate scores, keyed by section id, as RAW cosine
 * similarity (`1 - cosine_distance`, higher = more similar). The raw signal is
 * handed to `fuseCandidates`, which is the single place normalization happens —
 * so the dense side's true within-query relative quality survives into fusion
 * (a lone candidate is normalized there, not pre-clamped to a fixed score here).
 */
async function denseCandidates(
  db: Client,
  query: string,
  provider: EmbeddingProvider,
  key: string,
  limit: number,
): Promise<Map<string, number>> {
  const [queryVec] = await embed([query], provider, key, true);
  const vecJson = JSON.stringify(queryVec);
  const rows = await db.execute({
    sql: `SELECT s.id,
                 vector_distance_cos(s.embedding, vector(?)) AS distance
          FROM vector_top_k('sections_vec_idx', vector(?), ?) AS v
          JOIN sections AS s ON s.rowid = v.id`,
    args: [vecJson, vecJson, limit],
  });
  const scores = new Map<string, number>();
  for (const row of rows.rows) {
    // Raw cosine similarity (higher = better); fusion does the normalization.
    scores.set(row.id as string, 1 - (row.distance as number));
  }
  return scores;
}

/**
 * Lexical (FTS5 bm25) candidate scores, keyed by section id. SQLite's `bm25()`
 * returns a value where *more negative* is more relevant, so we negate it to
 * get a higher-is-better raw score before fusion normalizes it.
 */
export async function lexicalCandidates(
  db: Client,
  query: string,
  limit: number,
): Promise<Map<string, number>> {
  const match = buildFtsMatch(query);
  const scores = new Map<string, number>();
  if (!match) return scores;
  const rows = await db.execute({
    sql: `SELECT id, bm25(sections_fts) AS bm25
          FROM sections_fts
          WHERE sections_fts MATCH ?
          ORDER BY bm25
          LIMIT ?`,
    args: [match, limit],
  });
  for (const row of rows.rows) {
    // Negate so higher = more relevant, matching the dense side's convention.
    scores.set(row.id as string, -(row.bm25 as number));
  }
  return scores;
}

/**
 * Hybrid dense + lexical search. Pulls candidates from each side (at least
 * `CANDIDATES_PER_SIDE`, scaled up to `limit` so a large `--limit` isn't capped
 * by the pool), feeds the RAW per-side signals (dense cosine similarity, negated
 * bm25) to `fuseCandidates` — the single normalization point — which combines
 * them as `DENSE_WEIGHT * dense + (1 - DENSE_WEIGHT) * bm25`. A candidate found
 * by only one side contributes 0 from the missing side (it still ranks via its
 * present side). The fused list is sorted desc and the section row data is
 * looked up for the union of candidate ids; graph re-rank + final truncation
 * happen in the caller. See [[cli#search#Hybrid Search]].
 */
export async function hybridSearch(
  db: Client,
  query: string,
  provider: EmbeddingProvider,
  key: string,
  limit = 5,
): Promise<HybridResult[]> {
  // Fetch enough per side that the pool can satisfy a large limit (plus graph
  // seeds) instead of being capped at the fixed baseline.
  const perSide = Math.max(CANDIDATES_PER_SIDE, limit);
  const [denseRaw, lexicalRaw] = await Promise.all([
    denseCandidates(db, query, provider, key, perSide),
    lexicalCandidates(db, query, perSide),
  ]);

  const fused = fuseCandidates(denseRaw, lexicalRaw);

  // Look up section row data for the fused candidates. We over-fetch (union of
  // both sides, never fewer than `limit`) and let the caller graph-expand then
  // truncate to `limit`, so neighbours can be discovered from a larger pool of
  // seeds than the final result count.
  const poolSize = Math.max(perSide * 2, limit);
  const top = fused.slice(0, poolSize);
  if (top.length === 0) return [];

  const placeholders = top.map(() => '?').join(', ');
  const rows = await db.execute({
    sql: `SELECT id, file, heading, content FROM sections WHERE id IN (${placeholders})`,
    args: top.map((t) => t.id),
  });
  const byId = new Map(rows.rows.map((r) => [r.id as string, r]));

  const results: HybridResult[] = [];
  for (const { id, score } of top) {
    const row = byId.get(id);
    if (!row) continue;
    results.push({
      id,
      file: row.file as string,
      heading: row.heading as string,
      content: row.content as string,
      // No single cosine distance for a fused hit; report the fused score and a
      // sentinel distance so the field stays present for debuggability.
      distance: NaN,
      score,
    });
  }
  // `limit` is honored downstream after graph expansion; hand back the ranked
  // candidate pool so neighbours can be discovered from more than `limit` seeds.
  return results;
}
