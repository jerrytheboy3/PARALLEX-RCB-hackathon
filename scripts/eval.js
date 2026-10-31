// Runs a dataset through the FULL pipeline (and P1's baseline if present) and prints
// accuracy / precision / recall. Usage: npm run eval [-- --data path/to/file.json]
// Saves results/eval-<timestamp>.json (ids + levels only — no message text).
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { analyze } from '../server/src/pipeline.js';
import { engineName } from '../engine/index.js';

const root = new URL('../', import.meta.url);
const arg = (name) => (process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : null);
const argPath = arg('--data');
const candidates = argPath ? [argPath] : ['data/messages.json', 'data/seed.json'];
const file = candidates.find((p) => existsSync(new URL(p, root)) && JSON.parse(readFileSync(new URL(p, root), 'utf8')).length);
if (!file) {
  console.error('No dataset found (data/messages.json or data/seed.json).');
  process.exit(1);
}
const data = JSON.parse(readFileSync(new URL(file, root), 'utf8'));

let baseline = null;
try {
  baseline = await import('../baseline/index.js');
} catch {
  baseline = null;
}

const LEVELS = ['safe', 'caution', 'high', 'critical'];
const rows = [];
for (const m of data) {
  const r = await analyze({ text: m.text, type: m.type || 'sms', sender: m.sender, subject: m.subject, replyTo: m.replyTo, trustedSenders: [] });
  rows.push({
    id: m.id,
    lang: m.lang,
    label: m.label,
    expectedLevel: m.expectedLevel ?? null,
    level: r.level,
    score: r.score,
    signals: [...new Set(r.signals.map((s) => s.id))],
    baselineFlagged: baseline ? baseline.keywordFilter(m.text).flagged : null,
  });
}

function binary(pred) {
  let tp = 0, fp = 0, tn = 0, fn = 0;
  for (const r of rows) {
    const p = pred(r);
    const scam = r.label === 'scam';
    if (p && scam) tp++;
    else if (p && !scam) fp++;
    else if (!p && !scam) tn++;
    else fn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : 0;
  const recall = tp + fn ? tp / (tp + fn) : 0;
  return { tp, fp, tn, fn, accuracy: (tp + tn) / rows.length, precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0 };
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
const fmt = (name, m) => `${name.padEnd(34)} acc ${pct(m.accuracy).padStart(6)}  prec ${pct(m.precision).padStart(6)}  recall ${pct(m.recall).padStart(6)}  F1 ${pct(m.f1).padStart(6)}  (TP ${m.tp} FP ${m.fp} TN ${m.tn} FN ${m.fn})`;

const results = {
  trustlensHighPlus: binary((r) => r.level === 'high' || r.level === 'critical'),
  trustlensCautionPlus: binary((r) => r.level !== 'safe'),
  baseline: baseline ? binary((r) => r.baselineFlagged) : null,
};

// Per-level precision/recall vs expectedLevel
const withExpected = rows.filter((r) => r.expectedLevel);
const perLevel = Object.fromEntries(
  LEVELS.map((lvl) => {
    const tp = withExpected.filter((r) => r.level === lvl && r.expectedLevel === lvl).length;
    const predicted = withExpected.filter((r) => r.level === lvl).length;
    const actual = withExpected.filter((r) => r.expectedLevel === lvl).length;
    return [lvl, { precision: predicted ? tp / predicted : null, recall: actual ? tp / actual : null, predicted, actual }];
  }),
);
const exact = withExpected.length ? withExpected.filter((r) => r.level === r.expectedLevel).length / withExpected.length : null;

const byLang = {};
for (const lang of [...new Set(rows.map((r) => r.lang))]) {
  const sub = rows.filter((r) => r.lang === lang);
  const ok = sub.filter((r) => (r.label === 'scam') === (r.level === 'high' || r.level === 'critical')).length;
  byLang[lang] = { n: sub.length, accuracy: ok / sub.length };
}

console.log(`\nTrustLens eval — dataset: ${file} (${rows.length} messages, ${rows.filter((r) => r.label === 'scam').length} scam) · engine: ${engineName}\n`);
console.log(fmt('TrustLens (scam = High/Critical)', results.trustlensHighPlus));
console.log(fmt('TrustLens (scam = Caution or above)', results.trustlensCautionPlus));
if (results.baseline) console.log(fmt('Keyword baseline', results.baseline));
if (withExpected.length) {
  console.log(`\nExact level match vs expectedLevel: ${pct(exact)} (${withExpected.length} labelled)`);
  console.log('Level      precision   recall   (predicted / expected)');
  for (const lvl of LEVELS) {
    const p = perLevel[lvl];
    console.log(`${lvl.padEnd(10)} ${p.precision === null ? '   —  ' : pct(p.precision).padStart(6)}     ${p.recall === null ? '  —  ' : pct(p.recall).padStart(6)}   (${p.predicted} / ${p.actual})`);
  }
}
console.log('\nBy language (scam = High/Critical): ' + Object.entries(byLang).map(([l, v]) => `${l} ${pct(v.accuracy)} (n=${v.n})`).join(' · '));

const misses = rows.filter((r) => (r.label === 'scam') !== (r.level === 'high' || r.level === 'critical'));
if (misses.length) {
  console.log('\nMisclassified:');
  for (const r of misses) console.log(`  ${r.id.padEnd(26)} ${r.label.padEnd(7)} → ${r.level.padEnd(8)} ${String(r.score).padStart(3)}  [${r.signals.join(', ')}]`);
}

const outDir = fileURLToPath(new URL('results/', root));
mkdirSync(outDir, { recursive: true });
const out = `${outDir}eval-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(out, JSON.stringify({ dataset: file, engine: engineName, at: new Date().toISOString(), results, perLevel, exactLevelMatch: exact, byLang, rows }, null, 2));
console.log(`\nSaved ${out.replace(fileURLToPath(root), '')}\n`);
