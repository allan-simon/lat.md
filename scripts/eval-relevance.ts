/**
 * Relevance eval harness for the lat.md retriever — hardened after an adversarial
 * methodology review. Measures MRR + Recall@{1,5,10} for retriever variants
 * against a gold set (eval/gold.jsonl: {q, id, alts?}) and, crucially, reports
 * **paired-bootstrap significance** (ΔMRR vs the current production config, 95%
 * CI, P(better)) so small differences aren't over-read.
 *
 * Scope: this measures the STATIC / in-browser path (client fusion + the browser
 * embedding model). It does NOT include the server path's graph-expansion or
 * chunk-and-pool, so RRF-for-server must be validated separately.
 *
 * Fixes applied vs the first version:
 *  - average-rank tie convention (no optimistic strict-`>` ranking)
 *  - paired bootstrap significance on per-query reciprocal rank
 *  - both candidate models embedded in one run (MiniLM + bge-small) with the
 *    correct asymmetric query prefix per model
 *  - breadcrumb variant PREPENDS context and KEEPS heading+body (the actual
 *    contextual-retrieval technique), instead of replacing the heading
 *  - multi-relevant judgments via gold `alts`
 *  - truncation control via EVAL_MAXCHARS to disentangle model vs window
 *
 * Run: pnpm exec tsx scripts/eval-relevance.ts
 *      EVAL_MAXCHARS=900 pnpm exec tsx scripts/eval-relevance.ts   # truncation control
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  loadAllSections,
  flattenSections,
  type Section,
} from '../src/lattice.js';

const ROOT = join(import.meta.dirname, '..');
const LAT = join(ROOT, 'lat.md');
const MAXCHARS = process.env.EVAL_MAXCHARS ? Number(process.env.EVAL_MAXCHARS) : 0;
const BOOT = 10000;

const MODELS = [
  { key: 'MiniLM', id: 'Xenova/all-MiniLM-L6-v2', prefix: '' },
  {
    key: 'bge-small',
    id: 'Xenova/bge-small-en-v1.5',
    prefix: 'Represent this sentence for searching relevant passages: ',
  },
];

type Gold = { q: string; id: string; alts?: string[] };
type Doc = { id: string; heading: string; ancestors: string; text: string };

function fullEndLine(s: Section): number {
  return s.children.length
    ? fullEndLine(s.children[s.children.length - 1])
    : s.endLine;
}

async function loadDocs(): Promise<Doc[]> {
  const flat = flattenSections(await loadAllSections(LAT));
  const cache = new Map<string, string[]>();
  const docs: Doc[] = [];
  for (const s of flat) {
    let lines = cache.get(s.filePath);
    if (!lines) {
      lines = (await readFile(join(ROOT, s.filePath), 'utf-8')).split('\n');
      cache.set(s.filePath, lines);
    }
    let text = lines.slice(s.startLine - 1, fullEndLine(s)).join('\n');
    if (MAXCHARS) text = text.slice(0, MAXCHARS);
    // ancestors = heading path WITHOUT the leaf (situating context to prepend)
    const ancestors = s.id.split('#').slice(1, -1).join(' > ');
    docs.push({ id: s.id, heading: s.heading, ancestors, text });
  }
  return docs;
}

const tok = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) || [];

function bm25Scores(docTexts: string[], query: string): number[] {
  const N = docTexts.length;
  const prepared = docTexts.map((t) => {
    const terms = tok(t);
    const tf: Record<string, number> = {};
    for (const w of terms) tf[w] = (tf[w] || 0) + 1;
    return { tf, len: terms.length };
  });
  const df: Record<string, number> = {};
  for (const p of prepared)
    for (const w of Object.keys(p.tf)) df[w] = (df[w] || 0) + 1;
  const avgdl = prepared.reduce((a, x) => a + x.len, 0) / N;
  const qt = tok(query);
  const k1 = 1.5;
  const b = 0.75;
  return prepared.map((x) => {
    let s = 0;
    for (const w of qt) {
      const f = x.tf[w];
      if (!f) continue;
      const idf = Math.log(1 + (N - df[w] + 0.5) / (df[w] + 0.5));
      s += (idf * (f * (k1 + 1))) / (f + k1 * (1 - b + (b * x.len) / avgdl));
    }
    return s;
  });
}

function cosineScores(qv: number[], docVecs: number[][]): number[] {
  return docVecs.map((v) => {
    let s = 0;
    for (let i = 0; i < v.length; i++) s += v[i] * qv[i];
    return s;
  });
}

function minmax(arr: number[]): number[] {
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of arr) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const span = mx - mn;
  return arr.map((v) => (span === 0 ? (mx > 0 ? 1 : 0) : (v - mn) / span));
}

/** 1-based AVERAGE rank (tie-robust): docs tied with `i` share the mean rank. */
function avgRanks(scores: number[]): number[] {
  return scores.map((s) => {
    let gt = 0;
    let eq = 0;
    for (const o of scores) {
      if (o > s) gt++;
      else if (o === s) eq++;
    }
    return gt + (eq + 1) / 2;
  });
}

/** RRF over average ranks of each signal (tie-robust). */
function rrf(bm: number[], cos: number[], k = 60): number[] {
  const rb = avgRanks(bm);
  const rc = avgRanks(cos);
  return bm.map((_, i) => 1 / (k + rb[i]) + 1 / (k + rc[i]));
}

const fusers: Record<string, (bm: number[], cos: number[]) => number[]> = {
  bm25: (bm) => bm,
  dense: (_bm, cos) => cos,
  'minmax .75/.25': (bm, cos) => {
    const bn = minmax(bm);
    const cn = minmax(cos);
    return bm.map((_, i) => 0.75 * cn[i] + 0.25 * bn[i]);
  },
  'RRF k=60': (bm, cos) => rrf(bm, cos),
};

/** Per-query reciprocal rank (best over relevant docs) using average ranks. */
function perQueryRR(
  gold: Gold[],
  relevantIdx: number[][],
  scoreFor: (i: number) => number[],
): { rr: number[]; r1: number[]; r5: number[]; r10: number[] } {
  const rr: number[] = [];
  const r1: number[] = [];
  const r5: number[] = [];
  const r10: number[] = [];
  gold.forEach((_g, qi) => {
    const scores = scoreFor(qi);
    const ranks = avgRanks(scores);
    let best = Infinity;
    for (const di of relevantIdx[qi]) best = Math.min(best, ranks[di]);
    rr.push(best === Infinity ? 0 : 1 / best);
    r1.push(best <= 1 ? 1 : 0);
    r5.push(best <= 5 ? 1 : 0);
    r10.push(best <= 10 ? 1 : 0);
  });
  return { rr, r1, r5, r10 };
}

const mean = (a: number[]): number => a.reduce((x, y) => x + y, 0) / a.length;

/** Paired bootstrap of ΔMRR (variant - baseline) over resampled queries. */
function bootstrap(
  rrVar: number[],
  rrBase: number[],
): { delta: number; lo: number; hi: number; pGt: number } {
  const n = rrVar.length;
  const diff = rrVar.map((v, i) => v - rrBase[i]);
  const deltas: number[] = [];
  // Deterministic LCG so runs are reproducible (Math.random is banned anyway).
  let seed = 1234567;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let b = 0; b < BOOT; b++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += diff[(rnd() * n) | 0];
    deltas.push(s / n);
  }
  deltas.sort((a, b) => a - b);
  return {
    delta: mean(diff),
    lo: deltas[Math.floor(0.025 * BOOT)],
    hi: deltas[Math.floor(0.975 * BOOT)],
    pGt: deltas.filter((d) => d > 0).length / BOOT,
  };
}

async function embedAll(
  modelId: string,
  texts: string[],
): Promise<number[][]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { pipeline } = (await import('@huggingface/transformers')) as any;
  const extractor = await pipeline('feature-extraction', modelId, {
    dtype: 'q8',
  });
  const out: number[][] = [];
  const B = 32;
  for (let i = 0; i < texts.length; i += B) {
    const t = await extractor(texts.slice(i, i + B), {
      pooling: 'mean',
      normalize: true,
    });
    out.push(...(t.tolist() as number[][]));
    process.stderr.write(`\r    ${Math.min(i + B, texts.length)}/${texts.length}`);
  }
  process.stderr.write('\r');
  return out;
}

async function main() {
  const gold: Gold[] = (await readFile(join(ROOT, 'eval/gold.jsonl'), 'utf-8'))
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  const docs = await loadDocs();
  const idToIdx = new Map(docs.map((d, i) => [d.id, i]));
  const relevantIdx = gold.map((g) =>
    [g.id, ...(g.alts || [])]
      .map((id) => idToIdx.get(id))
      .filter((x): x is number => x != null),
  );
  gold.forEach((g, i) => {
    if (relevantIdx[i].length === 0) throw new Error(`unknown gold id: ${g.id}`);
  });

  console.log(
    `Corpus ${docs.length} · Gold ${gold.length}` +
      (MAXCHARS ? ` · text truncated to ${MAXCHARS} chars` : '') +
      ` · bootstrap ${BOOT}\n` +
      `Scope: STATIC path only (no graph-expansion / chunk-and-pool).\n`,
  );

  // Text preps (model-independent BM25 text + model input text).
  const plain = docs.map((d) => `${d.heading}\n${d.text}`);
  // breadcrumb = prepend ancestors, KEEP heading+body (contextual retrieval).
  const bc = docs.map((d) =>
    d.ancestors ? `${d.ancestors}\n${d.heading}\n${d.text}` : `${d.heading}\n${d.text}`,
  );
  const preps: Record<string, string[]> = { plain, breadcrumb: bc };

  // Embed docs (per model × prep) and queries (per model, with prefix).
  const docVecs: Record<string, number[][]> = {};
  const qVecs: Record<string, number[][]> = {};
  for (const m of MODELS) {
    for (const [pname, texts] of Object.entries(preps)) {
      console.log(`Embedding docs · ${m.key} · ${pname}…`);
      docVecs[`${m.key}|${pname}`] = await embedAll(m.id, texts);
    }
    console.log(`Embedding queries · ${m.key}…`);
    qVecs[m.key] = await embedAll(
      m.id,
      gold.map((g) => m.prefix + g.q),
    );
  }

  // BM25 per prep per query (model-independent), cached.
  const bmCache: Record<string, number[][]> = {};
  for (const [pname, texts] of Object.entries(preps)) {
    bmCache[pname] = gold.map((g) => bm25Scores(texts, g.q));
  }

  // Compute every variant's per-query metrics.
  type Row = {
    name: string;
    mrr: number;
    r1: number;
    r5: number;
    r10: number;
    rr: number[];
  };
  const rows: Row[] = [];
  for (const m of MODELS) {
    for (const pname of Object.keys(preps)) {
      for (const [fname, fuse] of Object.entries(fusers)) {
        const dv = docVecs[`${m.key}|${pname}`];
        const res = perQueryRR(gold, relevantIdx, (qi) => {
          const bm = bmCache[pname][qi];
          const cos = cosineScores(qVecs[m.key][qi], dv);
          return fuse(bm, cos);
        });
        rows.push({
          name: `${m.key.padEnd(9)} ${pname.padEnd(10)} ${fname}`,
          mrr: mean(res.rr),
          r1: mean(res.r1),
          r5: mean(res.r5),
          r10: mean(res.r10),
          rr: res.rr,
        });
      }
    }
  }

  console.log('\n=== Metrics (static path) ===');
  console.log('variant'.padEnd(38), 'MRR  ', 'R@1 ', 'R@5 ', 'R@10');
  console.log('-'.repeat(38), '-----', '----', '----', '----');
  for (const r of rows)
    console.log(
      r.name.padEnd(38),
      r.mrr.toFixed(3),
      r.r1.toFixed(2),
      r.r5.toFixed(2),
      r.r10.toFixed(2),
    );

  // Significance vs the current production config.
  const baseName = 'MiniLM    plain      minmax .75/.25';
  const base = rows.find((r) => r.name.trim() === baseName.trim())!;
  console.log(`\n=== ΔMRR vs CURRENT (${baseName.trim()}) — paired bootstrap 95% CI ===`);
  console.log('variant'.padEnd(38), 'ΔMRR  ', '95% CI', '          P(better)');
  for (const r of rows) {
    if (r === base) continue;
    const b = bootstrap(r.rr, base.rr);
    const sig = b.lo > 0 ? '  *' : '';
    console.log(
      r.name.padEnd(38),
      (b.delta >= 0 ? '+' : '') + b.delta.toFixed(3),
      `[${b.lo >= 0 ? '+' : ''}${b.lo.toFixed(3)}, ${b.hi >= 0 ? '+' : ''}${b.hi.toFixed(3)}]`,
      ` ${(b.pGt * 100).toFixed(0)}%${sig}`,
    );
  }
  console.log('\n* = 95% CI excludes 0 (significant at this gold set, n=' + gold.length + ')');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
