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

// @lat: [[tests/render#MyST admonitions]]
describe('renderMarkdown — MyST admonitions', () => {
  it('renders a bare :::note directive as a styled aside with a default title', async () => {
    const html = await renderMarkdown(':::note\nBody text.\n:::', resolve);
    expect(html).toContain('<aside class="admonition admonition-note">');
    expect(html).toContain('class="admonition-title">Note</p>');
    expect(html).toContain('Body text.');
  });

  it('renders the MyST brace form :::{warning} with a custom title', async () => {
    const html = await renderMarkdown(
      ':::{warning} Heads up\nBe careful.\n:::',
      resolve,
    );
    expect(html).toContain('<aside class="admonition admonition-warning">');
    expect(html).toContain('class="admonition-title">Heads up</p>');
  });

  it('supports a remark-directive label :::tip[Pro tip]', async () => {
    const html = await renderMarkdown(':::tip[Pro tip]\nDo this.\n:::', resolve);
    expect(html).toContain('class="admonition-title">Pro tip</p>');
  });

  it('falls back to a plain div for an unknown directive name', async () => {
    const html = await renderMarkdown(':::sidebar\nstuff\n:::', resolve);
    expect(html).toContain('<div');
    expect(html).toContain('stuff');
    expect(html).not.toContain('admonition');
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
