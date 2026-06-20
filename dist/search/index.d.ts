import type { Client } from '@libsql/client';
import type { EmbeddingProvider } from './provider.js';
/**
 * Chunk-and-pool params (empirically validated). Sections longer than
 * `CHUNK_WORDS` are split into overlapping windows of ~`CHUNK_WORDS` words with
 * `CHUNK_OVERLAP` words of overlap; each window is embedded separately and the
 * L2-normalized window vectors are mean-pooled into one section vector. This
 * avoids the silent ~512-token truncation that drops 15-28% of long sections
 * for short-context models. See [[cli#search#Chunk and Pool]].
 */
export declare const CHUNK_WORDS = 300;
export declare const CHUNK_OVERLAP = 50;
/**
 * Split `text` into ~`CHUNK_WORDS`-word windows with `CHUNK_OVERLAP`-word
 * overlap. Whitespace-tokenized; returns the original text as a single window
 * when it fits in one chunk (the common case for short sections). The stride
 * is `CHUNK_WORDS - CHUNK_OVERLAP`, so consecutive windows share `CHUNK_OVERLAP`
 * words and no content is lost at boundaries.
 */
export declare function chunkWords(text: string, chunkWords?: number, overlap?: number): string[];
/**
 * Mean-pool a list of window vectors into one section vector: L2-normalize each
 * window vector, average component-wise, then L2-normalize the result. Pooling
 * normalized vectors keeps every window's contribution equal regardless of its
 * raw magnitude, and the final renormalize makes the section vector comparable
 * under cosine distance. A single-window section passes through unchanged
 * (after normalization).
 */
export declare function meanPool(vectors: number[][]): number[];
export type IndexStats = {
    added: number;
    updated: number;
    removed: number;
    unchanged: number;
};
export declare function indexSections(latDir: string, db: Client, provider: EmbeddingProvider, key: string): Promise<IndexStats>;
