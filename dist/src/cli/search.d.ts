import type { CmdContext, CmdResult, Styler } from '../context.js';
import { type IndexStats } from '../search/index.js';
import { type SectionMatch } from '../lattice.js';
export type SearchResult = {
    query: string;
    matches: SectionMatch[];
    /** True when results came from the keyword fallback (no embeddings). */
    degraded?: boolean;
    /** The provider/embedding error that triggered the fallback, if any. */
    cause?: Error;
};
export type IndexProgress = {
    /** Called before indexing starts. `isEmpty` is true on first run. */
    beforeIndex?: (isEmpty: boolean) => void;
    /** Called after indexing completes with stats. */
    afterIndex?: (stats: IndexStats, isEmpty: boolean) => void;
    /**
     * Called when the stored embedding fingerprint no longer matches the active
     * model: the index was dropped and is being rebuilt at the new dimensions.
     * `from`/`to` are the old/new `${name}:${model}:${dims}` fingerprints.
     */
    onModelSwitch?: (from: string, to: string) => void;
};
/**
 * Run a semantic search across lat.md sections.
 *
 * Handles indexing (with optional progress callback) and returns matched
 * sections, each carrying a bounded relevance `score`. After the dense top-k
 * is found, results are expanded one hop along the [[wiki-link]] graph at a
 * discounted score (see [[search/graph.ts#expandViaGraph]]).
 *
 * Never hard-fails: if no key is configured or the embedding/provider call
 * throws, it degrades to a keyword/heading search over the corpus instead of
 * raising. `degraded` is true whenever the keyword fallback was used.
 */
export declare function runSearch(latDir: string, query: string, key: string | undefined, limit: number, progress?: IndexProgress): Promise<SearchResult>;
/**
 * Index-only mode (no query). Used by `lat search --reindex`.
 */
export declare function runIndex(latDir: string, key: string, progress?: IndexProgress): Promise<void>;
export declare function cliProgress(reindex: boolean, s: Styler): IndexProgress;
export declare function searchCommand(ctx: CmdContext, query: string | undefined, opts: {
    limit: number;
    reindex?: boolean;
}, progress?: IndexProgress): Promise<CmdResult>;
