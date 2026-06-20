---
lat:
  require-code-mention: true
---
# Serve

Tests in `tests/serve.test.ts` for the [[cli#serve]] HTTP server. They spawn the built CLI (`lat serve`) on an ephemeral port with embeddings disabled (`LAT_EMBED_PROVIDER=none`, keyword-only, no model download) and exercise its routes over real HTTP.

## Index page

Verify `GET /` returns 200 with the page shell — the `lat.md` title, section links into `/section?id=…`, and the sidebar link to `/graph`.

## Section page

Verify `GET /section?id=<id>` renders a section: 200 with the `<article>` content block produced by [[src/render/site.ts#buildSectionContent]].

## Search API

Verify `GET /api/search?q=…` returns JSON `{matches: [...]}` and that a query overlapping a section surfaces it (here a "running the test suite" query finds the Testing section via the keyword fallback).

## Graph API

Verify `GET /api/graph` returns the graph payload with `nodes` and `edges` arrays from [[src/graph.ts#buildGraphData]].

## Unknown routes 404

Verify an unknown path returns 404 and that a `../`-style `/_widgets/` request never leaks a file outside the widgets directory (the [[src/cli/serve.ts#serveWidget]] guard, plus client-side URL normalization).
