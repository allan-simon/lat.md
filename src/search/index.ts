import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { Client } from '@libsql/client';
import { loadAllSections, flattenSections, type Section } from '../lattice.js';
import { embed } from './embeddings.js';
import type { EmbeddingProvider } from './provider.js';

/**
 * Chunk-and-pool params (empirically validated). Sections longer than
 * `CHUNK_WORDS` are split into overlapping windows of ~`CHUNK_WORDS` words with
 * `CHUNK_OVERLAP` words of overlap; each window is embedded separately and the
 * L2-normalized window vectors are mean-pooled into one section vector. This
 * avoids the silent ~512-token truncation that drops 15-28% of long sections
 * for short-context models. See [[cli#search#Chunk and Pool]].
 */
export const CHUNK_WORDS = 300;
export const CHUNK_OVERLAP = 50;

function hashContent(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/**
 * Split `text` into ~`CHUNK_WORDS`-word windows with `CHUNK_OVERLAP`-word
 * overlap. Whitespace-tokenized; returns the original text as a single window
 * when it fits in one chunk (the common case for short sections). The stride
 * is `CHUNK_WORDS - CHUNK_OVERLAP`, so consecutive windows share `CHUNK_OVERLAP`
 * words and no content is lost at boundaries.
 */
export function chunkWords(
  text: string,
  chunkWords = CHUNK_WORDS,
  overlap = CHUNK_OVERLAP,
): string[] {
  const words = text.split(/\s+/).filter((w) => w.length > 0);
  if (words.length <= chunkWords) return [text];

  const stride = chunkWords - overlap;
  const windows: string[] = [];
  for (let start = 0; start < words.length; start += stride) {
    windows.push(words.slice(start, start + chunkWords).join(' '));
    if (start + chunkWords >= words.length) break;
  }
  return windows;
}

/** L2-normalize a vector in place-safe fashion, returning a new array. */
function l2normalize(vec: number[]): number[] {
  let norm = 0;
  for (const v of vec) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec.slice();
  return vec.map((v) => v / norm);
}

/**
 * Mean-pool a list of window vectors into one section vector: L2-normalize each
 * window vector, average component-wise, then L2-normalize the result. Pooling
 * normalized vectors keeps every window's contribution equal regardless of its
 * raw magnitude, and the final renormalize makes the section vector comparable
 * under cosine distance. A single-window section passes through unchanged
 * (after normalization).
 */
export function meanPool(vectors: number[][]): number[] {
  if (vectors.length === 0) return [];
  const dims = vectors[0].length;
  const acc = new Array<number>(dims).fill(0);
  for (const vec of vectors) {
    const unit = l2normalize(vec);
    for (let i = 0; i < dims; i++) acc[i] += unit[i];
  }
  for (let i = 0; i < dims; i++) acc[i] /= vectors.length;
  return l2normalize(acc);
}

async function sectionContent(
  section: Section,
  projectRoot: string,
): Promise<string> {
  const filePath = join(projectRoot, section.filePath);
  const content = await readFile(filePath, 'utf-8');
  const lines = content.split('\n');
  return lines.slice(section.startLine - 1, section.endLine).join('\n');
}

export type IndexStats = {
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
};

export async function indexSections(
  latDir: string,
  db: Client,
  provider: EmbeddingProvider,
  key: string,
): Promise<IndexStats> {
  const projectRoot = dirname(latDir);
  const allSections = await loadAllSections(latDir);
  const flat = flattenSections(allSections);

  // Build current state: id -> { section, content, hash }
  const current = new Map<
    string,
    { section: Section; content: string; hash: string }
  >();
  for (const s of flat) {
    const text = await sectionContent(s, projectRoot);
    current.set(s.id, { section: s, content: text, hash: hashContent(text) });
  }

  // Get existing hashes from DB
  const existing = new Map<string, string>();
  const rows = await db.execute('SELECT id, content_hash FROM sections');
  for (const row of rows.rows) {
    existing.set(row.id as string, row.content_hash as string);
  }

  // Partition into new, changed, unchanged, deleted
  const toEmbed: { id: string; content: string; section: Section }[] = [];
  let unchanged = 0;

  for (const [id, entry] of current) {
    const existingHash = existing.get(id);
    if (existingHash === entry.hash) {
      unchanged++;
    } else {
      toEmbed.push({ id, content: entry.content, section: entry.section });
    }
  }

  const toDelete = [...existing.keys()].filter((id) => !current.has(id));

  // Embed new/changed sections. Long sections are split into overlapping
  // windows; we flatten every window across every section into a single batch
  // (so the provider's batching still applies), then mean-pool each section's
  // windows back into one vector. Short sections produce exactly one window.
  if (toEmbed.length > 0) {
    const windowsPerSection = toEmbed.map((e) => chunkWords(e.content));
    const flatWindows = windowsPerSection.flat();
    const flatVectors = await embed(flatWindows, provider, key);
    const now = Date.now();

    let cursor = 0;
    for (let i = 0; i < toEmbed.length; i++) {
      const { id, content, section } = toEmbed[i];
      const hash = current.get(id)!.hash;
      const windowVectors = flatVectors.slice(
        cursor,
        cursor + windowsPerSection[i].length,
      );
      cursor += windowsPerSection[i].length;
      const pooled = meanPool(windowVectors);
      const vecJson = JSON.stringify(pooled);

      await db.execute({
        sql: `INSERT OR REPLACE INTO sections (id, file, heading, content, content_hash, embedding, updated_at)
              VALUES (?, ?, ?, ?, ?, vector(?), ?)`,
        args: [id, section.file, section.heading, content, hash, vecJson, now],
      });

      // Keep the FTS5 mirror in lockstep: replace any prior row for this id,
      // then insert the current heading + content for the lexical (bm25) side.
      await db.execute({
        sql: 'DELETE FROM sections_fts WHERE id = ?',
        args: [id],
      });
      await db.execute({
        sql: `INSERT INTO sections_fts (id, heading, content) VALUES (?, ?, ?)`,
        args: [id, section.heading, content],
      });
    }
  }

  // Delete removed sections (from both the vector table and the FTS mirror).
  for (const id of toDelete) {
    await db.execute({ sql: 'DELETE FROM sections WHERE id = ?', args: [id] });
    await db.execute({
      sql: 'DELETE FROM sections_fts WHERE id = ?',
      args: [id],
    });
  }

  const added = toEmbed.filter((e) => !existing.has(e.id)).length;
  const updated = toEmbed.filter((e) => existing.has(e.id)).length;

  return { added, updated, removed: toDelete.length, unchanged };
}
