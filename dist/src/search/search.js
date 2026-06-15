import { embed } from './embeddings.js';
/**
 * Map a cosine distance (0 = identical .. 2 = opposite) to a bounded
 * relevance score in [0, 1] where 1 is most relevant. This gives a stable,
 * comparable number we can show to users and merge with graph-expanded /
 * keyword-fallback scores without one ranking scheme dwarfing another.
 */
export function distanceToScore(distance) {
    const score = 1 - distance / 2;
    if (score < 0)
        return 0;
    if (score > 1)
        return 1;
    return score;
}
export async function searchSections(db, query, provider, key, limit = 5) {
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
        const distance = row.distance;
        return {
            id: row.id,
            file: row.file,
            heading: row.heading,
            content: row.content,
            distance,
            score: distanceToScore(distance),
        };
    });
}
