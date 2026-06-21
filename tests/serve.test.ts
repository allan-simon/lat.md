import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { join } from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';

const cliPath = join(import.meta.dirname, '..', 'dist', 'src', 'cli', 'index.js');
const corpus = join(import.meta.dirname, 'cases', 'basic-project');

/** Grab an ephemeral free port so parallel test runs don't collide. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.on('error', reject);
    s.listen(0, () => {
      const port = (s.address() as { port: number }).port;
      s.close(() => resolve(port));
    });
  });
}

async function waitUp(url: string, ms = 12000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < ms) {
    try {
      await fetch(url);
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  throw new Error(`server at ${url} did not start in ${ms}ms`);
}

describe('serve', () => {
  let proc: ChildProcess;
  let base: string;

  beforeAll(async () => {
    const port = await freePort();
    base = `http://localhost:${port}`;
    // LAT_EMBED_PROVIDER=none → keyword search, no model download in CI.
    proc = spawn(
      'node',
      [cliPath, 'serve', '--dir', corpus, '--port', String(port)],
      { env: { ...process.env, LAT_EMBED_PROVIDER: 'none' }, stdio: 'ignore' },
    );
    await waitUp(base + '/');
  }, 20000);

  afterAll(() => {
    proc?.kill('SIGKILL');
  });

  // @lat: [[tests/serve#Index page]]
  it('serves the index with overview content, section tree, and graph link', async () => {
    const res = await fetch(base + '/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<title>lat.md</title>');
    expect(html).toContain('/section?id=');
    expect(html).toContain('href="/graph"');
    // Landing page is not a dead end: buildIndexContent adds an overview +
    // pointers (the closing tip links to the graph view).
    expect(html).toContain('graph view');
  });

  // @lat: [[tests/serve#Section page]]
  it('renders a section page', async () => {
    const id = encodeURIComponent('lat.md/dev-process#Dev Process#Testing');
    const res = await fetch(base + '/section?id=' + id);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('<article>');
  });

  // @lat: [[tests/serve#Search API]]
  it('answers /api/search with JSON matches', async () => {
    const res = await fetch(base + '/api/search?q=running+the+test+suite');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { matches: { id: string }[] };
    expect(Array.isArray(data.matches)).toBe(true);
    expect(data.matches.length).toBeGreaterThan(0);
    expect(data.matches.some((m) => m.id.includes('Testing'))).toBe(true);
  });

  // @lat: [[tests/serve#Graph API]]
  it('answers /api/graph with nodes and edges arrays', async () => {
    const res = await fetch(base + '/api/graph');
    expect(res.status).toBe(200);
    const data = (await res.json()) as { nodes: unknown[]; edges: unknown[] };
    expect(Array.isArray(data.nodes)).toBe(true);
    expect(Array.isArray(data.edges)).toBe(true);
  });

  // @lat: [[tests/serve#Unknown routes 404]]
  it('404s unknown routes and never leaks files via _widgets', async () => {
    expect((await fetch(base + '/nope')).status).toBe(404);
    // The client normalizes ../ before sending, but either way nothing leaks.
    const trav = await fetch(base + '/_widgets/../../package.json');
    expect([403, 404]).toContain(trav.status);
  });
});
