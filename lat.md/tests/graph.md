---
lat:
  require-code-mention: true
---
# Graph

Tests in `tests/graph.test.ts` for the section-graph data behind the interactive graph view ([[cli#graph]]).

## buildGraphData

Unit test for [[src/graph.ts#buildGraphData]]. Verify it keeps only connected sections as nodes (isolated sections are dropped), maps each node to its page URL via the supplied `sectionUrl`, and passes the edges through unchanged.

## collectEdges

Integration test for [[src/graph.ts#collectEdges]] over this project's own `lat.md/`. Verify it returns a non-empty edge list, that every edge endpoint resolves to a real section id with no self-loops, and that edges are deduplicated (no repeated source→target pair).
