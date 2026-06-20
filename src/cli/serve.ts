import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import { loadAllSections } from '../lattice.js';
import type { CmdContext } from '../context.js';
import { getSection } from './section.js';
import { escapeHtml } from '../render/html.js';
import {
  buildResolver,
  buildSidebar,
  buildSectionContent,
  renderPage,
  graphPageContent,
  graphScript,
  lastSegment,
  type SectionUrl,
} from '../render/site.js';
import { collectEdges, buildGraphData } from '../graph.js';

/** Section URL scheme for the live server: a query route handled by `/section`. */
const sectionUrl: SectionUrl = (id) => `/section?id=${encodeURIComponent(id)}`;
const GRAPH_HREF = '/graph';

// ── Widget static files ─────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.gif': 'image/gif',
};

/**
 * Serve a file from `lat.md/_widgets/`, guarding against path traversal. This is
 * how interactive mini-apps (see the agent template's "Rich & interactive
 * content") are delivered, embedded by section pages via `<iframe>`.
 */
async function serveWidget(
  latDir: string,
  reqPath: string,
): Promise<{ status: number; type: string; body: Buffer | string }> {
  const rel = decodeURIComponent(reqPath.slice('/_widgets/'.length));
  const widgetsDir = join(latDir, '_widgets');
  const abs = normalize(join(widgetsDir, rel));
  if (abs !== widgetsDir && !abs.startsWith(widgetsDir + sep)) {
    return { status: 403, type: 'text/plain', body: 'Forbidden' };
  }
  try {
    const buf = await readFile(abs);
    return {
      status: 200,
      type: MIME[extname(abs)] ?? 'application/octet-stream',
      body: buf,
    };
  } catch {
    return { status: 404, type: 'text/plain', body: 'Not found' };
  }
}

// ── Server ──────────────────────────────────────────────────────────

/**
 * Start the local documentation server. Renders the lattice as an interactive
 * HTML site (section pages + backlinks + live semantic search) by reusing the
 * same command cores as the CLI/MCP — [[src/cli/section.ts#getSection]] for
 * pages and [[src/cli/search.ts#runSearch]] for `/api/search` — and the shared
 * page builders in [[src/render/site.ts]]. See [[cli#serve]].
 */
export async function serveCommand(
  ctx: CmdContext,
  opts: { port: number },
): Promise<void> {
  const { runSearch } = await import('./search.js');
  const { getEffectiveKey } = await import('../config.js');

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const path = url.pathname;

      if (path === '/favicon.ico') {
        res.writeHead(204).end();
        return;
      }

      if (path.startsWith('/_widgets/')) {
        const out = await serveWidget(ctx.latDir, path);
        res.writeHead(out.status, { 'Content-Type': out.type }).end(out.body);
        return;
      }

      if (path === '/api/search') {
        const query = url.searchParams.get('q') ?? '';
        const limit = Number(url.searchParams.get('limit') ?? '8') || 8;
        let key: string | undefined;
        try {
          key = getEffectiveKey();
        } catch {
          key = 'local';
        }
        const result = query
          ? await runSearch(ctx.latDir, query, key, limit)
          : { matches: [] };
        const matches = result.matches.map((m) => ({
          id: m.section.id,
          url: sectionUrl(m.section.id),
          heading: m.section.heading,
          file: m.section.filePath,
          firstParagraph: m.section.firstParagraph,
          reason: m.reason,
          score: m.score ?? null,
        }));
        res
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ matches }));
        return;
      }

      // Reload sections per navigation so edits show on refresh (no watcher
      // needed for a local docs server).
      const allSections = await loadAllSections(ctx.latDir);
      const resolver = buildResolver(allSections, sectionUrl);

      if (path === '/' || path === '') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
          renderPage({
            title: 'lat.md',
            homeHref: '/',
            graphHref: GRAPH_HREF,
            sidebar: buildSidebar(allSections, sectionUrl),
            content: '',
            search: { mode: 'server' },
          }),
        );
        return;
      }

      if (path === '/section') {
        const id = url.searchParams.get('id') ?? '';
        const found = await getSection(ctx, id);
        if (found.kind !== 'found') {
          res
            .writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
            .end(
              renderPage({
                title: 'Not found',
                homeHref: '/',
                graphHref: GRAPH_HREF,
                sidebar: buildSidebar(allSections, sectionUrl),
                content: `<p>No section <code>${escapeHtml(id)}</code>.</p>`,
                search: { mode: 'server' },
              }),
            );
          return;
        }
        const content = await buildSectionContent(found, resolver, sectionUrl);
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
          renderPage({
            title: lastSegment(found.section.id),
            homeHref: '/',
            graphHref: GRAPH_HREF,
            sidebar: buildSidebar(allSections, sectionUrl),
            content,
            search: { mode: 'server' },
          }),
        );
        return;
      }

      if (path === '/api/graph') {
        const edges = await collectEdges(
          ctx.latDir,
          ctx.projectRoot,
          allSections,
        );
        const data = buildGraphData(allSections, edges, sectionUrl);
        res
          .writeHead(200, { 'Content-Type': 'application/json' })
          .end(JSON.stringify(data));
        return;
      }

      if (path === '/graph') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(
          renderPage({
            title: 'Graph',
            homeHref: '/',
            graphHref: GRAPH_HREF,
            sidebar: buildSidebar(allSections, sectionUrl),
            content: graphPageContent(),
            search: { mode: 'server' },
            extraScript: graphScript('/api/graph'),
          }),
        );
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }).end(
        renderPage({
          title: 'Not found',
          homeHref: '/',
          graphHref: GRAPH_HREF,
          sidebar: buildSidebar(allSections, sectionUrl),
          content: '<p>Not found.</p>',
          search: { mode: 'server' },
        }),
      );
    } catch (err) {
      res
        .writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
        .end(`Server error: ${(err as Error).message}`);
    }
  });

  await new Promise<void>((resolve) => {
    server.listen(opts.port, () => {
      process.stderr.write(
        ctx.styler.green(
          `lat.md docs server running at http://localhost:${opts.port}\n`,
        ),
      );
      process.stderr.write(ctx.styler.dim('Press Ctrl+C to stop.\n'));
      resolve();
    });
  });
}
