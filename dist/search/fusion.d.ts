/**
 * Pure hybrid-fusion primitives — no libsql, no Node, no embeddings. This is the
 * single source of truth for how dense + lexical signals are normalized and
 * combined, so the exact same fusion runs server-side (Node, over libsql in
 * [[src/search/hybrid.ts#hybridSearch]]) and client-side (the browser bundle for
 * `lat build`'s static site). Keeping it dependency-free is what lets both
 * targets share one implementation instead of drifting. See
 * [[cli#search#Hybrid Search]].
 */
/**
 * Weight given to the dense (semantic) side in the hybrid fusion. The lexical
 * (bm25) side gets `1 - DENSE_WEIGHT`. Empirically validated at 0.75: dense
 * leads, but lexical breaks ties and rescues exact-identifier / rare-term
 * queries the embedding model under-ranks. See [[cli#search#Hybrid Search]].
 */
export declare const DENSE_WEIGHT = 0.75;
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
