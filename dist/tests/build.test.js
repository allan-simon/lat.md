import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFile, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { bm25Search } from '../src/render/site.js';
import { buildCommand } from '../src/cli/build.js';
import { plainStyler } from '../src/context.js';
const DOCS = [
    { url: 'a.html', heading: 'Hybrid Search', firstParagraph: 'dense + bm25', text: 'fuses dense semantic ranking with lexical bm25 fusion' },
    { url: 'b.html', heading: 'Local Mode', firstParagraph: 'offline', text: 'in-process gguf embedding model offline no api key' },
    { url: 'c.html', heading: 'Keyword Fallback', firstParagraph: 'lexical', text: 'token overlap heading body when embeddings unavailable' },
];
// @lat: [[tests/build#BM25 search]]
describe('bm25Search', () => {
    it('ranks the most relevant doc first', () => {
        const hits = bm25Search('dense bm25 fusion', DOCS);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].url).toBe('a.html');
    });
    it('returns an empty list for a query with no matching terms', () => {
        expect(bm25Search('xyzzy nonexistent', DOCS)).toEqual([]);
    });
    it('returns an empty list for an empty query', () => {
        expect(bm25Search('', DOCS)).toEqual([]);
    });
});
// @lat: [[tests/build#Static build]]
describe('lat build', () => {
    const out = join(tmpdir(), `lat-build-test-${process.pid}`);
    const projectRoot = join(import.meta.dirname, '..');
    const ctx = {
        latDir: join(projectRoot, 'lat.md'),
        projectRoot,
        styler: plainStyler,
        mode: 'cli',
    };
    beforeAll(async () => {
        await buildCommand(ctx, { out });
    });
    afterAll(async () => {
        await rm(out, { recursive: true, force: true });
    });
    it('emits an index page, a search index, and per-section pages', async () => {
        const files = await readdir(out);
        expect(files).toContain('index.html');
        expect(files).toContain('search-index.json');
        expect(files.filter((f) => f.endsWith('.html')).length).toBeGreaterThan(10);
    });
    it('uses flat static links, not the server /section route', async () => {
        const index = await readFile(join(out, 'index.html'), 'utf-8');
        expect(index).not.toContain('/section?id=');
        expect(index).toMatch(/href="[a-z0-9-]+\.html"/);
    });
    it('ships a search index whose BM25 finds a known section', async () => {
        const docs = JSON.parse(await readFile(join(out, 'search-index.json'), 'utf-8'));
        const hits = bm25Search('hybrid dense bm25 fusion', docs);
        expect(hits.length).toBeGreaterThan(0);
        expect(hits[0].heading.toLowerCase()).toContain('hybrid');
        // The hit's target page actually exists on disk.
        const files = await readdir(out);
        expect(files).toContain(hits[0].url);
    });
});
