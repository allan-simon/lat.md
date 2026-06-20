import type { CmdContext, CmdResult, Styler } from '../context.js';
import {
  openDb,
  ensureSchema,
  closeDb,
  modelFingerprint,
  commitFingerprint,
} from '../search/db.js';
import { detectProvider } from '../search/provider.js';
import { indexSections, type IndexStats } from '../search/index.js';
import { hybridSearch } from '../search/hybrid.js';
import { keywordSearch } from '../search/keyword.js';
import { expandViaGraph } from '../search/graph.js';
import {
  loadAllSections,
  flattenSections,
  type SectionMatch,
} from '../lattice.js';
import { formatResultList, formatNavHints } from '../format.js';

/** Reason label shown for results found via the no-embeddings keyword path. */
const KEYWORD_FALLBACK_REASON = 'keyword fallback (no embeddings)';

export type SearchResult = {
  query: string;
  matches: SectionMatch[];
  /** True when results came from the keyword fallback (no embeddings). */
  degraded?: boolean;
  /** The provider/embedding error that triggered the fallback, if any. */
  cause?: Error;
};

export type IndexProgress = {
  /** Called before indexing starts. `isEmpty` is true on first run. */
  beforeIndex?: (isEmpty: boolean) => void;
  /** Called after indexing completes with stats. */
  afterIndex?: (stats: IndexStats, isEmpty: boolean) => void;
  /**
   * Called when the stored embedding fingerprint no longer matches the active
   * model: the index was dropped and is being rebuilt at the new dimensions.
   * `from`/`to` are the old/new `${name}:${model}:${dims}` fingerprints.
   */
  onModelSwitch?: (from: string, to: string) => void;
};

async function withDb<T>(
  latDir: string,
  key: string,
  progress: IndexProgress | undefined,
  fn: (
    db: Awaited<ReturnType<typeof openDb>>,
    provider: ReturnType<typeof detectProvider>,
  ) => Promise<T>,
): Promise<T> {
  const provider = detectProvider(key);
  const db = openDb(latDir);

  try {
    const schema = await ensureSchema(db, provider);
    if (schema.rebuilt && schema.previousFingerprint) {
      progress?.onModelSwitch?.(
        schema.previousFingerprint,
        modelFingerprint(provider),
      );
    }

    const countResult = await db.execute('SELECT COUNT(*) as n FROM sections');
    const isEmpty = (countResult.rows[0].n as number) === 0;

    progress?.beforeIndex?.(isEmpty);
    const stats = await indexSections(latDir, db, provider, key);
    progress?.afterIndex?.(stats, isEmpty);

    // Commit the active fingerprint only after the index pass succeeds. On a
    // model switch ensureSchema left it unwritten (empty tables), so if the
    // re-embed above throws — it propagates to runSearch's catch, which
    // degrades to keyword fallback — the old fingerprint persists and the next
    // run re-detects the switch and rebuilds. On the no-switch path this is a
    // harmless idempotent re-write of the same value.
    if (schema.rebuilt) {
      await commitFingerprint(db, provider);
    }

    return await fn(db, provider);
  } finally {
    await closeDb(db);
  }
}

/**
 * Run a semantic search across lat.md sections.
 *
 * Handles indexing (with optional progress callback) and returns matched
 * sections, each carrying a bounded relevance `score`. After the dense top-k
 * is found, results are expanded one hop along the [[wiki-link]] graph at a
 * discounted score (see [[search/graph.ts#expandViaGraph]]).
 *
 * Never hard-fails: if no key is configured or the embedding/provider call
 * throws, it degrades to a keyword/heading search over the corpus instead of
 * raising. `degraded` is true whenever the keyword fallback was used.
 */
export async function runSearch(
  latDir: string,
  query: string,
  key: string | undefined,
  limit: number,
  progress?: IndexProgress,
): Promise<SearchResult> {
  // No key at all → straight to keyword fallback, no DB/embedding attempt.
  if (!key) {
    return keywordFallback(latDir, query, limit);
  }

  try {
    return await withDb(latDir, key, progress, async (db, provider) => {
      // Hybrid dense + lexical (FTS5/bm25) fusion is the default when
      // embeddings are available (see [[cli#search#Hybrid Search]]). The
      // keyword fallback below stays for the no-embeddings case.
      const results = await hybridSearch(db, query, provider, key, limit);

      const allSections = await loadAllSections(latDir);
      const flat = flattenSections(allSections);
      const byId = new Map(flat.map((s) => [s.id, s]));

      // Direct (fused) hits, keeping their bounded relevance score.
      const direct: SectionMatch[] = results
        .map((r): SectionMatch | null => {
          const section = byId.get(r.id);
          return section
            ? { section, reason: 'hybrid match', score: r.score }
            : null;
        })
        .filter((m): m is SectionMatch => m !== null);

      const matches = await applyGraphExpansion(latDir, direct, limit);
      return { query, matches, degraded: false };
    });
  } catch (err) {
    // Provider/embedding/network failure — degrade to keyword fallback rather
    // than surfacing a stack trace. The caller decides how to note this.
    return keywordFallback(latDir, query, limit, err as Error);
  }
}

/**
 * Keyword/heading search over the corpus, used when embeddings are
 * unavailable. Results are graph-expanded just like the dense path, and the
 * returned `degraded` flag lets callers print a one-line note. `cause` (if a
 * provider error triggered the fallback) is attached for optional diagnostics.
 */
async function keywordFallback(
  latDir: string,
  query: string,
  limit: number,
  cause?: Error,
): Promise<SearchResult> {
  const hits = await keywordSearch(latDir, query, limit);
  const direct: SectionMatch[] = hits.map((h) => ({
    section: h.section,
    reason: KEYWORD_FALLBACK_REASON,
    score: h.score,
  }));
  const matches = await applyGraphExpansion(latDir, direct, limit);
  return { query, matches, degraded: true, cause };
}

/**
 * Expand the direct hits one hop along the wiki-link graph, merge the
 * discounted neighbours in, then re-sort by score and truncate to `limit`.
 * Direct hits with no score (shouldn't happen here) sort last. The graph
 * penalty guarantees neighbours never outrank the direct hit that surfaced
 * them.
 */
async function applyGraphExpansion(
  latDir: string,
  direct: SectionMatch[],
  limit: number,
): Promise<SectionMatch[]> {
  const present = new Set(direct.map((m) => m.section.id.toLowerCase()));
  const neighbours = await expandViaGraph(
    latDir,
    direct.map((m) => ({ id: m.section.id, score: m.score ?? 0 })),
  );

  const merged: SectionMatch[] = [...direct];
  for (const nb of neighbours) {
    // expandViaGraph already excludes seeds, but guard against duplicates.
    if (present.has(nb.section.id.toLowerCase())) continue;
    merged.push({
      section: nb.section,
      reason: 'graph neighbor (1 hop)',
      score: nb.score,
    });
  }

  merged.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  return merged.slice(0, limit);
}

/**
 * Index-only mode (no query). Used by `lat search --reindex`.
 */
export async function runIndex(
  latDir: string,
  key: string,
  progress?: IndexProgress,
): Promise<void> {
  await withDb(latDir, key, progress, async () => {});
}

export function cliProgress(reindex: boolean, s: Styler): IndexProgress {
  return {
    onModelSwitch(from, to) {
      // A model/dimension change invalidates every stored vector, so the index
      // is fully rebuilt. Always surface this (even outside --reindex) since it
      // explains the otherwise-surprising full re-embed that follows.
      process.stderr.write(
        s.dim(
          `Embedding model changed (${from} → ${to}); rebuilding index from scratch.\n`,
        ),
      );
    },
    beforeIndex(isEmpty) {
      if (isEmpty || reindex) {
        const label = reindex ? 'Re-indexing' : 'Building index';
        process.stderr.write(s.dim(`${label}...`));
      }
    },
    afterIndex(stats, isEmpty) {
      if (isEmpty || reindex) {
        process.stderr.write(
          s.dim(
            ` done (${stats.added} added, ${stats.updated} updated, ${stats.removed} removed)\n`,
          ),
        );
      } else if (stats.added + stats.updated + stats.removed > 0) {
        process.stderr.write(
          s.dim(
            `Index updated: ${stats.added} added, ${stats.updated} updated, ${stats.removed} removed\n`,
          ),
        );
      }
    },
  };
}

/**
 * One-line dim note (to stderr) explaining that embeddings are unavailable and
 * the keyword fallback is in use. Printed only in CLI mode so MCP/JSON output
 * stays clean.
 */
function noteFallback(ctx: CmdContext, key: string | undefined): void {
  if (ctx.mode !== 'cli') return;
  const why = key ? 'embedding provider unavailable' : 'no API key configured';
  process.stderr.write(
    ctx.styler.dim(
      `Embeddings unavailable (${why}); using keyword fallback. ` +
        'Configure LAT_LLM_KEY for semantic search.\n',
    ),
  );
}

export async function searchCommand(
  ctx: CmdContext,
  query: string | undefined,
  opts: { limit: number; reindex?: boolean },
  progress?: IndexProgress,
): Promise<CmdResult> {
  const { getEffectiveKey } = await import('../config.js');
  // A thrown key resolution (e.g. empty key file, failing helper) is
  // recoverable: fall back to the local model rather than erroring out.
  // lat.md is local-first, so a key is undefined only when embeddings are
  // explicitly opted out (LAT_EMBED_PROVIDER=none → keyword-only).
  let key: string | undefined;
  try {
    key = getEffectiveKey();
  } catch {
    key = 'local';
  }

  if (!query) {
    // Index-only mode (--reindex). Nothing to do when embeddings are opted out.
    if (!key) {
      noteFallback(ctx, key);
      return { output: '' };
    }
    await runIndex(ctx.latDir, key, progress);
    return { output: '' };
  }

  const result = await runSearch(ctx.latDir, query, key, opts.limit, progress);

  // Surface the degradation once, to stderr, without polluting the result.
  if (result.degraded) {
    noteFallback(ctx, key);
  }

  if (result.matches.length === 0) {
    return { output: 'No results found.' };
  }

  return {
    output:
      formatResultList(ctx, `Search results for "${query}":`, result.matches) +
      formatNavHints(ctx),
  };
}
