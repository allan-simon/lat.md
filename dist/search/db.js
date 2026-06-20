import { createClient } from '@libsql/client';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
export function openDb(latDir) {
    const cacheDir = join(latDir, '.cache');
    mkdirSync(cacheDir, { recursive: true });
    const client = createClient({
        url: `file:${join(cacheDir, 'vectors.db')}`,
    });
    return client;
}
/** `meta` table key under which the active embedding fingerprint is stored. */
const FINGERPRINT_KEY = 'embedding_fingerprint';
/**
 * Stable identity of the embedding model the index was built with:
 * `${provider.name}:${provider.model}:${provider.dimensions}`. Stored in
 * `meta` so a model/dimension switch is detected and self-heals via a full
 * rebuild instead of silently corrupting search (mismatched dims, stale
 * vectors from a different model). See [[cli#search#Model Fingerprint]].
 */
export function modelFingerprint(provider) {
    return `${provider.name}:${provider.model}:${provider.dimensions}`;
}
/** Create the `sections` table + FTS5 mirror + vector index at `dimensions`. */
async function createSectionTables(db, dimensions) {
    await db.execute(`CREATE TABLE IF NOT EXISTS sections (
      id TEXT PRIMARY KEY,
      file TEXT NOT NULL,
      heading TEXT NOT NULL,
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      embedding F32_BLOB(${dimensions}),
      updated_at INTEGER NOT NULL
    )`);
    await db.execute(`CREATE INDEX IF NOT EXISTS sections_vec_idx
     ON sections (libsql_vector_idx(embedding))`);
    // FTS5 mirror over heading + content for the lexical (bm25) side of the
    // hybrid ranker (see [[cli#search#Hybrid Search]]). Keyed by the section id
    // (stored UNINDEXED so it round-trips without being tokenized) so we can map
    // a lexical hit back to its `sections` row.
    await db.execute(`CREATE VIRTUAL TABLE IF NOT EXISTS sections_fts USING fts5(
      id UNINDEXED,
      heading,
      content
    )`);
}
/** Drop the vector/FTS schema so it can be recreated at new dimensions. */
async function dropSectionTables(db) {
    await db.execute('DROP INDEX IF EXISTS sections_vec_idx');
    await db.execute('DROP TABLE IF EXISTS sections');
    await db.execute('DROP TABLE IF EXISTS sections_fts');
}
/**
 * Ensure the schema exists and matches the active embedding model.
 *
 * The `meta` table records the fingerprint the index was built with. On each
 * run we compare it to the active provider's fingerprint:
 *
 * - **missing** (fresh DB) → write it, create the tables.
 * - **same** → no-op, incremental indexing proceeds.
 * - **different** (model/dim switch) → DROP and recreate `sections` +
 *   `sections_fts` + the vector index empty at the new dimensions, and report
 *   `rebuilt: true` so the caller can surface the rebuild. The fingerprint is
 *   deliberately NOT written here: the subsequent index pass re-embeds every
 *   section because the tables are empty, and the caller commits the new
 *   fingerprint via [[src/search/db.ts#commitFingerprint]] only once that
 *   succeeds. If the rebuild is interrupted (e.g. the embed call throws and the
 *   caller falls back to keyword search) the old fingerprint persists, so the
 *   next run re-detects the switch and rebuilds again instead of trusting the
 *   empty/partial tables.
 */
export async function ensureSchema(db, provider) {
    const dimensions = provider.dimensions;
    const fingerprint = modelFingerprint(provider);
    // The meta table is independent of the embedding dimensions, so it survives
    // a rebuild and can hold the fingerprint across model switches.
    await db.execute(`CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`);
    const metaRow = await db.execute({
        sql: 'SELECT value FROM meta WHERE key = ?',
        args: [FINGERPRINT_KEY],
    });
    const stored = metaRow.rows.length > 0 ? metaRow.rows[0].value : undefined;
    if (stored === fingerprint) {
        // Fingerprint matches — make sure the tables exist (covers a meta-only DB)
        // and proceed incrementally.
        await createSectionTables(db, dimensions);
        return { rebuilt: false };
    }
    if (stored === undefined) {
        // Fresh index: record the fingerprint and create the tables.
        await createSectionTables(db, dimensions);
        await db.execute({
            sql: 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
            args: [FINGERPRINT_KEY, fingerprint],
        });
        return { rebuilt: false };
    }
    // Fingerprint changed (different model/dimensions): drop and recreate so the
    // vector column is the right width and no stale, incomparable vectors remain.
    // The new fingerprint is intentionally left unwritten — the tables are now
    // empty and the re-embed has not run yet. The caller calls commitFingerprint
    // only after indexSections() succeeds, so an interrupted/failed rebuild keeps
    // the old fingerprint and the next run re-detects the switch.
    await dropSectionTables(db);
    await createSectionTables(db, dimensions);
    return { rebuilt: true, previousFingerprint: stored };
}
/**
 * Record the active provider's fingerprint as the one the index was built with.
 * Called by the caller only after a successful index pass, so a model switch's
 * new fingerprint is committed atomically with the completed re-embed (see
 * [[src/search/db.ts#ensureSchema]] and [[cli#search#Model Fingerprint]]).
 */
export async function commitFingerprint(db, provider) {
    await db.execute({
        sql: 'INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)',
        args: [FINGERPRINT_KEY, modelFingerprint(provider)],
    });
}
export async function closeDb(db) {
    db.close();
}
