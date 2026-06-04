import type { Client } from '@libsql/client';
import { embed } from './embeddings.js';
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
export function distanceToScore(distance: number): number {
  const score = 1 - distance / 2;
  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}

export async function searchSections(
  db: Client,
  query: string,
  provider: EmbeddingProvider,
  key: string,
  limit = 5,
): Promise<SearchResult[]> {
  // `isQuery: true` — this is the search/query side, so asymmetric local models
  // apply their query instruction prefix (HTTP providers ignore the flag). The
  // default-`false` call here was a latent bug for the local provider.
  const [queryVec] = await embed([query], provider, key, true);
  const vecJson = JSON.stringify(queryVec);

  // Select the cosine distance alongside the section so we can expose a
  // bounded relevance score per result (see `distanceToScore`).
  const rows = await db.execute({
    sql: `SELECT s.id, s.file, s.heading, s.content,
                 vector_distance_cos(s.embedding, vector(?)) AS distance
          FROM vector_top_k('sections_vec_idx', vector(?), ?) AS v
          JOIN sections AS s ON s.rowid = v.id`,
    args: [vecJson, vecJson, limit],
  });

  return rows.rows.map((row) => {
    const distance = row.distance as number;
    return {
      id: row.id as string,
      file: row.file as string,
      heading: row.heading as string,
      content: row.content as string,
      distance,
      score: distanceToScore(distance),
    };
  });
}
