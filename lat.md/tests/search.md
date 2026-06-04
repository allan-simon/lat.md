---
lat:
  require-code-mention: true
---
# Search

Tests in `tests/search.test.ts`.

## Provider Detection

Unit tests (always run). Verify `detectProvider` correctly identifies OpenAI (`sk-`), Vercel (`vck_`), rejects Anthropic (`sk-ant-`) with a helpful message, and rejects unknown prefixes.

## Score Components

Unit tests (always run) for [[src/search/search.ts#distanceToScore]], which maps a raw cosine distance to a bounded relevance score. Verify distance 0 → 1.0, 1 → 0.5, 2 → 0.0, and that out-of-range distances clamp into `[0, 1]`. See [[cli#search#Score Components]].

## Model Fingerprint

Unit tests (always run) for [[src/search/db.ts#ensureSchema]] + [[src/search/db.ts#modelFingerprint]], the self-healing model-switch logic. See [[cli#search#Model Fingerprint]].

Verify the fingerprint is `name:model:dimensions`, that a fresh DB writes it without rebuilding, that an unchanged fingerprint is a no-op (seeded rows survive), and that switching to a different model (here from 8 to 16 dims) drops and recreates the index — old rows gone, new vector width accepted. The new fingerprint is committed via [[src/search/db.ts#commitFingerprint]] only after a successful re-embed: verify `ensureSchema` leaves the OLD fingerprint in place on a switch, that `commitFingerprint` then writes the new one, and that an interrupted rebuild (no commit) makes the next run re-detect the switch instead of trusting the empty tables.

## Chunk and Pool

Unit tests (always run) for [[src/search/index.ts#chunkWords]] + [[src/search/index.ts#meanPool]], the long-section chunking that fixes context truncation. See [[cli#search#Chunk and Pool]].

Verify a short section is one unchanged window; a 700-word section splits into 3 windows that overlap by exactly `CHUNK_OVERLAP` words and together cover every word; mean-pooling a single vector yields its unit; pooling orthogonal windows yields a renormalized 45° unit vector; and that each window is weighted equally regardless of raw magnitude.

## Keyword Fallback

Unit tests (always run) for [[src/search/keyword.ts#keywordSearch]], the no-embeddings degradation path. Verify a query overlapping a section heading ranks that section first with a bounded `(0, 1]` score, and that a query overlapping nothing returns no hits. See [[cli#search#Keyword Fallback]].

## Graph Expansion

Unit tests (always run) for [[src/search/graph.ts#expandViaGraph]]. Verify that from a seed, 1-hop neighbours are added at `parentScore * GRAPH_PENALTY` (so they rank below the seed), that 2-hop sections are excluded under `HOP_COUNT = 1`, and that seed sections are never re-added. See [[cli#search#Graph Expansion]].

## Local Provider

Tests for the in-process local-mode provider in [[src/search/provider.ts#detectProvider]] + [[src/search/local.ts]]. See [[cli#search#Local Mode]].

### Provider detection

Unit tests (always run, no model download). See [[cli#search#Local Mode]].

Verify `local:qwen3-0.6b` and bare `local` resolve to the in-process Qwen provider (name `local`, 1024 dims), an unknown local id throws, and the local provider yields a distinct `local:Qwen3-Embedding-0.6B-Q8_0:1024` model fingerprint so a switch self-heals the index.

### In-process embedding sanity

Gated functional test (runs only when node-llama-cpp is installed and the Qwen GGUF is cached; otherwise skipped). See [[cli#search#Local Mode]].

Verify [[src/search/local.ts#embedLocal]] returns exactly one 1024-dim L2-normalized vector per input (not per-token), and that a query (with the instruct prefix) ranks a paraphrase well above an unrelated sentence — proving correct last-token pooling and query-only prefixing.

## Hybrid Fusion

Unit + integration tests (always run) for [[src/search/hybrid.ts]], the dense + lexical fusion that is the default search path. See [[cli#search#Hybrid Search]].

### FTS match expression

Tests for [[src/search/hybrid.ts#buildFtsMatch]]. Verify each alphanumeric token is quoted and OR-joined, that FTS5 operator characters are stripped into plain quoted terms so a query can never be a MATCH syntax error, and that a token-less query returns null.

### Score fusion

Tests for [[src/search/hybrid.ts#fuseCandidates]]. Verify two min-max-normalized sides combine as `DENSE_WEIGHT*dense + (1-DENSE_WEIGHT)*bm25` (with `DENSE_WEIGHT = 0.75`), and that a candidate present on only one side is scored from that side alone (missing side contributes 0).

### Min-max normalization

Tests for [[src/search/hybrid.ts#minMaxNormalize]]. Verify a degenerate set of all-equal raw scores maps every entry to 1 instead of dividing by a zero span (so a single strong hit on one side isn't zeroed out).

### FTS rescues an exact identifier

Integration test against a real libsql DB with hand-crafted sparse vectors and a tiny embedding server. See [[cli#search#Hybrid Search]].

A section containing an exact identifier (`getConfigDir`) is made orthogonal to the query so the dense side ranks it last; verify FTS5 finds it by token and the fused ranking lifts it above a section the dense side ranked higher.

## RAG Replay Tests

Functional tests that exercise the full RAG pipeline using a replay server instead of a real embedding API.

The test covers indexing, hashing, vector insert, and KNN search via `tests/rag-replay-server.ts`. Test fixture lives in `tests/cases/rag/lat.md/` with pre-recorded vectors in `tests/cases/rag/replay-data/`.

The replay server has two modes:
- **Replay** (default `pnpm test`): serves cached vectors from binary replay data. Matches requests by SHA-256 of input text.
- **Capture** (`pnpm cook-test-rag`): proxies to real API via `LAT_LLM_KEY`, records all text→vector mappings, flushes binary data to `replay-data/` on teardown. Re-run this after changing how sections are chunked or which texts are embedded.

The test sets `LAT_LLM_KEY` to `REPLAY_LAT_LLM_KEY::<server-url>`, which `detectProvider` routes to the local replay server. This way the entire codebase runs unmodified — same `fetch()` calls, same provider logic.

### Indexes all sections

Index the RAG fixture (9 sections across 2 files), verify counts.

### Finds auth section for login query

Search for "how do we handle user login and security?" and verify the Authentication section ranks first.

### Finds performance section for latency query

Search for "what tools do we use to measure response times?" and verify the Performance Tests section ranks first.

### Incremental index skips unchanged sections

Re-index unchanged content, verify all sections reported as unchanged with zero re-embedding.

### Detects deleted sections when file is removed

Remove `testing.md`, re-index, verify 4 sections removed and 5 architecture sections remain.
