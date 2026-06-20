---
lat:
  require-code-mention: true
---
# Render

Tests in `tests/render.test.ts` for the server-side markdown→HTML rendering used by [[cli#serve]].

## renderMarkdown

Unit tests for [[src/render/html.ts#renderMarkdown]], the server-side markdown→HTML pass used by [[cli#serve]].

Verify that:

- a `[[section]]` target becomes a `/section?id=…` anchor;
- a source-symbol target (`[[src/foo.ts#bar]]`) renders as inert `<code class="srcref">`;
- an unresolved target is flagged with the `broken` class;
- `[[target|alias]]` uses the alias as link text;
- a ` ```mermaid ` fence becomes `<pre class="mermaid">` with its source preserved;
- other fences keep a `language-*` class;
- raw widget `<iframe>` HTML passes through.

## escapeHtml

Unit test for [[src/render/html.ts#escapeHtml]]. Verify the HTML-significant characters `&`, `<`, `>`, and `"` are escaped so untrusted strings are safe to interpolate into markup.

## isSourceTarget

Unit test for [[src/render/html.ts#isSourceTarget]]. Verify a wiki-link target is classified as source code when its file part has a known source extension (e.g. `.ts`, `.py`), and as a section otherwise.
