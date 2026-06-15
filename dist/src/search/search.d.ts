import type { Client } from '@libsql/client';
import type { EmbeddingProvider } from './provider.js';
export type SearchResult = {
    id: string;
    file: string;
    heading: string;
    content: string;
    /**
     * Raw cosine distance from `vector_distance_cos` (0 = identical, up to 2).
     * Lower is more similar. Kept alongside `score` for debuggability.
     */
    distance: number;
    /**
     * Bounded relevance score in [0, 1], derived from `distance`
     * via `distanceToScore`. Higher is more relevant.
     */
    score: number;
};
/**
 * Map a cosine distance (0 = identical .. 2 = opposite) to a bounded
 * relevance score in [0, 1] where 1 is most relevant. This gives a stable,
 * comparable number we can show to users and merge with graph-expanded /
 * keyword-fallback scores without one ranking scheme dwarfing another.
 */
export declare function distanceToScore(distance: number): number;
export declare function searchSections(db: Client, query: string, provider: EmbeddingProvider, key: string, limit?: number): Promise<SearchResult[]>;
