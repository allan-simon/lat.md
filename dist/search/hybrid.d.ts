import type { Client } from '@libsql/client';
import type { EmbeddingProvider } from './provider.js';
import type { SearchResult } from './search.js';
export { DENSE_WEIGHT, minMaxNormalize, buildFtsMatch, fuseCandidates, } from './fusion.js';
/** A fused hybrid hit: section row data plus the combined relevance score. */
export type HybridResult = SearchResult;
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
