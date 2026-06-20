import { type Section } from '../lattice.js';
/**
 * A keyword-fallback hit: the matched section plus a bounded relevance score
 * in [0, 1]. Used when embeddings are unavailable (no LLM key or a thrown
 * provider/embedding error) so `lat search` never hard-fails — see
 * [[cli#search#Keyword Fallback]].
 */
export type KeywordHit = {
    section: Section;
    score: number;
};
/**
 * Score every section against the query by token overlap over its
 * heading + body content, returning the top `limit` hits sorted by score.
 *
 * The score is bounded in [0, 1]: it's the fraction of distinct query tokens
 * present in the section (weighted so heading matches count double), so a
 * section containing every query term scores near 1.0. This intentionally
 * sits below typical semantic scores so it reads as a weaker, best-effort
 * signal — but it is always available without an embedding API.
 */
export declare function keywordSearch(latDir: string, query: string, limit?: number): Promise<KeywordHit[]>;
