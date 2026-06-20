/**
 * How a [[wiki link]] target resolves for rendering. A `section` link points at
 * another doc page; a `source` ref names a code symbol (rendered inert, since
 * the server doesn't serve source); `broken` is an unresolved target, surfaced
 * visually so authors notice. See [[cli#serve]].
 */
export type LinkResolution = {
    kind: 'section';
    href: string;
    label: string;
} | {
    kind: 'source';
    label: string;
} | {
    kind: 'broken';
    label: string;
};
export type WikiLinkResolver = (target: string) => LinkResolution;
/**
 * Escape a string for safe interpolation into HTML text/attribute context.
 */
export declare function escapeHtml(s: string): string;
/**
 * Render a markdown string to an HTML fragment, reusing the same remark stack
 * (wiki-link syntax + frontmatter) as the rest of lat.md so what `lat serve`
 * shows matches what the graph actually parses. `[[wiki links]]` are resolved
 * to real anchors via `resolve`; ```mermaid blocks become `<pre class="mermaid">`
 * for client-side rendering; raw HTML (e.g. widget `<iframe>`s) is passed
 * through via rehype-raw. See [[cli#serve#Rendering]].
 */
export declare function renderMarkdown(markdown: string, resolve: WikiLinkResolver): Promise<string>;
/** True when a wiki-link target points at a source-code symbol, not a section. */
export declare function isSourceTarget(target: string): boolean;
