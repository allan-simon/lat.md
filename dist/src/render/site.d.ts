import { type Section } from '../lattice.js';
import type { SectionFound } from '../cli/section.js';
import { type WikiLinkResolver } from './html.js';
/**
 * Maps a section id to the URL it lives at. `lat serve` returns a query route
 * (`/section?id=…`); `lat build` returns a flat static file (`<slug>.html`).
 * Threading this through the shared builders is what lets both targets emit
 * identical markup. See [[cli#serve]] and [[cli#build]].
 */
export type SectionUrl = (id: string) => string;
/** Trailing `#`-delimited segment of a section id (its own heading). */
export declare function lastSegment(id: string): string;
/**
 * Build a [[wiki link]] resolver over the lattice: section targets become links
 * (via `sectionUrl`), source-symbol targets render inert, and unresolved targets
 * are flagged broken. Shared by `serve` and `build` so links are consistent.
 */
export declare function buildResolver(allSections: Section[], sectionUrl: SectionUrl): WikiLinkResolver;
export declare const STYLE = "\n:root { color-scheme: dark; --bg:#0f1115; --panel:#171a21; --fg:#e6e6e6; --dim:#9aa4b2; --accent:#7aa2f7; --border:#262b36; }\n* { box-sizing: border-box; }\nbody { margin:0; background:var(--bg); color:var(--fg); font:15px/1.6 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif; }\na { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }\n.layout { display:grid; grid-template-columns:300px 1fr; min-height:100vh; }\n.sidebar { background:var(--panel); border-right:1px solid var(--border); padding:1rem; overflow-y:auto; max-height:100vh; position:sticky; top:0; }\n.brand { font-weight:700; font-size:1.1rem; margin-bottom:.75rem; }\n.brand a { color:var(--fg); }\n.search input { width:100%; padding:.5rem .6rem; background:var(--bg); border:1px solid var(--border); border-radius:6px; color:var(--fg); }\n#results { margin:.5rem 0 1rem; }\n#results .hit { padding:.35rem 0; border-bottom:1px solid var(--border); }\n#results .hit small { color:var(--dim); }\n.filegroup { margin:.6rem 0; }\n.filegroup > summary { cursor:pointer; color:var(--dim); font-weight:600; }\n.filegroup ul { list-style:none; padding-left:.75rem; margin:.3rem 0; }\n.filegroup li { padding:.1rem 0; }\n.content { padding:2rem 2.5rem; max-width:900px; }\n.content h1,.content h2,.content h3 { line-height:1.25; }\n.loc { color:var(--dim); font-size:.85rem; margin-bottom:1rem; }\n.content pre { background:var(--panel); border:1px solid var(--border); padding:.8rem; border-radius:8px; overflow:auto; }\n.content code { background:var(--panel); padding:.1rem .3rem; border-radius:4px; }\n.content pre code { background:none; padding:0; }\n.wikilink.broken { color:#f7768e; border-bottom:1px dotted #f7768e; }\n.srcref { color:#bb9af7; }\n.content iframe { border:1px solid var(--border); border-radius:8px; background:#fff; width:100%; }\n.backlinks { margin-top:2.5rem; border-top:1px solid var(--border); padding-top:1rem; }\n.backlinks h2 { font-size:1rem; color:var(--dim); text-transform:uppercase; letter-spacing:.05em; }\n.backlinks ul { list-style:none; padding:0; } .backlinks li { padding:.25rem 0; }\n.backlinks .desc { color:var(--dim); }\n.coderef { font-family:ui-monospace,monospace; font-size:.85rem; }\n.coderef pre { margin:.3rem 0; }\n.admonition { margin:1rem 0; padding:.6rem .9rem; border-left:4px solid var(--accent); border-radius:6px; background:#1b1f29; }\n.admonition-title { margin:0 0 .3rem; font-weight:700; text-transform:uppercase; letter-spacing:.04em; font-size:.8rem; }\n.admonition > :last-child { margin-bottom:0; }\n.admonition-note { border-left-color:#7aa2f7; } .admonition-note .admonition-title { color:#7aa2f7; }\n.admonition-tip, .admonition-info { border-left-color:#9ece6a; } .admonition-tip .admonition-title, .admonition-info .admonition-title { color:#9ece6a; }\n.admonition-important { border-left-color:#bb9af7; } .admonition-important .admonition-title { color:#bb9af7; }\n.admonition-warning, .admonition-caution { border-left-color:#e0af68; } .admonition-warning .admonition-title, .admonition-caution .admonition-title { color:#e0af68; }\n.admonition-danger { border-left-color:#f7768e; } .admonition-danger .admonition-title { color:#f7768e; }\n.graphlink { font-size:.8rem; font-weight:400; }\n.dim { color:var(--dim); }\n#graph { display:block; width:100%; height:78vh; border:1px solid var(--border); border-radius:8px; background:#0c0e13; }\n.content img, .content table { max-width:100%; }\n.content table { display:block; overflow-x:auto; }\n/* Mobile: brand + search stay visible; only the (long) section tree collapses\n   behind a toggle. Toggle is hidden on desktop where the tree is always shown. */\n.navtoggle, .navtoggle-btn { display:none; }\n.navtoggle-close { display:none; }\n@media (max-width: 800px) {\n  .layout { display:block; }\n  .sidebar { position:static; max-height:none; border-right:none; border-bottom:1px solid var(--border); }\n  #tree { display:none; }\n  .navtoggle:checked ~ #tree { display:block; }\n  .navtoggle-btn { display:block; margin-top:.6rem; padding:.5rem .7rem; background:var(--bg); border:1px solid var(--border); border-radius:6px; font-weight:600; cursor:pointer; color:var(--fg); user-select:none; }\n  .navtoggle:checked ~ .navtoggle-btn .navtoggle-open { display:none; }\n  .navtoggle:checked ~ .navtoggle-btn .navtoggle-close { display:inline; }\n  .content { padding:1.3rem 1rem; max-width:none; }\n  #graph { height:62vh; }\n}\n";
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
export declare const STATIC_EMBED_MODEL = "Xenova/bge-small-en-v1.5";
/** Instruction prefix bge applies to QUERIES only (documents are embedded raw). */
export declare const STATIC_QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";
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
export declare function staticSearch(query: string, docs: SearchDoc[], queryVec: number[] | null): SearchHit[];
/** BM25-only convenience wrapper over [[src/render/site.ts#staticSearch]]. */
export declare function bm25Search(query: string, docs: SearchDoc[]): SearchHit[];
export type SearchMode = {
    mode: 'server';
} | {
    mode: 'static';
    indexHref: string;
};
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
export declare function renderPage(opts: PageOptions): string;
/** Content block for the graph page: a full-bleed canvas the force sim draws into. */
export declare function graphPageContent(): string;
/** The graph client script with its data URL substituted. */
export declare function graphScript(graphHref: string): string;
/** Sidebar navigation: every section grouped by file, linked via `sectionUrl`. */
export declare function buildSidebar(allSections: Section[], sectionUrl: SectionUrl): string;
/** Section page body: rendered content + backlinks + code back-refs. */
export declare function buildSectionContent(found: SectionFound, resolver: WikiLinkResolver, sectionUrl: SectionUrl): Promise<string>;
/**
 * Landing-page content: an overview + first pointers, so the index isn't a
 * dead end. Renders the curated root index file (`lat.md/lat.md`) if present —
 * the maintainer's own overview + linked list of top-level areas — and appends
 * auto-derived "entry points": the most-referenced concrete sections (hubs in
 * the [[parser#Wiki Links]] graph). See [[cli#serve]] / [[cli#build]].
 */
export declare function buildIndexContent(latDir: string, allSections: Section[], sectionUrl: SectionUrl, graphHref: string, edges: {
    source: string;
    target: string;
}[]): Promise<string>;
