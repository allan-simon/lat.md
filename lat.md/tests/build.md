---
lat:
  require-code-mention: true
---
# Build

Tests in `tests/build.test.ts` for the static site generator [[cli#build]] and its client-side search.

## BM25 search

Unit tests for [[src/render/site.ts#bm25Search]], the pure lexical scorer shipped to the static site. Verify it ranks the most relevant document first for a multi-term query, and returns an empty list both for a query whose terms appear in no document and for an empty query.

## Static build

Integration test that runs [[src/cli/build.ts#buildCommand]] against this project's own `lat.md/` into a temp directory.

Verify it emits `index.html`, `search-index.json`, and many per-section pages; that links are flat `*.html` files (never the server `/section?id=` route); and that running `bm25Search` over the shipped index finds a known section whose target page exists on disk.
