import { readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { loadAllSections, flattenSections, listLatticeFiles, extractRefs, buildFileIndex, resolveRef, } from '../lattice.js';
/**
 * Graph-expansion re-ranking constants. After the dense (or fallback) top-k
 * is found, we walk the [[wiki-link]] graph `HOP_COUNT` hop(s) and add unseen
 * neighbours at `parentScore * GRAPH_PENALTY`. The penalty (< 1) guarantees an
 * inferred neighbour can never outrank the direct match that pulled it in, so
 * the expansion is conservative and safe to leave always-on.
 */
export const HOP_COUNT = 1;
export const GRAPH_PENALTY = 0.5;
/**
 * Build the directed adjacency map of the [[wiki-link]] graph, keyed by
 * lowercased section id. Each wiki link's `target` is resolved to a canonical
 * section id using the exact same `resolveRef` the `lat refs`/`lat check`
 * commands use, so graph edges agree with the rest of the tool. Unresolvable
 * or self targets are skipped.
 */
async function buildAdjacency(latDir, sectionIds, fileIndex) {
    const projectRoot = dirname(latDir);
    const adjacency = new Map();
    const files = await listLatticeFiles(latDir);
    for (const file of files) {
        const content = await readFile(file, 'utf-8');
        for (const ref of extractRefs(file, content, projectRoot)) {
            const from = ref.fromSection.toLowerCase();
            const { resolved } = resolveRef(ref.target, sectionIds, fileIndex);
            const to = resolved.toLowerCase();
            // Skip refs that don't resolve to a real section, self-loops, and refs
            // outside any section (e.g. links above the first heading in a file).
            if (!from || !sectionIds.has(to) || from === to)
                continue;
            let neighbours = adjacency.get(from);
            if (!neighbours) {
                neighbours = new Set();
                adjacency.set(from, neighbours);
            }
            neighbours.add(to);
        }
    }
    return adjacency;
}
/**
 * From a set of seed results, walk the wiki-link graph `HOP_COUNT` hop(s) and
 * return neighbour sections that are NOT already in the seed set, each scored
 * at `parentScore * GRAPH_PENALTY`. The caller merges these with the direct
 * hits and re-sorts; the penalty keeps inferred hits strictly below their
 * parents. Edges are treated as undirected (a link in either direction makes
 * two sections neighbours) so related sections surface regardless of which one
 * authored the link.
 */
export async function expandViaGraph(latDir, seeds) {
    if (seeds.length === 0)
        return [];
    const allSections = flattenSections(await loadAllSections(latDir));
    const byId = new Map(allSections.map((s) => [s.id.toLowerCase(), s]));
    const sectionIds = new Set(byId.keys());
    const fileIndex = buildFileIndex(allSections);
    const directed = await buildAdjacency(latDir, sectionIds, fileIndex);
    // Make the graph undirected: a neighbour relation holds in both directions.
    const undirected = new Map();
    const link = (a, b) => {
        let set = undirected.get(a);
        if (!set) {
            set = new Set();
            undirected.set(a, set);
        }
        set.add(b);
    };
    for (const [from, tos] of directed) {
        for (const to of tos) {
            link(from, to);
            link(to, from);
        }
    }
    const seen = new Set(seeds.map((s) => s.id.toLowerCase()));
    // Best discounted score per discovered neighbour (a neighbour reachable from
    // several seeds keeps the highest-scoring parent).
    const best = new Map();
    // BFS frontier: each entry carries the discounted score it would confer.
    let frontier = seeds.map((s) => ({
        id: s.id.toLowerCase(),
        score: s.score,
    }));
    for (let hop = 0; hop < HOP_COUNT; hop++) {
        const next = [];
        for (const node of frontier) {
            const neighbours = undirected.get(node.id);
            if (!neighbours)
                continue;
            const neighbourScore = node.score * GRAPH_PENALTY;
            for (const nb of neighbours) {
                if (seen.has(nb))
                    continue;
                const prev = best.get(nb);
                if (prev === undefined || neighbourScore > prev) {
                    best.set(nb, neighbourScore);
                }
                next.push({ id: nb, score: neighbourScore });
            }
        }
        // Mark this hop's discoveries as seen before walking the next hop so we
        // don't re-add or double-discount them.
        for (const n of next)
            seen.add(n.id);
        frontier = next;
    }
    const hits = [];
    for (const [id, score] of best) {
        const section = byId.get(id);
        if (section)
            hits.push({ section, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits;
}
