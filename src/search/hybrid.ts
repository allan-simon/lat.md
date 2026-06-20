import type { Client } from '@libsql/client';
import { embed } from './embeddings.js';
import type { EmbeddingProvider } from './provider.js';
import type { SearchResult } from './search.js';
import { buildFtsMatch, fuseCandidates } from './fusion.js';

// The pure fusion primitives live in [[src/search/fusion.ts]] (no libsql/Node
// deps) so the browser bundle can reuse the exact same normalization + weights.
// Re-exported here so existing importers (and the test suite) keep their paths.
export {
  DENSE_WEIGHT,
  minMaxNormalize,
  buildFtsMatch,
  fuseCandidates,
} from './fusion.js';

/**
 * Baseline number of candidates to pull from each side before fusing. Scaled up
 * to the requested `limit` so a large `--limit` isn't silently capped by the
 * candidate pool (see [[src/search/hybrid.ts#hybridSearch]]).
 */
const CANDIDATES_PER_SIDE = 20;

/** A fused hybrid hit: section row data plus the combined relevance score. */
export type HybridResult = SearchResult;

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
