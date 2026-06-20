import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join, normalize, extname, sep } from 'node:path';
import { loadAllSections, flattenSections, buildFileIndex, resolveRef, } from '../lattice.js';
import { getSection } from './section.js';
import { renderMarkdown, escapeHtml, isSourceTarget, } from '../render/html.js';
/**
 * Build a [[wiki link]] resolver over the current lattice: section targets
 * become `/section?id=...` anchors, source-symbol targets render inert, and
 * anything that doesn't resolve is flagged broken. Shared by every rendered
 * page so links are consistent. See [[cli#serve#Rendering]].
 */
function buildResolver(allSections) {
    const flat = flattenSections(allSections);
    const sectionIds = new Set(flat.map((s) => s.id.toLowerCase()));
    const fileIndex = buildFileIndex(allSections);
    const byId = new Map(flat.map((s) => [s.id.toLowerCase(), s]));
    return (target) => {
        if (isSourceTarget(target))
            return { kind: 'source', label: target };
        const { resolved } = resolveRef(target, sectionIds, fileIndex);
        const section = byId.get(resolved.toLowerCase());
        if (section) {
            return {
                kind: 'section',
                href: `/section?id=${encodeURIComponent(section.id)}`,
                label: lastSegment(section.id),
            };
        }
        return { kind: 'broken', label: target };
    };
}
/** Trailing `#`-delimited segment of a section id (its own heading). */
function lastSegment(id) {
    const parts = id.split('#');
    return parts[parts.length - 1] || id;
}
// ── HTML shell ──────────────────────────────────────────────────────
const STYLE = `
:root { color-scheme: dark; --bg:#0f1115; --panel:#171a21; --fg:#e6e6e6; --dim:#9aa4b2; --accent:#7aa2f7; --border:#262b36; }
* { box-sizing: border-box; }
body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
.layout { display:grid; grid-template-columns:300px 1fr; min-height:100vh; }
.sidebar { background:var(--panel); border-right:1px solid var(--border); padding:1rem; overflow-y:auto; max-height:100vh; position:sticky; top:0; }
.brand { font-weight:700; font-size:1.1rem; margin-bottom:.75rem; }
.brand a { color:var(--fg); }
.search input { width:100%; padding:.5rem .6rem; background:var(--bg); border:1px solid var(--border); border-radius:6px; color:var(--fg); }
#results { margin:.5rem 0 1rem; }
#results .hit { padding:.35rem 0; border-bottom:1px solid var(--border); }
#results .hit small { color:var(--dim); }
.filegroup { margin:.6rem 0; }
.filegroup > summary { cursor:pointer; color:var(--dim); font-weight:600; }
.filegroup ul { list-style:none; padding-left:.75rem; margin:.3rem 0; }
.filegroup li { padding:.1rem 0; }
.content { padding:2rem 2.5rem; max-width:900px; }
.content h1,.content h2,.content h3 { line-height:1.25; }
.loc { color:var(--dim); font-size:.85rem; margin-bottom:1rem; }
.content pre { background:var(--panel); border:1px solid var(--border); padding:.8rem; border-radius:8px; overflow:auto; }
.content code { background:var(--panel); padding:.1rem .3rem; border-radius:4px; }
.content pre code { background:none; padding:0; }
.wikilink.broken { color:#f7768e; border-bottom:1px dotted #f7768e; }
.srcref { color:#bb9af7; }
.content iframe { border:1px solid var(--border); border-radius:8px; background:#fff; width:100%; }
.backlinks { margin-top:2.5rem; border-top:1px solid var(--border); padding-top:1rem; }
.backlinks h2 { font-size:1rem; color:var(--dim); text-transform:uppercase; letter-spacing:.05em; }
.backlinks ul { list-style:none; padding:0; } .backlinks li { padding:.25rem 0; }
.backlinks .desc { color:var(--dim); }
.coderef { font-family:ui-monospace,monospace; font-size:.85rem; }
.coderef pre { margin:.3rem 0; }
`;
function page(title, body) {
    return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head><body>
<div class="layout">
  <aside class="sidebar">
    <div class="brand"><a href="/">lat.md</a></div>
    <div class="search"><input id="q" type="search" placeholder="Search the graph…" autocomplete="off"></div>
    <div id="results"></div>
    <nav id="tree">${body.startsWith('<!--tree-->') ? body.slice(10) : ''}</nav>
  </aside>
  <main class="content">${body.startsWith('<!--tree-->') ? '' : body}</main>
</div>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, theme: 'dark' });
</script>
<script>
  const q = document.getElementById('q');
  const results = document.getElementById('results');
  let t;
  q && q.addEventListener('input', () => {
    clearTimeout(t);
    const v = q.value.trim();
    if (!v) { results.innerHTML = ''; return; }
    t = setTimeout(async () => {
      const r = await fetch('/api/search?q=' + encodeURIComponent(v));
      const data = await r.json();
      results.innerHTML = data.matches.map(m =>
        '<div class="hit"><a href="/section?id=' + encodeURIComponent(m.id) + '">' +
        m.heading + '</a> <small>' + (m.score!=null?m.score.toFixed(2):'') + '</small>' +
        (m.firstParagraph ? '<br><small>' + m.firstParagraph + '</small>' : '') +
        '</div>').join('');
    }, 180);
  });
</script>
</body></html>`;
}
// ── Page builders ───────────────────────────────────────────────────
function indexBody(allSections) {
    // Group top-level files; list each file's sections as links.
    const flat = flattenSections(allSections);
    const byFile = new Map();
    for (const s of flat) {
        const arr = byFile.get(s.filePath) ?? [];
        arr.push(s);
        byFile.set(s.filePath, arr);
    }
    const groups = [];
    for (const [file, sections] of [...byFile.entries()].sort()) {
        const items = sections
            .map((s) => {
            const indent = '— '.repeat(Math.max(0, s.depth - 1));
            return `<li>${escapeHtml(indent)}<a href="/section?id=${encodeURIComponent(s.id)}">${escapeHtml(lastSegment(s.id))}</a></li>`;
        })
            .join('');
        groups.push(`<details class="filegroup" open><summary>${escapeHtml(file)}</summary><ul>${items}</ul></details>`);
    }
    return '<!--tree-->' + groups.join('');
}
async function sectionBody(found, resolver) {
    const { section, content, incomingRefs, outgoingRefs, codeRefs } = found;
    const html = await renderMarkdown(content, resolver);
    const parts = [];
    parts.push(`<div class="loc">${escapeHtml(section.filePath)}:${section.startLine}-${section.endLine}</div>`);
    parts.push(`<article>${html}</article>`);
    if (incomingRefs.length) {
        const items = incomingRefs
            .map((m) => {
            const desc = m.section.firstParagraph
                ? ` <span class="desc">— ${escapeHtml(m.section.firstParagraph)}</span>`
                : '';
            return `<li><a href="/section?id=${encodeURIComponent(m.section.id)}">${escapeHtml(m.section.id)}</a>${desc}</li>`;
        })
            .join('');
        parts.push(`<section class="backlinks"><h2>Referenced by</h2><ul>${items}</ul></section>`);
    }
    if (outgoingRefs.length) {
        const items = outgoingRefs
            .map((r) => `<li><a href="/section?id=${encodeURIComponent(r.resolved.id)}">${escapeHtml(r.resolved.id)}</a></li>`)
            .join('');
        parts.push(`<section class="backlinks"><h2>References</h2><ul>${items}</ul></section>`);
    }
    if (codeRefs.length) {
        const items = codeRefs
            .map((c) => `<li class="coderef">${escapeHtml(c.file)}:${c.line}` +
            (c.snippet
                ? `<pre><code>${escapeHtml(c.snippet)}</code></pre>`
                : '') +
            `</li>`)
            .join('');
        parts.push(`<section class="backlinks"><h2>Referenced by code</h2><ul>${items}</ul></section>`);
    }
    return parts.join('\n');
}
// ── Widget static files ─────────────────────────────────────────────
const MIME = {
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
async function serveWidget(latDir, reqPath) {
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
    }
    catch {
        return { status: 404, type: 'text/plain', body: 'Not found' };
    }
}
// ── Server ──────────────────────────────────────────────────────────
/**
 * Start the local documentation server. Renders the lattice as an interactive
 * HTML site (section pages + backlinks + live semantic search) by reusing the
 * same command cores as the CLI/MCP — [[src/cli/section.ts#getSection]] for
 * pages and [[src/cli/search.ts#runSearch]] for `/api/search`. See [[cli#serve]].
 */
export async function serveCommand(ctx, opts) {
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
                let key;
                try {
                    key = getEffectiveKey();
                }
                catch {
                    key = 'local';
                }
                const result = query
                    ? await runSearch(ctx.latDir, query, key, limit)
                    : { matches: [] };
                const matches = result.matches.map((m) => ({
                    id: m.section.id,
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
            const resolver = buildResolver(allSections);
            if (path === '/' || path === '') {
                res
                    .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
                    .end(page('lat.md', indexBody(allSections)));
                return;
            }
            if (path === '/section') {
                const id = url.searchParams.get('id') ?? '';
                const found = await getSection(ctx, id);
                if (found.kind !== 'found') {
                    res
                        .writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
                        .end(page('Not found', `<p>No section <code>${escapeHtml(id)}</code>.</p>`));
                    return;
                }
                const body = await sectionBody(found, resolver);
                res
                    .writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
                    .end(page(lastSegment(found.section.id), body));
                return;
            }
            res
                .writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' })
                .end(page('Not found', '<p>Not found.</p>'));
        }
        catch (err) {
            res
                .writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' })
                .end(`Server error: ${err.message}`);
        }
    });
    await new Promise((resolve) => {
        server.listen(opts.port, () => {
            process.stderr.write(ctx.styler.green(`lat.md docs server running at http://localhost:${opts.port}\n`));
            process.stderr.write(ctx.styler.dim('Press Ctrl+C to stop.\n'));
            resolve();
        });
    });
}
