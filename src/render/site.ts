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
.admonition { margin:1rem 0; padding:.6rem .9rem; border-left:4px solid var(--accent); border-radius:6px; background:#1b1f29; }
.admonition-title { margin:0 0 .3rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em; font-size:.8rem; }
.admonition > :last-child { margin-bottom:0; }
.admonition-note { border-left-color:#7aa2f7; } .admonition-note .admonition-title { color:#7aa2f7; }
.admonition-tip, .admonition-info { border-left-color:#9ece6a; } .admonition-tip .admonition-title, .admonition-info .admonition-title { color:#9ece6a; }
.admonition-important { border-left-color:#bb9af7; } .admonition-important .admonition-title { color:#bb9af7; }
.admonition-warning, .admonition-caution { border-left-color:#e0af68; } .admonition-warning .admonition-title, .admonition-caution .admonition-title { color:#e0af68; }
.admonition-danger { border-left-color:#f7768e; } .admonition-danger .admonition-title { color:#f7768e; }
.graphlink { font-size:.8rem; font-weight:400; }
.dim { color:var(--dim); }
#graph { display:block; width:100%; height:78vh; border:1px solid var(--border); border-radius:8px; background:#0c0e13; }
.content img, .content table { max-width:100%; }
.content table { display:block; overflow-x:auto; }
/* Mobile: brand + search stay visible; only the (long) section tree collapses
   behind a toggle. Toggle is hidden on desktop where the tree is always shown. */
.navtoggle, .navtoggle-btn { display:none; }
.navtoggle-close { display:none; }
@media (max-width: 800px) {
  .layout { display:block; }
  .sidebar { position:static; max-height:none; border-right:none; border-bottom:1px solid var(--border); }
  #tree { display:none; }
  .navtoggle:checked ~ #tree { display:block; }
  .navtoggle-btn { display:block; margin-top:.6rem; padding:.5rem .7rem; background:var(--bg); border:1px solid var(--border); border-radius:6px; font-weight:600; cursor:pointer; color:var(--fg); user-select:none; }
  .navtoggle:checked ~ .navtoggle-btn .navtoggle-open { display:none; }
  .navtoggle:checked ~ .navtoggle-btn .navtoggle-close { display:inline; }
  .content { padding:1.3rem 1rem; max-width:none; }
  #graph { height:62vh; }
}
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
  /** Ancestor heading path (e.g. "CLI > search"), prepended for BM25 context. */
  ancestors?: string;
  /** L2-normalized dense embedding, present only when built with `--dense`. */
  vec?: number[];
};

/**
 * Embedding model for the static dense index — the SAME model runs in Node at
 * build time and in the browser for the query. `bge-small-en-v1.5` (384-dim)
 * was the best quality-per-byte option in the relevance eval (see
 * `scripts/eval-relevance.ts`). It is asymmetric: queries get
 * [[src/render/site.ts#STATIC_QUERY_PREFIX]], documents are embedded raw.
 */
export const STATIC_EMBED_MODEL = 'Xenova/bge-small-en-v1.5';

/** Instruction prefix bge applies to QUERIES only (documents are embedded raw). */
export const STATIC_QUERY_PREFIX =
  'Represent this sentence for searching relevant passages: ';

/** A ranked search hit returned by [[src/render/site.ts#bm25Search]]. */
export type SearchHit = {
  url: string;
  heading: string;
  firstParagraph: string;
  score: number;
};

/**
 * Pure static search — the scorer shipped to the browser for `lat build`. Always
 * runs BM25 (k1=1.5, b=0.75) over heading + body. When `queryVec` is provided
 * (the page embedded the query in-browser) and docs carry dense `vec`s, it also
 * computes cosine similarity (vectors are L2-normalized, so dot product) and
 * fuses the two min-max-normalized sides as `0.75*dense + 0.25*bm25` — the same
 * weighting as the server-side [[src/search/fusion.ts]]. Returns the top 8 hits.
 *
 * Self-contained (no external references) so it can be injected into the static
 * page verbatim via `.toString()`; the shipped client and the unit tests run
 * identical code. See [[cli#build#Client search]].
 */
export function staticSearch(
  query: string,
  docs: SearchDoc[],
  queryVec: number[] | null,
): SearchHit[] {
  const tok = (s: string): string[] =>
    s.toLowerCase().match(/[a-z0-9]+/g) || [];
  const N = docs.length;
  if (!N) return [];

  const prepared = docs.map((d) => {
    const terms = tok(
      `${d.ancestors ? d.ancestors + ' ' : ''}${d.heading} ${d.text}`,
    );
    const tf: Record<string, number> = {};
    for (const t of terms) tf[t] = (tf[t] || 0) + 1;
    return { d, tf, len: terms.length };
  });
  const df: Record<string, number> = {};
  for (const p of prepared)
    for (const t of Object.keys(p.tf)) df[t] = (df[t] || 0) + 1;
  const avgdl = prepared.reduce((a, x) => a + x.len, 0) / N;
  const qt = tok(query);
  const k1 = 1.5;
  const b = 0.75;
  const bm25 = prepared.map((x) => {
    let s = 0;
    for (const t of qt) {
      const f = x.tf[t];
      if (!f) continue;
      const idf = Math.log(1 + (N - df[t] + 0.5) / (df[t] + 0.5));
      s += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * x.len) / avgdl));
    }
    return s;
  });

  const useDense = !!queryVec && !!prepared[0].d.vec;
  const dense = useDense
    ? prepared.map((x) => {
        const v = x.d.vec;
        if (!v) return 0;
        let s = 0;
        const n = Math.min(v.length, queryVec!.length);
        for (let i = 0; i < n; i++) s += v[i] * queryVec![i];
        return s;
      })
    : null;

  const norm = (arr: number[]): number[] => {
    let mn = Infinity;
    let mx = -Infinity;
    for (const v of arr) {
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    const span = mx - mn;
    return arr.map((v) => (span === 0 ? (mx > 0 ? 1 : 0) : (v - mn) / span));
  };

  const bn = norm(bm25);
  const DENSE_W = 0.75;
  const fused = dense
    ? norm(dense).map((d, i) => DENSE_W * d + (1 - DENSE_W) * bn[i])
    : bn;

  const ranked = prepared
    .map((x, i) => ({
      d: x.d,
      score: fused[i],
      keep: dense ? true : bm25[i] > 0,
    }))
    .filter((x) => x.keep && x.score > 0);
  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, 8).map((x) => ({
    url: x.d.url,
    heading: x.d.heading,
    firstParagraph: x.d.firstParagraph,
    score: x.score,
  }));
}

/** BM25-only convenience wrapper over [[src/render/site.ts#staticSearch]]. */
export function bm25Search(query: string, docs: SearchDoc[]): SearchHit[] {
  return staticSearch(query, docs, null);
}

/**
 * Client-side search over a shipped JSON index (lat build). Lexical BM25 runs
 * immediately; if the index carries dense `vec`s, the query embedder
 * ([[src/render/site.ts#STATIC_EMBED_MODEL]], ~23 MB) is lazy-loaded from a CDN
 * and search upgrades to hybrid once it's ready — a progressive enhancement, so
 * the page works (lexically) even offline. `__INDEX_HREF__` / `__EMBED_MODEL__`
 * are substituted at build time.
 */
const SEARCH_STATIC = `${RENDER_RESULTS}
var staticSearch = ${staticSearch.toString()};
(function(){
  var q = document.getElementById('q'), results = document.getElementById('results');
  var docs = null, extractor = null, t;
  fetch('__INDEX_HREF__').then(function(r){ return r.json(); }).then(function(d){
    docs = d;
    if (d.length && d[0].vec) loadModel();
  });
  function loadModel(){
    import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@4').then(function(m){
      return m.pipeline('feature-extraction', '__EMBED_MODEL__', { dtype: 'q8' });
    }).then(function(p){ extractor = p; }).catch(function(){ /* stay lexical */ });
  }
  async function run(v){
    var qv = null;
    if (extractor) {
      try { var o = await extractor('__QUERY_PREFIX__' + v, { pooling: 'mean', normalize: true }); qv = Array.from(o.data); }
      catch (e) { qv = null; }
    }
    if (docs) renderResults(staticSearch(v, docs, qv), results);
  }
  if (!q) return;
  q.addEventListener('input', function(){
    clearTimeout(t);
    var v = q.value.trim();
    if (!v || !docs) { results.innerHTML = ''; return; }
    t = setTimeout(function(){ run(v); }, 150);
  });
})();`;

export type SearchMode =
  | { mode: 'server' }
  | { mode: 'static'; indexHref: string };

function searchScript(search: SearchMode): string {
  if (search.mode === 'server') return SEARCH_SERVER;
  return SEARCH_STATIC.replace('__INDEX_HREF__', search.indexHref)
    .replace('__EMBED_MODEL__', STATIC_EMBED_MODEL)
    .replace('__QUERY_PREFIX__', STATIC_QUERY_PREFIX);
}

// ── Page assembly ───────────────────────────────────────────────────

export type PageOptions = {
  title: string;
  homeHref: string;
  graphHref: string;
  sidebar: string;
  content: string;
  search: SearchMode;
  /** Extra client script appended after the search script (e.g. the graph view). */
  extraScript?: string;
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
    <div class="brand"><a href="${opts.homeHref}">lat.md</a> <a class="graphlink" href="${opts.graphHref}">graph</a></div>
    <div class="search"><input id="q" type="search" placeholder="Search the graph…" autocomplete="off"></div>
    <div id="results"></div>
    <input type="checkbox" id="navtoggle" class="navtoggle">
    <label for="navtoggle" class="navtoggle-btn"><span class="navtoggle-open">☰ Browse sections</span><span class="navtoggle-close">✕ Hide sections</span></label>
    <nav id="tree">${opts.sidebar}</nav>
  </aside>
  <main class="content">${opts.content}</main>
</div>
<script type="module">
  import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';
  mermaid.initialize({ startOnLoad: true, theme: 'dark' });
</script>
<script>${searchScript(opts.search)}</script>
${opts.extraScript ? `<script>${opts.extraScript}</script>` : ''}
</body></html>`;
}

/** Content block for the graph page: a full-bleed canvas the force sim draws into. */
export function graphPageContent(): string {
  return '<h1>Graph</h1><p class="dim">Force-directed view of the wiki-link graph. Drag nodes, scroll to zoom, click to open.</p><canvas id="graph"></canvas>';
}

/**
 * Vanilla canvas force-directed graph renderer (no deps). Fetches the graph
 * payload from `__GRAPH_HREF__`, simulates repulsion + edge springs + center
 * gravity, and lets the user drag nodes, scroll to zoom, hover for a label, and
 * click to open a section. See [[cli#graph]].
 */
const GRAPH_SCRIPT = `(function(){
  var canvas = document.getElementById('graph'); if (!canvas) return;
  var ctx = canvas.getContext('2d'), W = 0, H = 0;
  function resize(){ W = canvas.width = canvas.clientWidth; H = canvas.height = canvas.clientHeight; }
  fetch('__GRAPH_HREF__').then(function(r){ return r.json(); }).then(function(g){
    resize(); window.addEventListener('resize', resize);
    var nodes = g.nodes.map(function(n){ return { id:n.id, heading:n.heading, url:n.url, x:W/2+(Math.random()-0.5)*300, y:H/2+(Math.random()-0.5)*300, vx:0, vy:0, deg:0 }; });
    var idx = {}; nodes.forEach(function(n,i){ idx[n.id]=i; });
    var edges = g.edges.map(function(e){ return { s:idx[e.source], t:idx[e.target] }; }).filter(function(e){ return e.s!=null && e.t!=null; });
    edges.forEach(function(e){ nodes[e.s].deg++; nodes[e.t].deg++; });
    var hover=null, dragging=null, ox=0, oy=0, scale=1;
    function rOf(n){ return 4 + Math.min(9, n.deg); }
    function tick(){
      for (var i=0;i<nodes.length;i++){ for (var j=i+1;j<nodes.length;j++){ var a=nodes[i],b=nodes[j]; var dx=a.x-b.x,dy=a.y-b.y; var d2=dx*dx+dy*dy+0.01; var d=Math.sqrt(d2); var f=2500/d2; var fx=f*dx/d, fy=f*dy/d; a.vx+=fx;a.vy+=fy;b.vx-=fx;b.vy-=fy; } }
      edges.forEach(function(e){ var a=nodes[e.s],b=nodes[e.t]; var dx=b.x-a.x,dy=b.y-a.y; var d=Math.sqrt(dx*dx+dy*dy)+0.01; var f=(d-90)*0.01; var fx=f*dx/d,fy=f*dy/d; a.vx+=fx;a.vy+=fy;b.vx-=fx;b.vy-=fy; });
      nodes.forEach(function(n){ n.vx+=(W/2-n.x)*0.0015; n.vy+=(H/2-n.y)*0.0015; n.vx*=0.85; n.vy*=0.85; if (n!==dragging){ n.x+=n.vx; n.y+=n.vy; } });
    }
    function draw(){
      ctx.clearRect(0,0,W,H); ctx.save(); ctx.translate(ox,oy); ctx.scale(scale,scale);
      ctx.strokeStyle='rgba(122,162,247,0.18)'; ctx.lineWidth=1;
      edges.forEach(function(e){ var a=nodes[e.s],b=nodes[e.t]; ctx.beginPath(); ctx.moveTo(a.x,a.y); ctx.lineTo(b.x,b.y); ctx.stroke(); });
      nodes.forEach(function(n){ var r=rOf(n); ctx.beginPath(); ctx.arc(n.x,n.y,r,0,7); ctx.fillStyle = n===hover ? '#e0af68' : '#7aa2f7'; ctx.fill(); });
      if (hover){ ctx.fillStyle='#e6e6e6'; ctx.font='13px sans-serif'; ctx.fillText(hover.heading, hover.x+rOf(hover)+4, hover.y+4); }
      ctx.restore();
    }
    function loop(){ for (var k=0;k<2;k++) tick(); draw(); requestAnimationFrame(loop); }
    loop();
    function at(ev){ var rect=canvas.getBoundingClientRect(); return { x:(ev.clientX-rect.left-ox)/scale, y:(ev.clientY-rect.top-oy)/scale }; }
    function pick(p){ for (var i=nodes.length-1;i>=0;i--){ var n=nodes[i], r=rOf(n)+3; if ((n.x-p.x)*(n.x-p.x)+(n.y-p.y)*(n.y-p.y) < r*r) return n; } return null; }
    var moved=false;
    canvas.addEventListener('mousemove', function(ev){ var p=at(ev); if (dragging){ dragging.x=p.x; dragging.y=p.y; dragging.vx=0; dragging.vy=0; moved=true; } else { hover=pick(p); canvas.style.cursor=hover?'pointer':'default'; } });
    canvas.addEventListener('mousedown', function(ev){ dragging=pick(at(ev)); moved=false; });
    canvas.addEventListener('mouseup', function(ev){ var n=pick(at(ev)); if (n && n===dragging && !moved) window.location.href=n.url; dragging=null; });
    canvas.addEventListener('wheel', function(ev){ ev.preventDefault(); scale *= ev.deltaY<0 ? 1.1 : 0.9; }, { passive:false });
  });
})();`;

/** The graph client script with its data URL substituted. */
export function graphScript(graphHref: string): string {
  return GRAPH_SCRIPT.replace('__GRAPH_HREF__', graphHref);
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
