import type { CmdContext, CmdResult } from '../context.js';
/**
 * Build a static HTML site from the lattice — deployable to GitHub Pages with no
 * server. Pages are flat files (`<slug>.html`) so links work under any base
 * path; search is client-side BM25 over a shipped `search-index.json` (see
 * [[cli#build#Client search]]). Reuses the shared page builders in
 * [[src/render/site.ts]], so output matches [[cli#serve]]. See [[cli#build]].
 */
export declare function buildCommand(ctx: CmdContext, opts: {
    out: string;
    dense?: boolean;
}): Promise<CmdResult>;
