---
lat:
  require-code-mention: true
---
# Code Links

Tests in `tests/codelink.test.ts` for [[src/codelink.ts]], which turns source-code refs into GitHub blob links for the static site / server ([[cli#serve]], [[cli#build]]).

## Target parsing

Unit tests for [[src/codelink.ts#splitSourceTarget]] and [[src/codelink.ts#isSourceFileTarget]]. Verify a target splits into its file part and (possibly multi-level) symbol path, and that source-file targets are detected by extension while section ids are not.

## Blob URLs

Unit tests for [[src/codelink.ts#blobUrl]] and [[src/codelink.ts#sourceHrefFor]]. Verify a blob URL is built with an optional `#L<line>`, that a known symbol resolves to a line-pinned URL, an unknown symbol falls back to a file-only URL, and that a null repo yields no link.

## Repo detection

Unit test for [[src/codelink.ts#detectRepo]]. Verify it uses the GitHub Actions environment (`GITHUB_REPOSITORY` / `GITHUB_SHA`) when present to produce the repo base + commit ref.
