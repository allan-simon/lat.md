---
lat:
  require-code-mention: true
---
# Build

Tests in `tests/build.test.ts` for the static site generator [[cli#build]] and its client-side search.

## BM25 search

Unit tests for [[src/render/site.ts#bm25Search]], the pure lexical scorer shipped to the static site. Verify it ranks the most relevant document first for a multi-term query, and returns an empty list both for a query whose terms appear in no document and for an empty query.

## Hybrid static search

Unit tests for [[src/render/site.ts#staticSearch]] with dense vectors.

Verify it is BM25-only when no query vector is given; that a dense query vector can outrank the purely lexical match once the two min-max-normalized sides are fused (0.75 dense / 0.25 bm25); and that it falls back to BM25 when the documents carry no `vec`s even if a query vector is passed.

## Static build

Integration test that runs [[src/cli/build.ts#buildCommand]] against this project's own `lat.md/` into a temp directory.

Verify it emits `index.html`, `search-index.json`, and many per-section pages; that links are flat `*.html` files (never the server `/section?id=` route); and that running `bm25Search` over the shipped index finds a known section whose target page exists on disk.
