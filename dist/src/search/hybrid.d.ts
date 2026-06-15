import type { Client } from '@libsql/client';
import type { EmbeddingProvider } from './provider.js';
import type { SearchResult } from './search.js';
/**
 * Weight given to the dense (semantic) side in the hybrid fusion. The lexical
 * (bm25) side gets `1 - DENSE_WEIGHT`. Empirically validated at 0.75: dense
 * leads, but lexical breaks ties and rescues exact-identifier / rare-term
 * queries the embedding model under-ranks. See [[cli#search#Hybrid Search]].
 */
export declare const DENSE_WEIGHT = 0.75;
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
export declare function minMaxNormalize(raw: Map<string, number>): Map<string, number>;
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
export declare function fuseCandidates(denseRaw: Map<string, number>, lexicalRaw: Map<string, number>): {
    id: string;
    score: number;
}[];
/**
 * Build an FTS5 MATCH expression from a free-text query. Each alphanumeric
 * token is wrapped in double quotes (so FTS5 treats it as a literal term, not
 * an operator) and OR-joined, so a query like `getConfigDir resolution` matches
 * sections containing either term. Returns null when the query has no usable
 * tokens (caller then skips the lexical side).
 */
export declare function buildFtsMatch(query: string): string | null;
/**
 * Lexical (FTS5 bm25) candidate scores, keyed by section id. SQLite's `bm25()`
 * returns a value where *more negative* is more relevant, so we negate it to
 * get a higher-is-better raw score before fusion normalizes it.
 */
export declare function lexicalCandidates(db: Client, query: string, limit: number): Promise<Map<string, number>>;
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
export declare function hybridSearch(db: Client, query: string, provider: EmbeddingProvider, key: string, limit?: number): Promise<HybridResult[]>;
