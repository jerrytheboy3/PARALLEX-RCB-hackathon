// Converts a labelled CSV into the CONTRACT.md dataset schema (JSON).
// P1's dataset: id,channel,language,sender,claimed_org,message,label → data/messages.json
// Minimal CSVs (message,label — spam/ham accepted) also work; missing columns get defaults:
// id = <PREFIX>-0001…, channel = SMS, language from the script.
// created_at (and any other column) is dropped — the app needs only the text and the label.
// Usage: npm run import:data [-- in.csv [out.json] [--prefix MSG]]
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2).filter((a, i, all) => a !== '--prefix' && all[i - 1] !== '--prefix');
const prefixArg = process.argv.includes('--prefix') ? process.argv[process.argv.indexOf('--prefix') + 1] : null;
const src = args[0] || `${ROOT}data/messages.csv`;
const out = args[1] || `${ROOT}data/messages.json`;

// The parser lives with the server (it also reads datasets at runtime).
export { parseCsv } from '../server/src/csv.js';
import { parseCsv } from '../server/src/csv.js';

const TYPE = { sms: 'sms', email: 'email', qr: 'qr' };
const LANG = { english: 'en', en: 'en', kannada: 'kn', kn: 'kn', kanglish: 'kanglish' };
const LABEL = { phishing: 'scam', scam: 'scam', spam: 'scam', benign: 'normal', normal: 'normal', legit: 'normal', ham: 'normal' };

// Best-effort scam type, only used for nicer example labels in the UI. Order matters.
const SCAM_TYPES = [
  ['fake_police', /police|challan|court|warrant|traffic|customs/i],
  ['electricity', /bescom|kptcl|electric|power|current|gruha jyothi/i],
  ['courier', /parcel|consignment|shipment|deliver|india post|bluedart|fedex/i],
  ['job', /job|earn|work from home|part time|telegram|youtube/i],
  ['loan', /loan/i],
  ['refund', /refund/i],
  ['lottery', /lottery|cashback|reward|scratch|win|free recharge|5g offer/i],
  ['kyc', /kyc|pan|aadhaar|otp|password|login|account|block|frozen|suspend|unauthori[sz]ed/i],
];

/** Language from the script when the CSV has no language column. */
export function scriptLanguage(text) {
  if (/[\u0C80-\u0CFF]/.test(text)) return 'kn';
  if (/[\u0900-\u097F]/.test(text)) return 'hi';
  return 'en';
}

export function toMessage(rec, line) {
  const type = TYPE[(rec.channel ?? 'sms').trim().toLowerCase()];
  const lang = rec.language === undefined ? scriptLanguage(rec.message || '') : LANG[rec.language?.trim().toLowerCase()];
  const label = LABEL[rec.label?.trim().toLowerCase()];
  const problems = [];
  if (!rec.id?.trim()) problems.push('missing id');
  if (!type) problems.push(`unknown channel "${rec.channel}"`);
  if (!lang) problems.push(`unknown language "${rec.language}"`);
  if (!label) problems.push(`unknown label "${rec.label}"`);
  if (!rec.message?.trim()) problems.push('empty message');
  if (problems.length) throw new Error(`line ${line}: ${problems.join(', ')}`);

  const msg = { id: rec.id.trim(), type, sender: rec.sender?.trim() || undefined, text: rec.message.trim(), lang, label };
  if (rec.claimed_org?.trim()) msg.claimedOrg = rec.claimed_org.trim();
  if (label === 'scam') {
    const hay = `${rec.claimed_org} ${rec.message}`;
    msg.scamType = (SCAM_TYPES.find(([, re]) => re.test(hay)) || ['other'])[0];
  }
  return msg;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [header, ...rows] = parseCsv(readFileSync(src, 'utf8'));
  const cols = header.map((h) => h.trim().toLowerCase());
  for (const need of ['message', 'label']) {
    if (!cols.includes(need)) throw new Error(`CSV is missing the "${need}" column`);
  }
  const prefix = prefixArg || 'MSG';
  const width = String(rows.length).length;
  const messages = rows.map((r, i) => {
    const rec = Object.fromEntries(cols.map((c, j) => [c, r[j]]));
    if (!rec.id?.trim()) rec.id = `${prefix}-${String(i + 1).padStart(Math.max(4, width), '0')}`;
    return toMessage(rec, i + 2);
  });
  const dupes = messages.map((m) => m.id).filter((id, i, a) => a.indexOf(id) !== i);
  if (dupes.length) throw new Error(`duplicate ids: ${[...new Set(dupes)].join(', ')}`);
  writeFileSync(out, `${JSON.stringify(messages, null, 2)}\n`);
  const rel = path.relative(ROOT, out);
  const count = (k, v) => messages.filter((m) => m[k] === v).length;
  console.log(
    `Wrote ${rel} — ${messages.length} messages: ${count('label', 'scam')} scam / ${count('label', 'normal')} normal · ` +
      `en ${count('lang', 'en')}, kn ${count('lang', 'kn')}, kanglish ${count('lang', 'kanglish')} · sms ${count('type', 'sms')}, email ${count('type', 'email')}`,
  );
}
