/**
 * Relevance eval harness for the lat.md retriever. Measures MRR + Recall@5 of
 * several fusion / text-prep variants against a hand-authored gold set
 * (eval/gold.jsonl: {q, id}), using the in-browser static-path embedding model
 * (Xenova/all-MiniLM-L6-v2) so the numbers reflect `lat build --dense`.
 *
 * Run: pnpm exec tsx scripts/eval-relevance.ts
 *
 * It exists to make relevance changes (RRF, breadcrumb prepend, model upgrade)
 * measurable rather than guessed. See the research notes that motivated it.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { loadAllSections, flattenSections, type Section } from '../src/lattice.js';

// Model + optional asymmetric query prefix are overridable so the harness can
// sweep candidate embedders (e.g. EVAL_MODEL=Xenova/bge-small-en-v1.5).
const MODEL = process.env.EVAL_MODEL || 'Xenova/all-MiniLM-L6-v2';
const QPREFIX = process.env.EVAL_QPREFIX || '';
const ROOT = join(import.meta.dirname, '..');
const LAT = join(ROOT, 'lat.md');

type Gold = { q: string; id: string };
type Doc = { id: string; heading: string; breadcrumb: string; text: string };

function fullEndLine(s: Section): number {
  return s.children.length ? fullEndLine(s.children[s.children.length - 1]) : s.endLine;
}

async function loadDocs(): Promise<Doc[]> {
  const all = await loadAllSections(LAT);
  const flat = flattenSections(all);
  const cache = new Map<string, string[]>();
  const docs: Doc[] = [];
  for (const s of flat) {
    let lines = cache.get(s.filePath);
    if (!lines) {
      lines = (await readFile(join(ROOT, s.filePath), 'utf-8')).split('\n');
      cache.set(s.filePath, lines);
    }
    const text = lines.slice(s.startLine - 1, fullEndLine(s)).join('\n');
    const breadcrumb = s.id.split('#').slice(1).join(' > ');
    docs.push({ id: s.id, heading: s.heading, breadcrumb, text });
  }
  return docs;
}

const tok = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) || [];

// ── BM25 over a chosen text field ───────────────────────────────────
function bm25Scores(docTexts: string[], query: string): number[] {
  const N = docTexts.length;
  const prepared = docTexts.map((t) => {
    const terms = tok(t);
    const tf: Record<string, number> = {};
    for (const w of terms) tf[w] = (tf[w] || 0) + 1;
    return { tf, len: terms.length };
  });
  const df: Record<string, number> = {};
  for (const p of prepared) for (const w of Object.keys(p.tf)) df[w] = (df[w] || 0) + 1;
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

/** 1-based ranks (1 = highest score). Ties broken by index, stable enough here. */
function ranksOf(scores: number[]): number[] {
  const order = scores.map((s, i) => [s, i] as [number, number]).sort((a, b) => b[0] - a[0]);
  const rank = new Array(scores.length).fill(0);
  order.forEach(([, i], pos) => (rank[i] = pos + 1));
  return rank;
}

// Each fuser returns a final score array (higher = better).
const fusers: Record<string, (bm: number[], cos: number[]) => number[]> = {
  'bm25-only': (bm) => bm,
  'dense-only': (_bm, cos) => cos,
  'minmax 0.75/0.25 (current)': (bm, cos) => {
    const bn = minmax(bm);
    const cn = minmax(cos);
    return bm.map((_, i) => 0.75 * cn[i] + 0.25 * bn[i]);
  },
  'RRF k=60': (bm, cos) => {
    const rb = ranksOf(bm);
    const rc = ranksOf(cos);
    return bm.map((_, i) => 1 / (60 + rb[i]) + 1 / (60 + rc[i]));
  },
};

function evalVariant(
  gold: Gold[],
  idToIdx: Map<string, number>,
  scoreFor: (g: Gold) => number[],
): { mrr: number; recall5: number; misses: string[] } {
  let mrr = 0;
  let recall5 = 0;
  const misses: string[] = [];
  for (const g of gold) {
    const target = idToIdx.get(g.id);
    if (target == null) {
      misses.push(`UNKNOWN ID: ${g.id}`);
      continue;
    }
    const scores = scoreFor(g);
    // rank of the target doc
    let rank = 1;
    const ts = scores[target];
    for (let i = 0; i < scores.length; i++) if (scores[i] > ts) rank++;
    mrr += 1 / rank;
    if (rank <= 5) recall5++;
    else misses.push(`@${rank} "${g.q}" → ${g.id.split('#').slice(-1)[0]}`);
  }
  return { mrr: mrr / gold.length, recall5: recall5 / gold.length, misses };
}

async function embedAll(texts: string[]): Promise<number[][]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { pipeline } = (await import('@huggingface/transformers')) as any;
  const extractor = await pipeline('feature-extraction', MODEL, { dtype: 'q8' });
  const out: number[][] = [];
  const B = 32;
  for (let i = 0; i < texts.length; i += B) {
    const batch = texts.slice(i, i + B);
    const t = await extractor(batch, { pooling: 'mean', normalize: true });
    const list = t.tolist() as number[][];
    out.push(...list);
    process.stderr.write(`\r  embedded ${Math.min(i + B, texts.length)}/${texts.length}`);
  }
  process.stderr.write('\n');
  return out;
}

async function main() {
  const goldRaw = await readFile(join(ROOT, 'eval/gold.jsonl'), 'utf-8');
  const gold: Gold[] = goldRaw
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
  const docs = await loadDocs();
  const idToIdx = new Map(docs.map((d, i) => [d.id, i]));
  console.log(`Corpus: ${docs.length} sections · Gold: ${gold.length} queries · Model: ${MODEL}\n`);

  // Two text-prep variants for embedding + BM25.
  const plainText = docs.map((d) => `${d.heading}\n${d.text}`);
  const bcText = docs.map((d) => `${d.breadcrumb}\n${d.text}`);

  console.log('Embedding documents (plain)…');
  const plainVecs = await embedAll(plainText);
  console.log('Embedding documents (breadcrumb)…');
  const bcVecs = await embedAll(bcText);
  console.log(`Embedding queries…${QPREFIX ? ` (prefix: "${QPREFIX.slice(0, 30)}…")` : ''}`);
  const qVecs = await embedAll(gold.map((g) => QPREFIX + g.q));
  const qVec = new Map(gold.map((g, i) => [g.q, qVecs[i]]));

  // Build the variant matrix: {textPrep} × {fuser}.
  const preps = [
    { name: 'plain', texts: plainText, vecs: plainVecs },
    { name: 'breadcrumb', texts: bcText, vecs: bcVecs },
  ];

  const rows: { variant: string; mrr: number; recall5: number }[] = [];
  let firstMisses: string[] = [];
  for (const prep of preps) {
    for (const [fname, fuse] of Object.entries(fusers)) {
      // dense-only with breadcrumb-bm25 is identical to plain dense except vecs;
      // we still run it so the table is complete.
      const res = evalVariant(gold, idToIdx, (g) => {
        const bm = bm25Scores(prep.texts, g.q);
        const cos = cosineScores(qVec.get(g.q)!, prep.vecs);
        return fuse(bm, cos);
      });
      rows.push({
        variant: `${prep.name.padEnd(10)} | ${fname}`,
        mrr: res.mrr,
        recall5: res.recall5,
      });
      if (prep.name === 'plain' && fname === 'minmax 0.75/0.25 (current)') {
        firstMisses = res.misses;
      }
    }
  }

  console.log('\n=== Results (higher is better) ===');
  console.log('variant'.padEnd(46), 'MRR   ', 'Recall@5');
  console.log('-'.repeat(46), '------', '--------');
  for (const r of rows) {
    console.log(r.variant.padEnd(46), r.mrr.toFixed(3), '  ', r.recall5.toFixed(3));
  }

  if (firstMisses.length) {
    console.log('\n=== Misses for the CURRENT config (plain · minmax) — gold not in top-5 ===');
    for (const m of firstMisses) console.log('  ' + m);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
