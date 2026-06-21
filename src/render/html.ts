import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkDirective from 'remark-directive';
import remarkRehype from 'remark-rehype';
import rehypeRaw from 'rehype-raw';
import rehypeStringify from 'rehype-stringify';
import { extname } from 'node:path';
import {
  wikiLinkSyntax,
  wikiLinkFromMarkdown,
} from '../extensions/wiki-link/index.js';
import { SOURCE_EXTENSIONS } from '../source-parser.js';

/**
 * Recognized MyST admonition kinds → their default title. Container directives
 * with these names render as styled `<aside>` callouts; see [[cli#serve#Rendering]].
 */
const ADMONITIONS: Record<string, string> = {
  note: 'Note',
  tip: 'Tip',
  info: 'Info',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
  danger: 'Danger',
};

/**
 * Normalize MyST brace directives (`:::{note}` / `:::{note} Title`) to the bare
 * remark-directive form (`:::note` / `:::note[Title]`) so authors can use either
 * syntax. Only rewrites full-line opening fences; leaves other content alone.
 */
function normalizeMystDirectives(md: string): string {
  return md.replace(
    /^(\s*):::\{([a-zA-Z][\w-]*)\}[ \t]*(.*)$/gm,
    (_m, indent: string, name: string, title: string) =>
      title.trim()
        ? `${indent}:::${name}[${title.trim()}]`
        : `${indent}:::${name}`,
  );
}

/** Concatenate the text content of an mdast node's phrasing children. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function textOf(node: any): string {
  if (node.type === 'text') return node.value as string;
  if (!node.children) return '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return node.children.map((c: any) => textOf(c)).join('');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function walk(node: any, fn: (n: any) => void): void {
  fn(node);
  if (node.children) for (const child of node.children) walk(child, fn);
}

/**
 * remark plugin: turn admonition container directives (`:::note … :::`) into
 * styled `<aside class="admonition admonition-<kind>">` with a title, and any
 * other container directive into a plain `<div>` so its content still renders.
 */
function remarkAdmonitions() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (tree: any) => {
    walk(tree, (node) => {
      if (node.type !== 'containerDirective') return;
      const kind = node.name as string;
      node.data = node.data || {};
      if (!ADMONITIONS[kind]) {
        node.data.hName = 'div';
        return;
      }
      let title = ADMONITIONS[kind];
      const first = node.children?.[0];
      if (first?.data?.directiveLabel) {
        title = textOf(first) || title;
        node.children.shift();
      }
      node.data.hName = 'aside';
      node.data.hProperties = {
        className: ['admonition', `admonition-${kind}`],
      };
      node.children.unshift({
        type: 'paragraph',
        data: {
          hName: 'p',
          hProperties: { className: ['admonition-title'] },
        },
        children: [{ type: 'text', value: title }],
      });
    });
  };
}

/**
 * How a [[wiki link]] target resolves for rendering. A `section` link points at
 * another doc page; a `source` ref names a code symbol (rendered inert, since
 * the server doesn't serve source); `broken` is an unresolved target, surfaced
 * visually so authors notice. See [[cli#serve]].
 */
export type LinkResolution =
  | { kind: 'section'; href: string; label: string }
  | { kind: 'source'; label: string; href?: string }
  | { kind: 'broken'; label: string };

export type WikiLinkResolver = (target: string) => LinkResolution;

/**
 * Escape a string for safe interpolation into HTML text/attribute context.
 */
export function escapeHtml(s: string): string {
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
export async function renderMarkdown(
  markdown: string,
  resolve: WikiLinkResolver,
): Promise<string> {
  const file = await unified()
    .use(remarkParse)
    .use(remarkFrontmatter)
    .use(remarkGfm)
    .use(remarkDirective)
    .use(remarkAdmonitions)
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
        code(_state: any, node: any) {
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
        wikiLink(_state: any, node: any) {
          const target: string = node.value;
          const alias: string | null = node.data?.alias ?? null;
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
            const codeEl = {
              type: 'element',
              tagName: 'code',
              properties: { className: ['srcref'] },
              children: [{ type: 'text', value: alias ?? r.label }],
            };
            // Link to the source on GitHub when a URL is available (static
            // build / serve with a detected repo); otherwise render inert.
            return r.href
              ? {
                  type: 'element',
                  tagName: 'a',
                  properties: {
                    href: r.href,
                    className: ['srcref'],
                    target: '_blank',
                    rel: 'noopener',
                  },
                  children: [codeEl],
                }
              : codeEl;
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
      } as any,
    })
    .use(rehypeRaw)
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(normalizeMystDirectives(markdown));

  return String(file);
}

/** True when a wiki-link target points at a source-code symbol, not a section. */
export function isSourceTarget(target: string): boolean {
  const hashIdx = target.indexOf('#');
  const filePart = hashIdx === -1 ? target : target.slice(0, hashIdx);
  return SOURCE_EXTENSIONS.has(extname(filePart));
}
