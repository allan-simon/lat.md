import { mkdir, writeFile, readFile, rm, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, isAbsolute, relative } from 'node:path';
import { loadAllSections, flattenSections, listLatticeFiles, buildFileIndex, resolveRef, extractRefs, } from '../lattice.js';
import { scanCodeRefs } from '../code-refs.js';
import { isSourceTarget } from '../render/html.js';
import { buildResolver, buildSidebar, buildSectionContent, renderPage, graphPageContent, graphScript, STATIC_EMBED_MODEL, } from '../render/site.js';
import { buildGraphData } from '../graph.js';
const GRAPH_HREF = 'graph.html';
/** A filesystem-safe slug for a section id (collisions disambiguated by caller). */
function slugify(id) {
    return (id
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'section');
}
/** Deepest descendant's end line — the true end of a section's content block. */
function fullEndLine(section) {
    if (section.children.length === 0)
        return section.endLine;
    return fullEndLine(section.children[section.children.length - 1]);
}
/**
 * Build a static HTML site from the lattice — deployable to GitHub Pages with no
 * server. Pages are flat files (`<slug>.html`) so links work under any base
 * path; search is client-side BM25 over a shipped `search-index.json` (see
 * [[cli#build#Client search]]). Reuses the shared page builders in
 * [[src/render/site.ts]], so output matches [[cli#serve]]. See [[cli#build]].
 */
export async function buildCommand(ctx, opts) {
    const { latDir, projectRoot } = ctx;
    const outDir = isAbsolute(opts.out) ? opts.out : join(projectRoot, opts.out);
    const allSections = await loadAllSections(latDir);
    const flat = flattenSections(allSections);
    const sectionIds = new Set(flat.map((s) => s.id.toLowerCase()));
    const fileIndex = buildFileIndex(allSections);
    const byId = new Map(flat.map((s) => [s.id.toLowerCase(), s]));
    // Stable, unique slug per section id → flat `<slug>.html` URLs.
    const slugByIdLower = new Map();
    const usedSlugs = new Set();
    for (const s of flat) {
        let slug = slugify(s.id);
        if (usedSlugs.has(slug)) {
            let n = 2;
            while (usedSlugs.has(`${slug}-${n}`))
                n++;
            slug = `${slug}-${n}`;
        }
        usedSlugs.add(slug);
        slugByIdLower.set(s.id.toLowerCase(), slug);
    }
    const sectionUrl = (id) => `${slugByIdLower.get(id.toLowerCase()) ?? slugify(id)}.html`;
    // ── Aggregate the wiki-link graph once (not per section) ──────────
    const outgoing = new Map();
    const incoming = new Map();
    const files = await listLatticeFiles(latDir);
    for (const file of files) {
        const fc = await readFile(file, 'utf-8');
        for (const ref of extractRefs(file, fc, projectRoot)) {
            if (isSourceTarget(ref.target))
                continue;
            const { resolved } = resolveRef(ref.target, sectionIds, fileIndex);
            const fromLower = ref.fromSection.toLowerCase();
            const toLower = resolved.toLowerCase();
            if (fromLower === toLower)
                continue;
            const toSection = byId.get(toLower);
            const fromSection = byId.get(fromLower);
            if (!toSection || !fromSection)
                continue;
            (outgoing.get(fromLower) ?? setGet(outgoing, fromLower)).set(toLower, toSection);
            (incoming.get(toLower) ?? setGet(incoming, toLower)).set(fromLower, fromSection);
        }
    }
    // ── Aggregate code back-refs once ────────────────────────────────
    const codeMap = new Map();
    const srcCache = new Map();
    const { refs: codeRefs } = await scanCodeRefs(projectRoot);
    for (const ref of codeRefs) {
        const { resolved } = resolveRef(ref.target, sectionIds, fileIndex);
        const toLower = resolved.toLowerCase();
        if (!byId.has(toLower))
            continue;
        let snippet = '';
        try {
            let lines = srcCache.get(ref.file);
            if (!lines) {
                lines = (await readFile(join(projectRoot, ref.file), 'utf-8')).split('\n');
                srcCache.set(ref.file, lines);
            }
            const start = Math.max(0, ref.line - 1 - 2);
            const end = Math.min(lines.length, ref.line - 1 + 3);
            snippet = lines.slice(start, end).join('\n');
        }
        catch {
            // source unreadable — skip snippet
        }
        const arr = codeMap.get(toLower) ?? [];
        arr.push({ file: ref.file, line: ref.line, snippet });
        codeMap.set(toLower, arr);
    }
    // ── Emit ─────────────────────────────────────────────────────────
    await rm(outDir, { recursive: true, force: true });
    await mkdir(outDir, { recursive: true });
    const resolver = buildResolver(allSections, sectionUrl);
    const sidebar = buildSidebar(allSections, sectionUrl);
    const sliceCache = new Map();
    const searchIndex = [];
    for (const section of flat) {
        const idLower = section.id.toLowerCase();
        let lines = sliceCache.get(section.filePath);
        if (!lines) {
            lines = (await readFile(join(projectRoot, section.filePath), 'utf-8')).split('\n');
            sliceCache.set(section.filePath, lines);
        }
        const content = lines
            .slice(section.startLine - 1, fullEndLine(section))
            .join('\n');
        const outgoingRefs = [...(outgoing.get(idLower)?.values() ?? [])].map((resolved) => ({ target: resolved.id, resolved }));
        const incomingRefs = [
            ...(incoming.get(idLower)?.values() ?? []),
        ].map((s) => ({ section: s, reason: 'wiki link' }));
        const found = {
            kind: 'found',
            section,
            content,
            outgoingRefs,
            outgoingSourceRefs: [],
            incomingRefs,
            codeRefs: codeMap.get(idLower) ?? [],
        };
        const body = await buildSectionContent(found, resolver, sectionUrl);
        const html = renderPage({
            title: section.heading,
            homeHref: 'index.html',
            graphHref: GRAPH_HREF,
            sidebar,
            content: body,
            search: { mode: 'static', indexHref: 'search-index.json' },
        });
        await writeFile(join(outDir, sectionUrl(section.id)), html);
        // Ancestor heading path (no leaf) — prepended for contextual retrieval.
        const ancestors = section.id.split('#').slice(1, -1).join(' > ');
        searchIndex.push({
            id: section.id,
            url: sectionUrl(section.id),
            heading: section.heading,
            file: section.filePath,
            firstParagraph: section.firstParagraph,
            text: content,
            ancestors: ancestors || undefined,
        });
    }
    // Optional dense vectors: embed each section with the same small model the
    // browser uses for the query (see [[cli#build#Client search]]), so cosine is
    // meaningful across the two. Lazy + optional so the default build needs no
    // native deps or model download.
    let denseNote = '';
    if (opts.dense) {
        // Embed breadcrumb + heading + body (contextual retrieval); the browser
        // embeds the query with the same model + its query prefix.
        const embedded = await embedDocs(searchIndex.map((e) => [e.ancestors, e.heading, e.text].filter(Boolean).join('\n')));
        if (embedded) {
            embedded.forEach((vec, i) => (searchIndex[i].vec = vec));
            denseNote = ctx.styler.dim(` Dense vectors shipped (${embedded[0]?.length ?? 0}-dim, ${STATIC_EMBED_MODEL}); ` +
                'the page lazy-loads the same model (~34 MB) to embed queries.');
        }
        else {
            denseNote = ctx.styler.yellow(' --dense skipped: install the optional @huggingface/transformers dependency.');
        }
    }
    // Index page + search index.
    await writeFile(join(outDir, 'index.html'), renderPage({
        title: 'lat.md',
        homeHref: 'index.html',
        graphHref: GRAPH_HREF,
        sidebar,
        content: '<h1>lat.md</h1><p>Browse the knowledge graph in the sidebar, or search above.</p>',
        search: { mode: 'static', indexHref: 'search-index.json' },
    }));
    await writeFile(join(outDir, 'search-index.json'), JSON.stringify(searchIndex));
    // Graph page + data. Edges are derived from the already-aggregated link map
    // (no extra file walk).
    const edges = [];
    for (const [fromLower, inner] of outgoing) {
        const from = byId.get(fromLower);
        if (!from)
            continue;
        for (const to of inner.values())
            edges.push({ source: from.id, target: to.id });
    }
    await writeFile(join(outDir, 'graph.json'), JSON.stringify(buildGraphData(allSections, edges, sectionUrl)));
    await writeFile(join(outDir, 'graph.html'), renderPage({
        title: 'Graph',
        homeHref: 'index.html',
        graphHref: GRAPH_HREF,
        sidebar,
        content: graphPageContent(),
        search: { mode: 'static', indexHref: 'search-index.json' },
        extraScript: graphScript('graph.json'),
    }));
    // Copy interactive widgets, if any.
    const widgetsSrc = join(latDir, '_widgets');
    if (existsSync(widgetsSrc)) {
        await cp(widgetsSrc, join(outDir, '_widgets'), { recursive: true });
    }
    const rel = relative(process.cwd(), outDir) || outDir;
    const s = ctx.styler;
    return {
        output: s.green(`Built ${flat.length} pages`) +
            ` to ${s.cyan(rel)}\n` +
            s.dim(`Open ${rel}/index.html, or serve the directory (e.g. \`npx serve ${rel}\`). ` +
                `Search is client-side ${opts.dense ? 'hybrid (BM25 + dense)' : 'BM25 (lexical)'}.`) +
            denseNote,
    };
}
/**
 * Embed each text with the static-site model ([[src/render/site.ts#STATIC_EMBED_MODEL]])
 * via the optional `@huggingface/transformers` dependency — the SAME model the
 * browser loads for the query, so the vectors are comparable. Returns one
 * L2-normalized vector per input, or `null` if the optional dep isn't installed.
 */
async function embedDocs(texts) {
    let pipeline;
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ({ pipeline } = (await import('@huggingface/transformers')));
    }
    catch {
        return null;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const extractor = await pipeline('feature-extraction', STATIC_EMBED_MODEL, { dtype: 'q8' });
    const out = [];
    for (const text of texts) {
        const t = await extractor(text, { pooling: 'mean', normalize: true });
        out.push(Array.from(t.data));
    }
    return out;
}
/** Get-or-create an inner Map (keeps the graph-aggregation loop terse). */
function setGet(m, k) {
    const inner = new Map();
    m.set(k, inner);
    return inner;
}
