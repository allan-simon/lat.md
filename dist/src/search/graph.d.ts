import { type Section } from '../lattice.js';
/**
 * Graph-expansion re-ranking constants. After the dense (or fallback) top-k
 * is found, we walk the [[wiki-link]] graph `HOP_COUNT` hop(s) and add unseen
 * neighbours at `parentScore * GRAPH_PENALTY`. The penalty (< 1) guarantees an
 * inferred neighbour can never outrank the direct match that pulled it in, so
 * the expansion is conservative and safe to leave always-on.
 */
export declare const HOP_COUNT = 1;
export declare const GRAPH_PENALTY = 0.5;
/** A graph-discovered neighbour section plus its discounted score. */
export type GraphHit = {
    section: Section;
    score: number;
};
/**
 * From a set of seed results, walk the wiki-link graph `HOP_COUNT` hop(s) and
 * return neighbour sections that are NOT already in the seed set, each scored
 * at `parentScore * GRAPH_PENALTY`. The caller merges these with the direct
 * hits and re-sorts; the penalty keeps inferred hits strictly below their
 * parents. Edges are treated as undirected (a link in either direction makes
 * two sections neighbours) so related sections surface regardless of which one
 * authored the link.
 */
export declare function expandViaGraph(latDir: string, seeds: {
    id: string;
    score: number;
}[]): Promise<GraphHit[]>;
