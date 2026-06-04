import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { loadAllSections, flattenSections, type Section } from '../lattice.js';

/**
 * A keyword-fallback hit: the matched section plus a bounded relevance score
 * in [0, 1]. Used when embeddings are unavailable (no LLM key or a thrown
 * provider/embedding error) so `lat search` never hard-fails — see
 * [[cli#search#Keyword Fallback]].
 */
export type KeywordHit = {
  section: Section;
  score: number;
};

/** Split text into lowercased word tokens, dropping very short noise tokens. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2);
}

/**
 * Score every section against the query by token overlap over its
 * heading + body content, returning the top `limit` hits sorted by score.
 *
 * The score is bounded in [0, 1]: it's the fraction of distinct query tokens
 * present in the section (weighted so heading matches count double), so a
 * section containing every query term scores near 1.0. This intentionally
 * sits below typical semantic scores so it reads as a weaker, best-effort
 * signal — but it is always available without an embedding API.
 */
export async function keywordSearch(
  latDir: string,
  query: string,
  limit = 5,
): Promise<KeywordHit[]> {
  const projectRoot = dirname(latDir);
  const sections = flattenSections(await loadAllSections(latDir));

  const queryTokens = [...new Set(tokenize(query))];
  if (queryTokens.length === 0) return [];

  // Cache file contents so we read each markdown file at most once.
  const fileCache = new Map<string, string[]>();
  async function fileLines(filePath: string): Promise<string[]> {
    let lines = fileCache.get(filePath);
    if (!lines) {
      lines = (await readFile(filePath, 'utf-8')).split('\n');
      fileCache.set(filePath, lines);
    }
    return lines;
  }

  const hits: KeywordHit[] = [];
  for (const section of sections) {
    const lines = await fileLines(join(projectRoot, section.filePath));
    const body = lines.slice(section.startLine - 1, section.endLine).join('\n');
    const headingTokens = new Set(tokenize(section.heading));
    const bodyTokens = new Set(tokenize(body));

    // Fraction of query tokens present, with heading matches weighted double.
    let matched = 0;
    for (const qt of queryTokens) {
      if (headingTokens.has(qt)) matched += 2;
      else if (bodyTokens.has(qt)) matched += 1;
    }
    if (matched === 0) continue;

    const score = Math.min(1, matched / (queryTokens.length * 2));
    hits.push({ section, score });
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}
