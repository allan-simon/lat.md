import {
  flattenSections,
  buildFileIndex,
  resolveRef,
  type Section,
} from '../lattice.js';
import type { SectionFound } from '../cli/section.js';
import {
  renderMarkdown,
  escapeHtml,
  isSourceTarget,
  type WikiLinkResolver,
} from './html.js';

/**
 * Maps a section id to the URL it lives at. `lat serve` returns a query route
 * (`/section?id=…`); `lat build` returns a flat static file (`<slug>.html`).
 * Threading this through the shared builders is what lets both targets emit
 * identical markup. See [[cli#serve]] and [[cli#build]].
 */
export type SectionUrl = (id: string) => string;

/** Trailing `#`-delimited segment of a section id (its own heading). */
export function lastSegment(id: string): string {
  const parts = id.split('#');
  return parts[parts.length - 1] || id;
}

/**
 * Build a [[wiki link]] resolver over the lattice: section targets become links
 * (via `sectionUrl`), source-symbol targets render inert, and unresolved targets
 * are flagged broken. Shared by `serve` and `build` so links are consistent.
 */
export function buildResolver(
  allSections: Section[],
  sectionUrl: SectionUrl,
): WikiLinkResolver {
  const flat = flattenSections(allSections);
  const sectionIds = new Set(flat.map((s) => s.id.toLowerCase()));
  const fileIndex = buildFileIndex(allSections);
  const byId = new Map(flat.map((s) => [s.id.toLowerCase(), s]));

  return (target: string) => {
    if (isSourceTarget(target)) return { kind: 'source', label: target };
    const { resolved } = resolveRef(target, sectionIds, fileIndex);
    const section = byId.get(resolved.toLowerCase());
    if (section) {
      return {
        kind: 'section',
        href: sectionUrl(section.id),
        label: lastSegment(section.id),
      };
    }
    return { kind: 'broken', label: target };
  };
}

// ── Styles ──────────────────────────────────────────────────────────

export const STYLE = `
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

// ── Search client scripts (server vs static) ────────────────────────

/** Shared renderer for a result list; both modes produce `{url,heading,score,firstParagraph}`. */
const RENDER_RESULTS = `
function renderResults(results, el) {
  el.innerHTML = results.map(function(m) {
    return '<div class="hit"><a href="' + m.url + '">' + m.heading + '</a> ' +
      '<small>' + (m.score != null ? Number(m.score).toFixed(2) : '') + '</small>' +
      (m.firstParagraph ? '<br><small>' + m.firstParagraph + '</small>' : '') +
      '</div>';
  }).join('');
}`;

/** Live search backed by the server's /api/search endpoint (lat serve). */
const SEARCH_SERVER = `${RENDER_RESULTS}
(function(){
  var q = document.getElementById('q'), results = document.getElementById('results'), t;
  if (!q) return;
  q.addEventListener('input', function(){
    clearTimeout(t);
    var v = q.value.trim();
    if (!v) { results.innerHTML = ''; return; }
    t = setTimeout(async function(){
      var r = await fetch('/api/search?q=' + encodeURIComponent(v));
      var data = await r.json();
      renderResults(data.matches, results);
    }, 180);
  });
})();`;

/** A document in the static search index (shipped as `search-index.json`). */
export type SearchDoc = {
  url: string;
  heading: string;
  firstParagraph: string;
  text: string;
};

/** A ranked search hit returned by [[src/render/site.ts#bm25Search]]. */
export type SearchHit = {
  url: string;
  heading: string;
  firstParagraph: string;
  score: number;
};

/**
 * Pure BM25 search over the static index — the lexical scorer shipped to the
 * browser for `lat build`. Tokenizes on `[a-z0-9]+`, scores heading + body with
 * standard BM25 (k1=1.5, b=0.75), returns the top 8 hits. This same function is
 * injected into the static page via `.toString()` (so the shipped client and the
 * unit tests run identical code) and called directly in tests. The dense upgrade
 * (Qwen via WASM) is a future enhancement; see [[cli#build#Client search]].
 */
export function bm25Search(query: string, docs: SearchDoc[]): SearchHit[] {
  const tok = (s: string): string[] =>
    s.toLowerCase().match(/[a-z0-9]+/g) || [];
  const N = docs.length;
  const prepared = docs.map((d) => {
    const terms = tok(`${d.heading} ${d.text}`);
    const tf: Record<string, number> = {};
    for (const t of terms) tf[t] = (tf[t] || 0) + 1;
    return { d, tf, len: terms.length };
  });
  const df: Record<string, number> = {};
  for (const p of prepared)
    for (const t of Object.keys(p.tf)) df[t] = (df[t] || 0) + 1;
  const avgdl = prepared.reduce((a, x) => a + x.len, 0) / (N || 1);
  const qt = tok(query);
  const k1 = 1.5;
  const b = 0.75;
  const scored = prepared
    .map((x) => {
      let s = 0;
      for (const t of qt) {
        const f = x.tf[t];
        if (!f) continue;
        const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
        s += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * x.len) / avgdl));
      }
      return { d: x.d, score: s };
    })
    .filter((x) => x.score > 0);
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 8).map((x) => ({
    url: x.d.url,
    heading: x.d.heading,
    firstParagraph: x.d.firstParagraph,
    score: x.score,
  }));
}

/**
 * Client-side search over a shipped JSON index (lat build). No server, no
 * embeddings — lexical BM25 only, via [[src/render/site.ts#bm25Search]] injected
 * verbatim. `__INDEX_HREF__` is replaced at build time.
 */
const SEARCH_STATIC = `${RENDER_RESULTS}
var bm25Search = ${bm25Search.toString()};
(function(){
  var q = document.getElementById('q'), results = document.getElementById('results'), docs = null, t;
  fetch('__INDEX_HREF__').then(function(r){ return r.json(); }).then(function(d){ docs = d; });
  if (!q) return;
  q.addEventListener('input', function(){
    clearTimeout(t);
    var v = q.value.trim();
    if (!v || !docs) { results.innerHTML = ''; return; }
    t = setTimeout(function(){ renderResults(bm25Search(v, docs), results); }, 120);
  });
})();`;

export type SearchMode =
  | { mode: 'server' }
  | { mode: 'static'; indexHref: string };

function searchScript(search: SearchMode): string {
  if (search.mode === 'server') return SEARCH_SERVER;
  return SEARCH_STATIC.replace('__INDEX_HREF__', search.indexHref);
}

// ── Page assembly ───────────────────────────────────────────────────

export type PageOptions = {
  title: string;
  homeHref: string;
  sidebar: string;
  content: string;
  search: SearchMode;
};

/** Render the full HTML document shell (sidebar + content + scripts). */
export function renderPage(opts: PageOptions): string {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(opts.title)}</title>
<style>${STYLE}</style>
</head><body>
<div class="layout">
  <aside class="sidebar">
    <div class="brand"><a href="${opts.homeHref}">lat.md</a></div>
    <div class="search"><input id="q" type="search" placeholder="Search the graph…" autocomplete="off"></div>
    <div id="results"></div>
    <nav id="tree">${opts.sidebar}</nav>
  </aside>
  <main class="content">${opts.content}</main>
</div>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, theme: 'dark' });
</script>
<script>${searchScript(opts.search)}</script>
</body></html>`;
}

/** Sidebar navigation: every section grouped by file, linked via `sectionUrl`. */
export function buildSidebar(
  allSections: Section[],
  sectionUrl: SectionUrl,
): string {
  const flat = flattenSections(allSections);
  const byFile = new Map<string, Section[]>();
  for (const s of flat) {
    const arr = byFile.get(s.filePath) ?? [];
    arr.push(s);
    byFile.set(s.filePath, arr);
  }
  const groups: string[] = [];
  for (const [file, sections] of [...byFile.entries()].sort()) {
    const items = sections
      .map((s) => {
        const indent = '— '.repeat(Math.max(0, s.depth - 1));
        return `<li>${escapeHtml(indent)}<a href="${sectionUrl(
          s.id,
        )}">${escapeHtml(lastSegment(s.id))}</a></li>`;
      })
      .join('');
    groups.push(
      `<details class="filegroup" open><summary>${escapeHtml(
        file,
      )}</summary><ul>${items}</ul></details>`,
    );
  }
  return groups.join('');
}

/** Section page body: rendered content + backlinks + code back-refs. */
export async function buildSectionContent(
  found: SectionFound,
  resolver: WikiLinkResolver,
  sectionUrl: SectionUrl,
): Promise<string> {
  const { section, content, incomingRefs, outgoingRefs, codeRefs } = found;
  const html = await renderMarkdown(content, resolver);

  const parts: string[] = [];
  parts.push(
    `<div class="loc">${escapeHtml(section.filePath)}:${section.startLine}-${section.endLine}</div>`,
  );
  parts.push(`<article>${html}</article>`);

  if (incomingRefs.length) {
    const items = incomingRefs
      .map((m) => {
        const desc = m.section.firstParagraph
          ? ` <span class="desc">— ${escapeHtml(m.section.firstParagraph)}</span>`
          : '';
        return `<li><a href="${sectionUrl(m.section.id)}">${escapeHtml(
          m.section.id,
        )}</a>${desc}</li>`;
      })
      .join('');
    parts.push(
      `<section class="backlinks"><h2>Referenced by</h2><ul>${items}</ul></section>`,
    );
  }

  if (outgoingRefs.length) {
    const items = outgoingRefs
      .map(
        (r) =>
          `<li><a href="${sectionUrl(r.resolved.id)}">${escapeHtml(
            r.resolved.id,
          )}</a></li>`,
      )
      .join('');
    parts.push(
      `<section class="backlinks"><h2>References</h2><ul>${items}</ul></section>`,
    );
  }

  if (codeRefs.length) {
    const items = codeRefs
      .map(
        (c) =>
          `<li class="coderef">${escapeHtml(c.file)}:${c.line}` +
          (c.snippet
            ? `<pre><code>${escapeHtml(c.snippet)}</code></pre>`
            : '') +
          `</li>`,
      )
      .join('');
    parts.push(
      `<section class="backlinks"><h2>Referenced by code</h2><ul>${items}</ul></section>`,
    );
  }

  return parts.join('\n');
}
