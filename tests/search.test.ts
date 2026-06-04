import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  detectProvider,
  type EmbeddingProvider,
} from '../src/search/provider.js';
import {
  openDb,
  ensureSchema,
  closeDb,
  modelFingerprint,
  commitFingerprint,
} from '../src/search/db.js';
import {
  indexSections,
  chunkWords,
  meanPool,
  CHUNK_WORDS,
  CHUNK_OVERLAP,
} from '../src/search/index.js';
import { searchSections, distanceToScore } from '../src/search/search.js';
import { keywordSearch } from '../src/search/keyword.js';
import {
  buildFtsMatch,
  fuseCandidates,
  lexicalCandidates,
  hybridSearch,
  minMaxNormalize,
  DENSE_WEIGHT,
} from '../src/search/hybrid.js';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import {
  embedLocal,
  resolveLocalModel,
  localProvider,
  modelCacheDir,
} from '../src/search/local.js';
import {
  expandViaGraph,
  HOP_COUNT,
  GRAPH_PENALTY,
} from '../src/search/graph.js';
import { startReplayServer, hasReplayData } from './rag-replay-server.js';
import type { Client } from '@libsql/client';
import type { Server } from 'node:http';

// --- Unit tests (always run) ---

// @lat: [[search#Provider Detection]]
describe('detectProvider', () => {
  it('detects OpenAI key', () => {
    const p = detectProvider('sk-abc123');
    expect(p.name).toBe('openai');
  });

  it('detects Vercel key', () => {
    const p = detectProvider('vck_abc123');
    expect(p.name).toBe('vercel');
  });

  it('rejects Anthropic key with helpful message', () => {
    expect(() => detectProvider('sk-ant-abc123')).toThrow(/Anthropic/);
  });

  it('rejects unknown key', () => {
    expect(() => detectProvider('xyz_abc123')).toThrow(/Unrecognized/);
  });

  // @lat: [[search#Local Provider#Provider detection]]
  it('detects the local provider from a local: key', () => {
    const p = detectProvider('local:qwen3-0.6b');
    expect(p.name).toBe('local');
    expect(p.model).toBe('Qwen3-Embedding-0.6B-Q8_0');
    expect(p.dimensions).toBe(1024);
  });

  it('detects the local provider from a bare "local" key (default model)', () => {
    const p = detectProvider('local');
    expect(p.name).toBe('local');
    expect(p.dimensions).toBe(1024);
  });

  it('rejects an unknown local model id', () => {
    expect(() => detectProvider('local:does-not-exist')).toThrow(
      /Unknown local embedding model/,
    );
  });

  it('gives the local provider a distinct model fingerprint', () => {
    expect(modelFingerprint(detectProvider('local:qwen3-0.6b'))).toBe(
      'local:Qwen3-Embedding-0.6B-Q8_0:1024',
    );
  });
});

// @lat: [[search#Score Components]]
describe('distanceToScore', () => {
  it('maps cosine distance to a bounded [0,1] score (lower distance is better)', () => {
    expect(distanceToScore(0)).toBe(1); // identical
    expect(distanceToScore(1)).toBe(0.5); // orthogonal
    expect(distanceToScore(2)).toBe(0); // opposite
  });

  it('clamps out-of-range distances to [0,1]', () => {
    expect(distanceToScore(-0.1)).toBe(1);
    expect(distanceToScore(3)).toBe(0);
  });
});

// @lat: [[search#Model Fingerprint]]
describe('ensureSchema model fingerprint', () => {
  // Two fake providers differing in model + dimensions; we only exercise the
  // schema/meta logic here, so no real embedding endpoint is needed.
  const modelA: EmbeddingProvider = {
    name: 'fake',
    apiBase: 'http://unused',
    model: 'model-a',
    dimensions: 8,
    headers: () => ({}),
  };
  const modelB: EmbeddingProvider = {
    ...modelA,
    model: 'model-b',
    dimensions: 16,
  };

  function makeDb(): { tmp: string; latDir: string } {
    const tmp = mkdtempSync(join(tmpdir(), 'lat-fp-'));
    const latDir = join(tmp, 'lat.md');
    mkdirSync(latDir, { recursive: true });
    return { tmp, latDir };
  }

  it('computes the fingerprint as name:model:dimensions', () => {
    expect(modelFingerprint(modelA)).toBe('fake:model-a:8');
    expect(modelFingerprint(modelB)).toBe('fake:model-b:16');
  });

  it('writes the fingerprint on a fresh DB without rebuilding', async () => {
    const { tmp, latDir } = makeDb();
    const db = openDb(latDir);
    try {
      const res = await ensureSchema(db, modelA);
      expect(res.rebuilt).toBe(false);
      const meta = await db.execute(
        "SELECT value FROM meta WHERE key = 'embedding_fingerprint'",
      );
      expect(meta.rows[0].value).toBe('fake:model-a:8');
    } finally {
      await closeDb(db);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not rebuild when the fingerprint is unchanged', async () => {
    const { tmp, latDir } = makeDb();
    const db = openDb(latDir);
    try {
      await ensureSchema(db, modelA);
      // Seed a row so we can prove it survives the no-op second call.
      await db.execute({
        sql: `INSERT INTO sections (id, file, heading, content, content_hash, embedding, updated_at)
              VALUES ('x#a', 'x', 'a', 'body', 'h', vector('[1,0,0,0,0,0,0,0]'), 0)`,
        args: [],
      });
      const res = await ensureSchema(db, modelA);
      expect(res.rebuilt).toBe(false);
      const count = await db.execute('SELECT COUNT(*) AS n FROM sections');
      expect(count.rows[0].n).toBe(1);
    } finally {
      await closeDb(db);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('drops and rebuilds the index when the model fingerprint changes, committing the new fingerprint only after a successful re-embed', async () => {
    const { tmp, latDir } = makeDb();
    const db = openDb(latDir);
    try {
      // Index under model A (8 dims) and seed a row.
      await ensureSchema(db, modelA);
      await db.execute({
        sql: `INSERT INTO sections (id, file, heading, content, content_hash, embedding, updated_at)
              VALUES ('x#a', 'x', 'a', 'body', 'h', vector('[1,0,0,0,0,0,0,0]'), 0)`,
        args: [],
      });
      const before = await db.execute('SELECT COUNT(*) AS n FROM sections');
      expect(before.rows[0].n).toBe(1);

      // Switch to model B (16 dims): full rebuild, stale row gone. The new
      // fingerprint is NOT written yet — ensureSchema leaves the old one so an
      // interrupted re-embed re-detects the switch on the next run.
      const res = await ensureSchema(db, modelB);
      expect(res.rebuilt).toBe(true);
      expect(res.previousFingerprint).toBe('fake:model-a:8');

      const after = await db.execute('SELECT COUNT(*) AS n FROM sections');
      expect(after.rows[0].n).toBe(0);
      const metaBeforeCommit = await db.execute(
        "SELECT value FROM meta WHERE key = 'embedding_fingerprint'",
      );
      expect(metaBeforeCommit.rows[0].value).toBe('fake:model-a:8');

      // The recreated table accepts a 16-dim vector (proving the new width).
      await db.execute({
        sql: `INSERT INTO sections (id, file, heading, content, content_hash, embedding, updated_at)
              VALUES ('y#b', 'y', 'b', 'body', 'h', vector('[1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]'), 0)`,
        args: [],
      });
      const final = await db.execute('SELECT COUNT(*) AS n FROM sections');
      expect(final.rows[0].n).toBe(1);

      // Only after a successful re-embed does the caller commit the new
      // fingerprint, mirroring withDb()'s `if (schema.rebuilt)` step.
      await commitFingerprint(db, modelB);
      const metaAfterCommit = await db.execute(
        "SELECT value FROM meta WHERE key = 'embedding_fingerprint'",
      );
      expect(metaAfterCommit.rows[0].value).toBe('fake:model-b:16');
    } finally {
      await closeDb(db);
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('re-detects the model switch on the next run when the rebuild was interrupted before commit', async () => {
    const { tmp, latDir } = makeDb();
    const db = openDb(latDir);
    try {
      await ensureSchema(db, modelA);

      // First switch: tables rebuilt empty, but commitFingerprint never runs
      // (simulating an embed failure that degraded to keyword fallback).
      const first = await ensureSchema(db, modelB);
      expect(first.rebuilt).toBe(true);

      // Next run still sees the old fingerprint, so it rebuilds again rather
      // than trusting the empty tables as if model B were fully indexed.
      const second = await ensureSchema(db, modelB);
      expect(second.rebuilt).toBe(true);
      expect(second.previousFingerprint).toBe('fake:model-a:8');
    } finally {
      await closeDb(db);
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// @lat: [[search#Chunk and Pool]]
describe('chunkWords', () => {
  it('returns a short section as a single window unchanged', () => {
    const text = 'one two three four five';
    expect(chunkWords(text)).toEqual([text]);
  });

  it('splits a long section into overlapping windows covering all words', () => {
    // 700 unique words → with 300-word windows, 50 overlap (stride 250):
    // windows start at 0, 250, 500 → 3 windows, last reaching word 700.
    const words = Array.from({ length: 700 }, (_, i) => `w${i}`);
    const windows = chunkWords(words.join(' '), CHUNK_WORDS, CHUNK_OVERLAP);
    expect(windows.length).toBe(3);
    // Each window (except possibly the last) is CHUNK_WORDS long.
    expect(windows[0].split(' ').length).toBe(CHUNK_WORDS);
    // Consecutive windows overlap by exactly CHUNK_OVERLAP words.
    const w0 = windows[0].split(' ');
    const w1 = windows[1].split(' ');
    const overlap = w0.slice(CHUNK_WORDS - CHUNK_OVERLAP);
    expect(w1.slice(0, CHUNK_OVERLAP)).toEqual(overlap);
    // No word is lost: the union of all windows covers every original word.
    const seen = new Set(windows.flatMap((w) => w.split(' ')));
    expect(seen.size).toBe(700);
  });
});

// @lat: [[search#Chunk and Pool]]
describe('meanPool', () => {
  it('passes a single vector through as its unit (L2-normalized)', () => {
    const pooled = meanPool([[3, 4]]); // norm 5
    expect(pooled[0]).toBeCloseTo(0.6);
    expect(pooled[1]).toBeCloseTo(0.8);
  });

  it('mean-pools normalized window vectors into a renormalized unit vector', () => {
    // Two orthogonal unit windows → pooled points at 45°, renormalized to unit.
    const pooled = meanPool([
      [1, 0],
      [0, 1],
    ]);
    const norm = Math.sqrt(pooled[0] ** 2 + pooled[1] ** 2);
    expect(norm).toBeCloseTo(1);
    expect(pooled[0]).toBeCloseTo(Math.SQRT1_2);
    expect(pooled[1]).toBeCloseTo(Math.SQRT1_2);
  });

  it('weights each window equally regardless of raw magnitude', () => {
    // A huge-magnitude window and a unit window in the same direction pool to
    // that shared direction — magnitude does not dominate because we normalize
    // each window first.
    const pooled = meanPool([
      [100, 0],
      [1, 0],
    ]);
    expect(pooled[0]).toBeCloseTo(1);
    expect(pooled[1]).toBeCloseTo(0);
  });
});

// @lat: [[search#Keyword Fallback]]
describe('keywordSearch', () => {
  function makeLat(): { tmp: string; latDir: string } {
    const tmp = mkdtempSync(join(tmpdir(), 'lat-kw-'));
    const latDir = join(tmp, 'lat.md');
    mkdirSync(latDir, { recursive: true });
    writeFileSync(
      join(latDir, 'a.md'),
      '# Authentication\n\nHow we verify user logins and security tokens.\n\n' +
        '# Deployment\n\nHow we ship the app to production servers.\n',
    );
    return { tmp, latDir };
  }

  it('ranks heading-overlapping sections first with a bounded score', async () => {
    const { tmp, latDir } = makeLat();
    try {
      const hits = await keywordSearch(
        latDir,
        'authentication and security',
        5,
      );
      expect(hits.length).toBeGreaterThan(0);
      expect(hits[0].section.heading).toBe('Authentication');
      expect(hits[0].score).toBeGreaterThan(0);
      expect(hits[0].score).toBeLessThanOrEqual(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('returns no hits when nothing overlaps', async () => {
    const { tmp, latDir } = makeLat();
    try {
      const hits = await keywordSearch(latDir, 'xylophone quokka', 5);
      expect(hits).toEqual([]);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// @lat: [[search#Graph Expansion]]
describe('expandViaGraph', () => {
  function makeChain(): { tmp: string; latDir: string } {
    // Foo --[[Bar]]--> Bar --[[Baz]]--> Baz (a 2-link chain in one file).
    const tmp = mkdtempSync(join(tmpdir(), 'lat-graph-'));
    const latDir = join(tmp, 'lat.md');
    mkdirSync(latDir, { recursive: true });
    writeFileSync(
      join(latDir, 'foo.md'),
      '# Foo\n\nLeading. See [[foo#Bar]].\n\n' +
        '# Bar\n\nLeading. See [[foo#Baz]].\n\n' +
        '# Baz\n\nLeading para.\n',
    );
    return { tmp, latDir };
  }

  it('adds 1-hop neighbours discounted by GRAPH_PENALTY and stops at HOP_COUNT', async () => {
    expect(HOP_COUNT).toBe(1);
    expect(GRAPH_PENALTY).toBe(0.5);
    const { tmp, latDir } = makeChain();
    try {
      const hits = await expandViaGraph(latDir, [
        { id: 'lat.md/foo#Foo', score: 0.9 },
      ]);
      const ids = hits.map((h) => h.section.id);
      // Bar is 1 hop away → included at 0.9 * 0.5; Baz is 2 hops → excluded.
      expect(ids).toContain('lat.md/foo#Bar');
      expect(ids).not.toContain('lat.md/foo#Baz');
      const bar = hits.find((h) => h.section.id === 'lat.md/foo#Bar')!;
      expect(bar.score).toBeCloseTo(0.45);
      // The discount guarantees the neighbour ranks below its 0.9 parent.
      expect(bar.score).toBeLessThan(0.9);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('does not re-add seed sections', async () => {
    const { tmp, latDir } = makeChain();
    try {
      const hits = await expandViaGraph(latDir, [
        { id: 'lat.md/foo#Foo', score: 0.9 },
        { id: 'lat.md/foo#Bar', score: 0.8 },
      ]);
      // Both endpoints already seeded; only Baz (1 hop from Bar) is new.
      expect(hits.map((h) => h.section.id)).toEqual(['lat.md/foo#Baz']);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// Gated functional test for the in-process local GGUF embedder. Runs ONLY when
// node-llama-cpp is installed AND the Qwen GGUF is already cached, so a fresh
// CI (no native dep, no ~639MB model) skips it instead of downloading.
const qwenSpec = resolveLocalModel('local:qwen3-0.6b');
const localModelCached = existsSync(join(modelCacheDir(), qwenSpec.file));

// @lat: [[search#Local Provider#In-process embedding sanity]]
describe.skipIf(!localModelCached)('embedLocal (Qwen3-0.6B GGUF)', () => {
  const provider = localProvider(qwenSpec);

  function cos(a: number[], b: number[]): number {
    let dot = 0;
    let na = 0;
    let nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      na += a[i] * a[i];
      nb += b[i] * b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb));
  }

  it('returns one 1024-dim L2-normalized vector per input', async () => {
    const docs = [
      'The getConfigDir function returns the XDG config directory path.',
      'A bright orange cat slept on the warm windowsill all afternoon.',
    ];
    const vecs = await embedLocal(docs, provider, false);
    expect(vecs.length).toBe(2);
    for (const v of vecs) {
      expect(v.length).toBe(1024);
      const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
      expect(norm).toBeCloseTo(1, 3);
    }
  }, 60_000);

  it('ranks a paraphrase above an unrelated text (query gets the instruct prefix)', async () => {
    const [docConfig, docCat] = await embedLocal(
      [
        'The getConfigDir function returns the XDG config directory path.',
        'A bright orange cat slept on the warm windowsill all afternoon.',
      ],
      provider,
      false,
    );
    const [query] = await embedLocal(
      ['where is the configuration directory located'],
      provider,
      true,
    );
    const simRelevant = cos(query, docConfig);
    const simUnrelated = cos(query, docCat);
    // Paraphrase clearly beats the unrelated sentence — proves correct pooling
    // and that the asymmetric query prefix is applied to queries only.
    expect(simRelevant).toBeGreaterThan(simUnrelated);
    expect(simRelevant).toBeGreaterThan(0.5);
    expect(simUnrelated).toBeLessThan(0.4);
  }, 60_000);
});

// @lat: [[search#Hybrid Fusion#FTS match expression]]
describe('buildFtsMatch', () => {
  it('wraps each alphanumeric token in quotes, OR-joined', () => {
    expect(buildFtsMatch('getConfigDir resolution')).toBe(
      '"getconfigdir" OR "resolution"',
    );
  });

  it('strips FTS5 operator characters so a query can never be a syntax error', () => {
    // A query full of punctuation that would otherwise break MATCH parsing.
    expect(buildFtsMatch('foo#Bar-baz: (NEAR)')).toBe(
      '"foo" OR "bar" OR "baz" OR "near"',
    );
  });

  it('returns null for a query with no usable tokens', () => {
    expect(buildFtsMatch('   #-:  ')).toBeNull();
  });
});

// @lat: [[search#Hybrid Fusion#Score fusion]]
describe('fuseCandidates', () => {
  it('combines min-max-normalized sides as DENSE_WEIGHT*dense + (1-DENSE_WEIGHT)*bm25', () => {
    expect(DENSE_WEIGHT).toBe(0.75);
    // Dense: a best (0.9→1), b worst (0.1→0). Lexical: b best (5→1), a worst (1→0).
    const dense = new Map([
      ['a', 0.9],
      ['b', 0.1],
    ]);
    const lexical = new Map([
      ['a', 1],
      ['b', 5],
    ]);
    const fused = fuseCandidates(dense, lexical);
    const byId = new Map(fused.map((f) => [f.id, f.score]));
    // a = 0.75*1 + 0.25*0 = 0.75 ; b = 0.75*0 + 0.25*1 = 0.25
    expect(byId.get('a')).toBeCloseTo(0.75);
    expect(byId.get('b')).toBeCloseTo(0.25);
    expect(fused[0].id).toBe('a');
  });

  it('scores a candidate found by only one side using that side alone', () => {
    const dense = new Map([['only-dense', 0.5]]);
    const lexical = new Map([['only-lexical', 9]]);
    const fused = fuseCandidates(dense, lexical);
    const byId = new Map(fused.map((f) => [f.id, f.score]));
    // single-candidate min-max maps each to 1; missing side contributes 0.
    expect(byId.get('only-dense')).toBeCloseTo(DENSE_WEIGHT); // 0.75*1
    expect(byId.get('only-lexical')).toBeCloseTo(1 - DENSE_WEIGHT); // 0.25*1
  });
});

// @lat: [[search#Hybrid Fusion#Min-max normalization]]
describe('minMaxNormalize', () => {
  it('maps equal scores all to 1 instead of dividing by a zero span', () => {
    const out = minMaxNormalize(
      new Map([
        ['a', 3],
        ['b', 3],
      ]),
    );
    expect(out.get('a')).toBe(1);
    expect(out.get('b')).toBe(1);
  });
});

// @lat: [[search#Hybrid Fusion#FTS rescues an exact identifier]]
describe('hybrid search surfaces an exact identifier the dense model under-ranks', () => {
  const DIM = 1536;

  // Sparse 1536-dim unit vectors so we can hand-craft a dense ranking where the
  // identifier-bearing section is NOT the closest semantically.
  function sparse(dim: number): number[] {
    const v = new Array<number>(DIM).fill(0);
    v[dim] = 1;
    return v;
  }

  // Assign a vector by inspecting the input text (robust to exact whitespace
  // from how sections are sliced). The query embeds near the "configuration
  // directory" prose (dim 0) with a slight lean to the unrelated section
  // (dim 2); the exact-identifier section (dim 1) is orthogonal, so DENSE
  // alone ranks it LAST — exactly the case FTS5 must rescue.
  function vectorFor(text: string): number[] {
    if (text === 'getConfigDir') {
      const v = sparse(0); // query
      v[2] = 0.15; // tiny lean to Unrelated so dense strictly ranks it 2nd
      return v; // Resolver (dim 1) is orthogonal → dense ranks it LAST
    }
    if (text.includes('configuration directory')) return sparse(0); // Config dir
    if (text.includes('getConfigDir helper')) return sparse(1); // Resolver (identifier)
    if (text.includes('deployment and servers')) return sparse(2); // Unrelated
    throw new Error(`test server: no vector rule for "${text.slice(0, 60)}"`);
  }

  let server: import('node:http').Server;
  let url: string;

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c: Buffer) => (body += c.toString()));
      req.on('end', () => {
        const { input } = JSON.parse(body) as { input: string[] };
        const data = input.map((text, i) => ({
          object: 'embedding',
          index: i,
          embedding: vectorFor(text),
        }));
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data }));
      });
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', () => resolve()),
    );
    const addr = server.address() as { port: number };
    url = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(() => {
    if (server) server.close();
  });

  it('lexical (FTS5) finds the identifier section; fusion lifts it above the dense-last rank', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'lat-hybrid-'));
    const latDir = join(tmp, 'lat.md');
    mkdirSync(latDir, { recursive: true });
    // The fixture content must match the text→vector keys above (heading+body).
    writeFileSync(
      join(latDir, 'x.md'),
      '# Config dir\n\nWhere we store the configuration directory on disk.\n\n' +
        '# Resolver\n\nThe getConfigDir helper returns the path.\n\n' +
        '# Unrelated\n\nNotes about deployment and servers.\n',
    );

    const key = `REPLAY_LAT_LLM_KEY::${url}`;
    const provider = detectProvider(key);
    const db = openDb(latDir);
    try {
      await ensureSchema(db, provider);
      await indexSections(latDir, db, provider, key);

      // FTS5 finds the identifier section by its exact token.
      const lex = await lexicalCandidates(db, 'getConfigDir', 20);
      expect([...lex.keys()]).toContain('lat.md/x#Resolver');

      // Dense alone ranks Resolver last (orthogonal to the query vector).
      const fused = await hybridSearch(db, 'getConfigDir', provider, key, 5);
      const ids = fused.map((r) => r.id);
      expect(ids).toContain('lat.md/x#Resolver');
      // Fusion gives Resolver the full lexical contribution (it's the only
      // FTS hit → normalized to 1), lifting it above the Unrelated section
      // that dense ranked second.
      const resolverRank = ids.indexOf('lat.md/x#Resolver');
      const unrelatedRank = ids.indexOf('lat.md/x#Unrelated');
      expect(resolverRank).toBeLessThan(unrelatedRank);

      // The dense side now carries RAW cosine into fusion (single
      // normalization), so its true within-query relative quality survives:
      // Config dir (near-identical to the query) clearly leads, and Unrelated
      // (only a slight dense lean, no FTS hit) keeps a small fused score rather
      // than being flattened to the full dense weight.
      const byId = new Map(fused.map((r) => [r.id, r.score]));
      expect(ids[0]).toBe('lat.md/x#Config dir');
      expect(byId.get('lat.md/x#Config dir')).toBeGreaterThan(
        byId.get('lat.md/x#Resolver')!,
      );
      expect(byId.get('lat.md/x#Unrelated')).toBeLessThan(
        byId.get('lat.md/x#Resolver')!,
      );
    } finally {
      await closeDb(db);
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});

// --- RAG functional tests ---
//
// Two modes:
// - Normal (default): replays cached vectors from tests/cases/rag/replay-data/
// - Capture (_LAT_TEST_CAPTURE_EMBEDDINGS=1): proxies to real API via LAT_LLM_KEY,
//   records vectors to replay-data/, then runs assertions against live results
//
// To re-cook: pnpm cook-test-rag

const capturing = !!process.env._LAT_TEST_CAPTURE_EMBEDDINGS;
const replayDir = join(import.meta.dirname, 'cases', 'rag', 'replay-data');
const canRun = capturing || hasReplayData(replayDir);

describe.skipIf(!canRun)('search (rag)', () => {
  let tmp: string;
  let latDir: string;
  let db: Client;
  let server: Server;
  let provider: EmbeddingProvider;
  let replayKey: string;
  let flushCapture: () => void;

  beforeAll(async () => {
    if (capturing) {
      // Capture mode: proxy to real API, record vectors
      const realKey = process.env.LAT_LLM_KEY;
      if (!realKey) throw new Error('LAT_LLM_KEY must be set in capture mode');
      const realProvider = detectProvider(realKey);

      const replay = await startReplayServer(replayDir, {
        capture: true,
        provider: realProvider,
        key: realKey,
      });
      server = replay.server;
      flushCapture = replay.flush;
      replayKey = `REPLAY_LAT_LLM_KEY::${replay.url}`;
      provider = detectProvider(replayKey);
    } else {
      // Replay mode: serve cached vectors
      const replay = await startReplayServer(replayDir);
      server = replay.server;
      flushCapture = replay.flush;
      replayKey = `REPLAY_LAT_LLM_KEY::${replay.url}`;
      provider = detectProvider(replayKey);
    }

    // Copy fixture to tmp so .cache doesn't pollute the repo
    tmp = mkdtempSync(join(tmpdir(), 'lat-rag-'));
    latDir = join(tmp, 'lat.md');
    cpSync(join(import.meta.dirname, 'cases', 'rag', 'lat.md'), latDir, {
      recursive: true,
    });

    db = openDb(latDir);
    await ensureSchema(db, provider);
  });

  afterAll(async () => {
    if (capturing) flushCapture();
    if (db) await closeDb(db);
    if (server) server.close();
    if (tmp) rmSync(tmp, { recursive: true, force: true });
  });

  // @lat: [[search#RAG Replay Tests#Indexes all sections]]
  it('indexes all sections', async () => {
    const stats = await indexSections(latDir, db, provider, replayKey);
    expect(stats.added).toBe(9);
    expect(stats.updated).toBe(0);
    expect(stats.removed).toBe(0);
    expect(stats.unchanged).toBe(0);
  });

  // @lat: [[search#RAG Replay Tests#Finds auth section for login query]]
  it('finds auth section for login query', async () => {
    const results = await searchSections(
      db,
      'how do we handle user login and security?',
      provider,
      replayKey,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toContain('Authentication');
  });

  // @lat: [[search#RAG Replay Tests#Finds performance section for latency query]]
  it('finds performance section for latency query', async () => {
    const results = await searchSections(
      db,
      'what tools do we use to measure response times?',
      provider,
      replayKey,
    );
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toContain('Performance');
  });

  // @lat: [[search#RAG Replay Tests#Incremental index skips unchanged sections]]
  it('incremental index skips unchanged sections', async () => {
    const stats = await indexSections(latDir, db, provider, replayKey);
    expect(stats.unchanged).toBe(9);
    expect(stats.added).toBe(0);
    expect(stats.updated).toBe(0);
    expect(stats.removed).toBe(0);
  });

  // @lat: [[search#RAG Replay Tests#Detects deleted sections when file is removed]]
  it('detects deleted sections when file is removed', async () => {
    rmSync(join(latDir, 'testing.md'));

    const stats = await indexSections(latDir, db, provider, replayKey);
    expect(stats.removed).toBe(4); // testing + unit + integration + performance
    expect(stats.unchanged).toBe(5); // architecture sections remain
  });
});
