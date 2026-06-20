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
export declare const STYLE = "\n:root { color-scheme: dark; --bg:#0f1115; --panel:#171a21; --fg:#e6e6e6; --dim:#9aa4b2; --accent:#7aa2f7; --border:#262b36; }\n* { box-sizing: border-box; }\nbody { margin:0; background:var(--bg); color:var(--fg); font:15px/1.6 -apple-system,BlinkMacSystemFont,\"Segoe UI\",Roboto,sans-serif; }\na { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }\n.layout { display:grid; grid-template-columns:300px 1fr; min-height:100vh; }\n.sidebar { background:var(--panel); border-right:1px solid var(--border); padding:1rem; overflow-y:auto; max-height:100vh; position:sticky; top:0; }\n.brand { font-weight:700; font-size:1.1rem; margin-bottom:.75rem; }\n.brand a { color:var(--fg); }\n.search input { width:100%; padding:.5rem .6rem; background:var(--bg); border:1px solid var(--border); border-radius:6px; color:var(--fg); }\n#results { margin:.5rem 0 1rem; }\n#results .hit { padding:.35rem 0; border-bottom:1px solid var(--border); }\n#results .hit small { color:var(--dim); }\n.filegroup { margin:.6rem 0; }\n.filegroup > summary { cursor:pointer; color:var(--dim); font-weight:600; }\n.filegroup ul { list-style:none; padding-left:.75rem; margin:.3rem 0; }\n.filegroup li { padding:.1rem 0; }\n.content { padding:2rem 2.5rem; max-width:900px; }\n.content h1,.content h2,.content h3 { line-height:1.25; }\n.loc { color:var(--dim); font-size:.85rem; margin-bottom:1rem; }\n.content pre { background:var(--panel); border:1px solid var(--border); padding:.8rem; border-radius:8px; overflow:auto; }\n.content code { background:var(--panel); padding:.1rem .3rem; border-radius:4px; }\n.content pre code { background:none; padding:0; }\n.wikilink.broken { color:#f7768e; border-bottom:1px dotted #f7768e; }\n.srcref { color:#bb9af7; }\n.content iframe { border:1px solid var(--border); border-radius:8px; background:#fff; width:100%; }\n.backlinks { margin-top:2.5rem; border-top:1px solid var(--border); padding-top:1rem; }\n.backlinks h2 { font-size:1rem; color:var(--dim); text-transform:uppercase; letter-spacing:.05em; }\n.backlinks ul { list-style:none; padding:0; } .backlinks li { padding:.25rem 0; }\n.backlinks .desc { color:var(--dim); }\n.coderef { font-family:ui-monospace,monospace; font-size:.85rem; }\n.coderef pre { margin:.3rem 0; }\n";
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
    sidebar: string;
    content: string;
    search: SearchMode;
};
/** Render the full HTML document shell (sidebar + content + scripts). */
export declare function renderPage(opts: PageOptions): string;
/** Sidebar navigation: every section grouped by file, linked via `sectionUrl`. */
export declare function buildSidebar(allSections: Section[], sectionUrl: SectionUrl): string;
/** Section page body: rendered content + backlinks + code back-refs. */
export declare function buildSectionContent(found: SectionFound, resolver: WikiLinkResolver, sectionUrl: SectionUrl): Promise<string>;
