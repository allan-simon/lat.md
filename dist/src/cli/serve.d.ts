import type { CmdContext } from '../context.js';
/**
 * Start the local documentation server. Renders the lattice as an interactive
 * HTML site (section pages + backlinks + live semantic search) by reusing the
 * same command cores as the CLI/MCP — [[src/cli/section.ts#getSection]] for
 * pages and [[src/cli/search.ts#runSearch]] for `/api/search` — and the shared
 * page builders in [[src/render/site.ts]]. See [[cli#serve]].
 */
export declare function serveCommand(ctx: CmdContext, opts: {
    port: number;
}): Promise<void>;
