import { type Client } from '@libsql/client';
import type { EmbeddingProvider } from './provider.js';
export declare function openDb(latDir: string): Client;
/**
 * Stable identity of the embedding model the index was built with:
 * `${provider.name}:${provider.model}:${provider.dimensions}`. Stored in
 * `meta` so a model/dimension switch is detected and self-heals via a full
 * rebuild instead of silently corrupting search (mismatched dims, stale
 * vectors from a different model). See [[cli#search#Model Fingerprint]].
 */
export declare function modelFingerprint(provider: EmbeddingProvider): string;
/** Outcome of [[src/search/db.ts#ensureSchema]] for the caller to surface. */
export type SchemaResult = {
    /**
     * True when the embedding fingerprint changed (or this is a fresh DB whose
     * fingerprint was just written): the `sections` table, `sections_fts` mirror,
     * and vector index were dropped and recreated empty at the active dimensions.
     * The re-embed is still pending — it runs in the subsequent index pass — and
     * on a *change* the new fingerprint is NOT yet committed: the caller must call
     * [[src/search/db.ts#commitFingerprint]] only after indexing succeeds, so an
     * interrupted rebuild leaves the old fingerprint in place and the next run
     * re-detects the switch (see [[cli#search#Model Fingerprint]]).
     */
    rebuilt: boolean;
    /** The previous fingerprint, when a *change* (not first run) triggered the rebuild. */
    previousFingerprint?: string;
};
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
export declare function ensureSchema(db: Client, provider: EmbeddingProvider): Promise<SchemaResult>;
/**
 * Record the active provider's fingerprint as the one the index was built with.
 * Called by the caller only after a successful index pass, so a model switch's
 * new fingerprint is committed atomically with the completed re-embed (see
 * [[src/search/db.ts#ensureSchema]] and [[cli#search#Model Fingerprint]]).
 */
export declare function commitFingerprint(db: Client, provider: EmbeddingProvider): Promise<void>;
export declare function closeDb(db: Client): Promise<void>;
