import { execFileSync } from 'node:child_process';
import { extname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { listLatticeFiles, extractRefs } from './lattice.js';
import { resolveSourceSymbol, SOURCE_EXTENSIONS } from './source-parser.js';
/** Split a `[[src/foo.ts#bar]]`-style target into its file part and symbol path. */
export function splitSourceTarget(target) {
    const i = target.indexOf('#');
    return i === -1
        ? { file: target, symbol: '' }
        : { file: target.slice(0, i), symbol: target.slice(i + 1) };
}
/** True when a wiki-link target points at a source file (by extension). */
export function isSourceFileTarget(target) {
    return SOURCE_EXTENSIONS.has(extname(splitSourceTarget(target).file));
}
/**
 * Detect the GitHub repo + commit to link source code to. Prefers CI env
 * (`GITHUB_SERVER_URL`/`GITHUB_REPOSITORY`/`GITHUB_SHA`), then falls back to the
 * local git remote + HEAD. Returns null when not a GitHub repo (links then stay
 * inert). Pinning to the commit SHA keeps the published links stable.
 */
export function detectRepo(projectRoot) {
    const env = process.env;
    if (env.GITHUB_REPOSITORY && env.GITHUB_SHA) {
        const server = env.GITHUB_SERVER_URL || 'https://github.com';
        return { base: `${server}/${env.GITHUB_REPOSITORY}`, ref: env.GITHUB_SHA };
    }
    try {
        const git = (args) => execFileSync('git', args, {
            cwd: projectRoot,
            encoding: 'utf-8',
            stdio: ['ignore', 'pipe', 'ignore'],
        }).trim();
        const remote = git(['config', '--get', 'remote.origin.url']);
        const m = remote.match(/github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/i);
        if (!m)
            return null;
        const ref = git(['rev-parse', 'HEAD']);
        return { base: `https://github.com/${m[1]}/${m[2]}`, ref };
    }
    catch {
        return null;
    }
}
/** Build a blob URL to a file (optionally pinned to a line). */
export function blobUrl(repo, file, line) {
    return `${repo.base}/blob/${repo.ref}/${file}${line ? `#L${line}` : ''}`;
}
/**
 * Resolve the start line of every source-symbol wiki-link target referenced in
 * the lat.md files, so static-site source links can point at the exact line on
 * GitHub. Returns a map keyed by the lowercased target. Symbol resolution uses
 * the same tree-sitter path as [[cli#check#md]]; failures map to line 0 (file
 * link without a line). See [[src/render/site.ts#buildIndexContent|the renderer]].
 */
export async function buildSourceLineMap(latDir, projectRoot) {
    // Collect distinct source-symbol targets across all lat.md files.
    const targets = new Set();
    for (const file of await listLatticeFiles(latDir)) {
        const fc = await readFile(file, 'utf-8');
        for (const ref of extractRefs(file, fc, projectRoot)) {
            if (isSourceFileTarget(ref.target))
                targets.add(ref.target);
        }
    }
    const lineByTarget = new Map();
    for (const target of targets) {
        const { file, symbol } = splitSourceTarget(target);
        if (!symbol) {
            lineByTarget.set(target.toLowerCase(), 0); // whole-file link
            continue;
        }
        try {
            const { found, symbols } = await resolveSourceSymbol(file, symbol, projectRoot);
            if (!found) {
                lineByTarget.set(target.toLowerCase(), 0);
                continue;
            }
            const parts = symbol.split('#');
            const sym = symbols.find((s) => parts.length === 1
                ? s.name === parts[0] && !s.parent
                : s.name === parts[1] && s.parent === parts[0]);
            lineByTarget.set(target.toLowerCase(), sym?.startLine ?? 0);
        }
        catch {
            lineByTarget.set(target.toLowerCase(), 0);
        }
    }
    return lineByTarget;
}
/**
 * Build the function passed to [[src/render/site.ts#buildResolver]] that turns a
 * source-symbol target into a GitHub blob URL (with line when known), or null
 * when there's no repo — in which case source refs render inert.
 */
export function sourceHrefFor(repo, lineMap) {
    return (target) => {
        if (!repo)
            return null;
        const { file } = splitSourceTarget(target);
        const line = lineMap.get(target.toLowerCase()) || undefined;
        return blobUrl(repo, file, line);
    };
}
