/** A GitHub (or compatible) repo coordinate for building blob URLs. */
export type Repo = {
    base: string;
    ref: string;
};
/** Split a `[[src/foo.ts#bar]]`-style target into its file part and symbol path. */
export declare function splitSourceTarget(target: string): {
    file: string;
    symbol: string;
};
/** True when a wiki-link target points at a source file (by extension). */
export declare function isSourceFileTarget(target: string): boolean;
/**
 * Detect the GitHub repo + commit to link source code to. Prefers CI env
 * (`GITHUB_SERVER_URL`/`GITHUB_REPOSITORY`/`GITHUB_SHA`), then falls back to the
 * local git remote + HEAD. Returns null when not a GitHub repo (links then stay
 * inert). Pinning to the commit SHA keeps the published links stable.
 */
export declare function detectRepo(projectRoot: string): Repo | null;
/** Build a blob URL to a file (optionally pinned to a line). */
export declare function blobUrl(repo: Repo, file: string, line?: number): string;
/**
 * Resolve the start line of every source-symbol wiki-link target referenced in
 * the lat.md files, so static-site source links can point at the exact line on
 * GitHub. Returns a map keyed by the lowercased target. Symbol resolution uses
 * the same tree-sitter path as [[cli#check#md]]; failures map to line 0 (file
 * link without a line). See [[src/render/site.ts#buildIndexContent|the renderer]].
 */
export declare function buildSourceLineMap(latDir: string, projectRoot: string): Promise<Map<string, number>>;
/**
 * Build the function passed to [[src/render/site.ts#buildResolver]] that turns a
 * source-symbol target into a GitHub blob URL (with line when known), or null
 * when there's no repo — in which case source refs render inert.
 */
export declare function sourceHrefFor(repo: Repo | null, lineMap: Map<string, number>): (target: string) => string | null;
