import { describe, it, expect } from 'vitest';
import {
  renderMarkdown,
  escapeHtml,
  isSourceTarget,
  type WikiLinkResolver,
} from '../src/render/html.js';

// A resolver mimicking the server's: "Real …" → section, *.ts → source,
// everything else → broken. Lets the renderer tests stay self-contained.
const resolve: WikiLinkResolver = (t) => {
  if (isSourceTarget(t)) return { kind: 'source', label: t };
  if (t.startsWith('Real'))
    return { kind: 'section', href: '/section?id=Real', label: 'Real' };
  return { kind: 'broken', label: t };
};

// @lat: [[tests/render#renderMarkdown]]
describe('renderMarkdown', () => {
  it('resolves a [[section]] wiki link to an anchor', async () => {
    const html = await renderMarkdown('See [[Real Section]].', resolve);
    expect(html).toContain('<a href="/section?id=Real" class="wikilink">');
  });

  it('renders a source-symbol [[src/foo.ts#bar]] ref as inert code', async () => {
    const html = await renderMarkdown('Calls [[src/foo.ts#bar]].', resolve);
    expect(html).toContain('<code class="srcref">src/foo.ts#bar</code>');
    expect(html).not.toContain('href=');
  });

  it('flags an unresolved wiki link as broken', async () => {
    const html = await renderMarkdown('A [[Nope#Missing]] link.', resolve);
    expect(html).toMatch(/class="wikilink broken"/);
  });

  it('honors a [[target|alias]] display label', async () => {
    const html = await renderMarkdown('[[Real Section|click here]]', resolve);
    expect(html).toContain('>click here</a>');
  });

  it('turns a mermaid fence into <pre class="mermaid"> for client rendering', async () => {
    const html = await renderMarkdown(
      '```mermaid\ngraph LR; A-->B\n```',
      resolve,
    );
    expect(html).toContain('<pre class="mermaid">');
    expect(html).toContain('A-->B'); // diagram source preserved verbatim
  });

  it('keeps a language-* class on other fenced blocks', async () => {
    const html = await renderMarkdown('```ts\nconst x = 1;\n```', resolve);
    expect(html).toContain('language-ts');
  });

  it('passes raw HTML (widget iframes) through', async () => {
    const html = await renderMarkdown(
      '<iframe src="_widgets/demo.html" height="200"></iframe>',
      resolve,
    );
    expect(html).toMatch(/<iframe[^>]*src="_widgets\/demo\.html"/);
  });
});

// @lat: [[tests/render#escapeHtml]]
describe('escapeHtml', () => {
  it('escapes the HTML-significant characters', () => {
    expect(escapeHtml('<a href="x">&')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;');
  });
});

// @lat: [[tests/render#isSourceTarget]]
describe('isSourceTarget', () => {
  it('detects source-code targets by file extension', () => {
    expect(isSourceTarget('src/foo.ts#bar')).toBe(true);
    expect(isSourceTarget('lib/app.py#main')).toBe(true);
    expect(isSourceTarget('cli#search#Hybrid Search')).toBe(false);
  });
});
