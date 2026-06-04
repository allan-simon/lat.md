<p align="center">
  <img src="templates/logo-dark.svg" alt="lat.md" width="500">
</p>

<p align="center">
  <a href="https://github.com/1st1/lat.md/actions/workflows/ci.yml"><img src="https://github.com/1st1/lat.md/actions/workflows/ci.yml/badge.svg" alt="CI"></a>
  <a href="https://www.npmjs.com/package/lat.md"><img src="https://img.shields.io/npm/v/lat.md" alt="npm"></a>
</p>

<p align="center">A knowledge graph for your codebase, written in markdown.</p>

---

## This fork (`allan-simon`): local embeddings + hybrid retrieval

This fork makes `lat search` work **fully locally** — no cloud embedding API, no daemon, no GPU — and **better on terse developer queries**, while staying a drop-in for the upstream CLI/MCP workflow. Everything below is backed by an empirical benchmark on a real 386-section graph; the full story, including the methodology mistakes we caught and corrected, is in [`BLOG.md`](./BLOG.md).

**What's added vs upstream:**

1. **Local embedding provider** — Qwen3-Embedding-0.6B (GGUF, ~640 MB) run **in-process on CPU** via `node-llama-cpp`. Enable with `LAT_EMBED_PROVIDER=local` (or `LAT_LLM_KEY=local:qwen3-0.6b`). No API key, no daemon. `node-llama-cpp` is an *optional* dependency; the OpenAI/Vercel HTTP path is unchanged when it isn't installed.
2. **Hybrid retrieval** — dense vectors fused with **SQLite FTS5 / BM25** (per-query min-max, `DENSE_WEIGHT = 0.75`). Real queries are terse keyword/identifier bags where pure dense underperforms.
3. **Never-fail degradation** — with no embedding key/model available, `lat search` falls back to keyword search instead of throwing.
4. **Model-fingerprint auto-rebuild** — the index records `provider:model:dims` and rebuilds itself on a model change (fixes a latent upstream bug where switching models silently returned garbage).
5. **Chunk-and-pool** long sections (> ~300 words) — fixes silent 512-token truncation for short-context local models.
6. **Graph-expansion re-ranking** — BFS 1 hop over the validated `[[wiki-link]]` graph, neighbours added at a 0.5× discount (never outrank direct hits).
7. **Transparent scores** in results; **prompt template** that tells agents to expand terse keywords before searching (measured **+67% top-1**).

**The numbers** (clean eval, n=120, R@1 / R@5):

| Config | R@1 | R@5 |
|---|---|---|
| OpenAI `text-embedding-3-small` (cloud) | 0.375 | 0.650 |
| **Qwen3-Embedding-0.6B + BM25 (CPU, this fork)** | 0.342 | **0.667** |
| **Qwen3-Embedding-0.6B dense (CPU, 640 MB)** | 0.333 | 0.650 |
| BM25 only (zero ML) | 0.200 | 0.583 |

A 2025 0.6B model on a laptop CPU matches the cloud API; adding BM25 edges past it. Bigger models and a GPU bought ~nothing on this corpus.

```bash
# fully local: in-process Qwen3-0.6B on CPU + hybrid dense/BM25, no key
LAT_EMBED_PROVIDER=local lat search "how are downloads rate-limited per plan"
```

---

## The problem

`AGENTS.md` doesn't scale. A single flat file can describe a small project, but as a codebase grows, maintaining one monolithic document becomes impractical. Key design decisions get buried, business logic goes undocumented, and agents hallucinate context they should be able to look up.

## The idea

Compress the knowledge about your program domain into a **graph** — a set of interconnected markdown files that live in a `lat.md/` directory at the root of your project. Sections link to each other with `[[wiki links]]`, markdown files link into the codebase (`[[src/auth.ts#validateToken]]`), source files link back with `// @lat: [[section-id]]` comments, and `lat check` ensures nothing drifts out of sync.

- **Faster coding for agents** — instead of grepping through your codebase, agents search the knowledge graph to discover key design decisions, constraints, and domain context fast and consistently.

- **Faster workflow for humans** — your agents maintain lat files for you. When you review a diff, start with the semantic changes in `lat.md/` to understand *what* changed and *why*. Reviewing code becomes the secondary task.

- **Knowledge retention** — the context and reasoning behind your prompts is usually lost after a session ends. With lat, agents capture that knowledge into the graph as they work, so future sessions start with full context instead of rediscovering it from scratch.

- **Test specs with enforcement** — test cases can be described as sections in `lat.md/` and marked with `require-code-mention: true`. Each spec then must be referenced by a `// @lat:` comment in test code. `lat check` flags any spec without a backlink, so you can review and maintain test coverage from the knowledge graph.

The `lat` CLI gives agents and humans a system to navigate and maintain the graph:

- **`lat init`** — sets up popular coding agents with hooks and instructions to keep lat updated and correct
- **`lat check`** — enforces referential consistency; agents call it automatically before finishing work
- **`lat search`** and **`lat section`** — agents use these to understand your prompts and navigate the graph instead of endless `grep` calls

`lat` is a workflow that comes with tools — build pre-commit hooks and GitHub bots, run CI tasks that improve the knowledge graph in the background.

## Install

```bash
npm install -g lat.md
```

Then run `lat init` in the repo you want to use lat in.

## How it works

Run `lat init` to scaffold a `lat.md/` directory, then write markdown files describing your architecture, business logic, test specs — whatever matters. Link between sections using `[[file#Section#Subsection]]` syntax. Link to source code symbols with `[[src/auth.ts#validateToken]]`. Annotate source code with `// @lat: [[section-id]]` (or `# @lat: [[section-id]]` in Python) comments to tie implementation back to concepts.

```
my-project/
├── lat.md/
│   ├── architecture.md    # system design, key decisions
│   ├── auth.md            # authentication & authorization logic
│   └── tests.md           # test specs (require-code-mention: true)
├── src/
│   ├── auth.ts            # // @lat: [[auth#OAuth Flow]]
│   └── server.ts          # // @lat: [[architecture#Request Pipeline]]
└── ...
```

## CLI

```bash
lat init                        # scaffold a lat.md/ directory
lat check                       # validate all wiki links and code refs
lat locate "OAuth Flow"         # find sections by name (exact, fuzzy)
lat section "auth#OAuth Flow"   # show a section with its links and refs
lat refs "auth#OAuth Flow"      # find what references a section
lat search "how do we auth?"    # semantic search via embeddings
lat expand "fix [[OAuth Flow]]" # expand [[refs]] in a prompt for agents
lat mcp                         # start MCP server for editor integration
```

## Configuration

Semantic search (`lat search`) requires an OpenAI (`sk-...`) or Vercel AI Gateway (`vck_...`) API key. The key is resolved in order:

1. `LAT_LLM_KEY` env var — direct value
2. `LAT_LLM_KEY_FILE` env var — path to a file containing the key
3. `LAT_LLM_KEY_HELPER` env var — shell command that prints the key (10s timeout)
4. Config file — saved by `lat init`. Run `lat config` to see its location.

## Development

Requires Node.js 22+ and pnpm.

```bash
pnpm install
pnpm build
pnpm test
```
