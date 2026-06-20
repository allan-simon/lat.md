import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import { extname } from 'node:path';
import { wikiLinkSyntax, wikiLinkFromMarkdown, } from '../extensions/wiki-link/index.js';
import { SOURCE_EXTENSIONS } from '../source-parser.js';
/**
 * Escape a string for safe interpolation into HTML text/attribute context.
 */
export function escapeHtml(s) {
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
/**
 * Render a markdown string to an HTML fragment, reusing the same remark stack
 * (wiki-link syntax + frontmatter) as the rest of lat.md so what `lat serve`
 * shows matches what the graph actually parses. `[[wiki links]]` are resolved
 * to real anchors via `resolve`; ```mermaid blocks become `<pre class="mermaid">`
 * for client-side rendering; raw HTML (e.g. widget `<iframe>`s) is passed
 * through via rehype-raw. See [[cli#serve#Rendering]].
 */
export async function renderMarkdown(markdown, resolve) {
    const file = await unified()
        .use(remarkParse)
        .use(remarkFrontmatter)
        .use(remarkGfm)
        .data('micromarkExtensions', [wikiLinkSyntax()])
        .data('fromMarkdownExtensions', [wikiLinkFromMarkdown()])
        .use(remarkRehype, {
        allowDangerousHtml: true,
        // Custom mdast→hast handlers. Typed loosely: the wikiLink node is a custom
        // type and the returned hast nodes are built by hand.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        handlers: {
            // ```mermaid → <pre class="mermaid"> (mermaid.js renders these in-browser);
            // every other fenced block keeps a language-* class for highlighting.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            code(_state, node) {
                if (node.lang === 'mermaid') {
                    return {
                        type: 'element',
                        tagName: 'pre',
                        properties: { className: ['mermaid'] },
                        children: [{ type: 'text', value: node.value }],
                    };
                }
                const className = node.lang ? [`language-${node.lang}`] : [];
                return {
                    type: 'element',
                    tagName: 'pre',
                    properties: {},
                    children: [
                        {
                            type: 'element',
                            tagName: 'code',
                            properties: { className },
                            children: [{ type: 'text', value: node.value }],
                        },
                    ],
                };
            },
            // [[target]] / [[target|alias]] → resolved anchor, inert code, or a
            // flagged broken link, decided by the caller's resolver.
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            wikiLink(_state, node) {
                const target = node.value;
                const alias = node.data?.alias ?? null;
                const r = resolve(target);
                if (r.kind === 'section') {
                    return {
                        type: 'element',
                        tagName: 'a',
                        properties: { href: r.href, className: ['wikilink'] },
                        children: [{ type: 'text', value: alias ?? r.label }],
                    };
                }
                if (r.kind === 'source') {
                    return {
                        type: 'element',
                        tagName: 'code',
                        properties: { className: ['srcref'] },
                        children: [{ type: 'text', value: alias ?? r.label }],
                    };
                }
                return {
                    type: 'element',
                    tagName: 'span',
                    properties: {
                        className: ['wikilink', 'broken'],
                        title: 'unresolved link',
                    },
                    children: [{ type: 'text', value: alias ?? r.label }],
                };
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
        },
    })
        .use(rehypeRaw)
        .use(rehypeStringify, { allowDangerousHtml: true })
        .process(markdown);
    return String(file);
}
/** True when a wiki-link target points at a source-code symbol, not a section. */
export function isSourceTarget(target) {
    const hashIdx = target.indexOf('#');
    const filePart = hashIdx === -1 ? target : target.slice(0, hashIdx);
    return SOURCE_EXTENSIONS.has(extname(filePart));
}
