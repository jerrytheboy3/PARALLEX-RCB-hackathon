// Feedback memory: users' corrections ("this was actually a scam / actually real") and how they
// feed back into later analyses. Stored in ONE local JSON file (FEEDBACK_MEMORY_FILE, default
// data/feedback-memory.json, git-ignored). Only MASKED data is stored: the redacted text, the
// redacted note, link domains, public SMS sender IDs and email domains. Phone numbers and email
// addresses are kept only as salted hashes, so they can be matched but not read back.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redact, redactValue, describeSender } from './redact.js';
import { ORGS, isOfficialDomain } from './orgs.js';
import { registrableDomain } from './urlinspect.js';
import { levelFor } from './scoring.js';

const DEFAULT_FILE = fileURLToPath(new URL('../../data/feedback-memory.json', import.meta.url));
const MAX_RECORDS = 5000;
export const MEMORY = {
  shiftPerReport: 25, // risk points per net confirming report on a shared domain / sender / phone
  maxShift: 50,
  exactScamScore: 80, // score used when an exact match is overridden to "scam"
  exactRealScore: 10, // … and to "real"
};

// Hosts many unrelated messages share — a report about one says nothing about the others.
const SHARED_HOSTS = new Set(['bit.ly', 'tinyurl.com', 'is.gd', 'goo.gl', 't.co', 'cutt.ly', 'rb.gy', 'ow.ly', 'forms.gle', 'google.com', 'whatsapp.com', 'wa.me', 'gmail.com', 'yahoo.com', 'outlook.com']);
const isOfficialAnywhere = (host) => ORGS.some((o) => isOfficialDomain(o, host));

export const normalizeText = (redactedText) => String(redactedText || '').normalize('NFC').toLowerCase().replace(/\s+/g, ' ').trim();
export const fingerprintOf = (redactedText) => createHash('sha256').update(normalizeText(redactedText)).digest('hex').slice(0, 24);

/**
 * Indicators used to recognise near-identical scams. Phones and email addresses are salted hashes.
 * @param {{text:string, sender?:string, urls?:{domain?:string, host?:string}[]}} input  original text (never stored)
 */
export function extractIndicators({ text, sender, urls = [] }, salt, phrases = []) {
  const h = (v) => createHash('sha256').update(`${salt}:${v}`).digest('hex').slice(0, 20);
  const domains = new Set();
  for (const u of urls) {
    const host = String(u.host || u.domain || '').toLowerCase().replace(/^www\./, '');
    if (!host || SHARED_HOSTS.has(host) || isOfficialAnywhere(host)) continue;
    domains.add(registrableDomain(host));
  }
  const phones = new Set();
  const raw = String(text || '');
  for (const m of redact(raw).matches) {
    if (m.type !== 'phone') continue;
    const digits = raw.slice(m.start, m.end).replace(/\D/g, '');
    if (digits.length >= 10) phones.add(h(digits.slice(-10)));
  }
  const out = { domains: [...domains], phones: [...phones], phrases: phrases.slice(0, 3) };
  const s = describeSender(sender);
  if (s.info.kind === 'header') out.senderId = s.info.header.replace(/^[A-Z]{2}-/, ''); // VM-SBIINB → SBIINB (public)
  if (s.info.kind === 'email') {
    if (!SHARED_HOSTS.has(s.info.domain) && !isOfficialAnywhere(s.info.domain)) out.senderDomain = s.info.domain;
    out.senderHash = h(String(sender).trim().toLowerCase());
  }
  if (['mobile', 'intl', 'landline'].includes(s.info.kind)) {
    const digits = String(sender).replace(/\D/g, '');
    if (digits.length >= 10) phones.add(h(digits.slice(-10)));
    out.phones = [...phones];
  }
  return out;
}

/** Which indicators two records share, e.g. ['domain', 'phone']. */
export function sharedIndicators(a, b) {
  const kinds = [];
  if (a.domains?.some((d) => b.domains?.includes(d)) || (a.senderDomain && (a.senderDomain === b.senderDomain || b.domains?.includes(a.senderDomain)))) kinds.push('domain');
  if ((a.senderId && a.senderId === b.senderId) || (a.senderHash && a.senderHash === b.senderHash)) kinds.push('sender');
  if (a.phones?.some((p) => b.phones?.includes(p))) kinds.push('phone');
  return kinds;
}

/** Majority of user verdicts; null on a tie (ties keep the original verdict). */
export function majority(records) {
  const scam = records.filter((r) => r.userVerdict === 'scam').length;
  const real = records.length - scam;
  return { scam, real, verdict: scam > real ? 'scam' : real > scam ? 'real' : null };
}

/**
 * A memory store. file === null keeps everything in memory (used by tests).
 */
export function createMemory({ file = process.env.FEEDBACK_MEMORY_FILE || (process.env.VITEST ? null : DEFAULT_FILE) } = {}) {
  let db = { version: 1, salt: randomBytes(16).toString('hex'), records: [] };
  if (file && existsSync(file)) {
    try {
      const loaded = JSON.parse(readFileSync(file, 'utf8'));
      if (loaded && Array.isArray(loaded.records) && typeof loaded.salt === 'string') db = loaded;
    } catch {
      /* unreadable file → start empty, never crash the demo */
    }
  }

  function persist() {
    if (!file) return;
    mkdirSync(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, JSON.stringify(db)); // the ONLY file the server writes (see privacy.test.js)
    renameSync(tmp, file);
  }

  return {
    get salt() {
      return db.salt;
    },
    records: () => db.records,
    stats() {
      const scam = db.records.filter((r) => r.userVerdict === 'scam').length;
      return { reports: db.records.length, scam, real: db.records.length - scam };
    },
    /** @param {object} rec built by buildRecord() */
    add(rec) {
      const record = { id: randomUUID(), timestamp: new Date().toISOString(), ...rec };
      db.records.push(record);
      if (db.records.length > MAX_RECORDS) db.records.splice(0, db.records.length - MAX_RECORDS);
      persist();
      return record;
    },
    exact: (fingerprint) => db.records.filter((r) => r.fingerprint === fingerprint),
    related(indicators) {
      const out = [];
      for (const r of db.records) {
        const kinds = sharedIndicators(indicators, r.extractedIndicators || {});
        if (kinds.length) out.push({ record: r, kinds });
      }
      return out;
    },
    /** The n most relevant records for an LLM prompt: exact, then shared indicators, then newest. */
    relevant({ fingerprint, indicators }, n = 5) {
      const score = (r) => (r.fingerprint === fingerprint ? 3 : 0) + sharedIndicators(indicators || {}, r.extractedIndicators || {}).length;
      return [...db.records]
        .map((r, i) => ({ r, s: score(r), i }))
        .sort((a, b) => b.s - a.s || b.i - a.i)
        .slice(0, n)
        .map((x) => x.r);
    },
    clear() {
      db.records = [];
      persist();
    },
  };
}

/** What a feedback submission stores. Everything comes from the server's own analysis, masked. */
export function buildRecord({ input, analysis, userVerdict, note, salt }) {
  const phrases = (analysis.signals || [])
    .filter((s) => s.strength === 'serious' || s.weight >= 10)
    .map((s) => redactValue(String(s.evidence || '')).slice(0, 60))
    .filter(Boolean);
  return {
    fingerprint: fingerprintOf(analysis.redactedText),
    inputType: input.type === 'qr' ? 'qr' : /^\s*\S+\s*$/.test(input.text) && /^(?:https?:\/\/|www\.)/i.test(input.text.trim()) ? 'url' : input.type,
    normalizedInput: normalizeText(analysis.redactedText).slice(0, 1000),
    extractedIndicators: extractIndicators({ text: input.text, sender: input.sender, urls: analysis.urls }, salt, [...new Set(phrases)]),
    originalVerdict: analysis.level,
    originalRiskScore: analysis.score,
    userVerdict,
    note: note ? redactValue(String(note)).slice(0, 200) : '',
  };
}

/**
 * Learning step, run on a scored result before it is returned.
 * - exact fingerprint match → the majority user verdict replaces ours (ties keep ours)
 * - shared domain / sender / phone → shift the score ±25 per net report (capped ±50) with a signal
 * Mutates and returns `r` (level, score, signals, memory).
 */
export function applyMemory(r, { input, memory }) {
  if (!memory || !memory.records().length) return r;
  const fingerprint = fingerprintOf(r.redactedText);
  const exact = memory.exact(fingerprint);
  if (exact.length) {
    const m = majority(exact);
    r.memory = { match: 'exact', scam: m.scam, real: m.real, verdict: m.verdict, applied: !!m.verdict };
    if (m.verdict === 'scam' && !['high', 'critical'].includes(r.level)) {
      r.level = 'high';
      r.score = Math.max(r.score, MEMORY.exactScamScore);
    } else if (m.verdict === 'real') {
      r.level = 'safe';
      r.score = Math.min(r.score, MEMORY.exactRealScore);
    }
    return r;
  }

  const indicators = extractIndicators({ text: input.text, sender: input.sender, urls: r.urls }, memory.salt);
  const related = memory.related(indicators);
  if (!related.length) return r;
  const m = majority(related.map((x) => x.record));
  const kinds = [...new Set(related.flatMap((x) => x.kinds))];
  if (!m.verdict) {
    r.memory = { match: 'related', scam: m.scam, real: m.real, verdict: null, applied: false, on: kinds };
    return r;
  }
  const net = m.scam - m.real;
  const shift = Math.max(-MEMORY.maxShift, Math.min(MEMORY.maxShift, net * MEMORY.shiftPerReport));
  r.score = Math.max(0, Math.min(100, r.score + shift));
  const hasSerious = r.signals.some((s) => s.strength === 'serious');
  r.level = levelFor(r.score, hasSerious || shift > 0);
  const n = m.verdict === 'scam' ? m.scam : m.real;
  r.signals.push({
    id: 'community_reports',
    key: `community_reports#${r.signals.length}`,
    category: 'other',
    strength: shift > 0 ? 'serious' : 'weak',
    weight: Math.max(1, Math.abs(shift)),
    weightApplied: shift,
    start: null,
    end: null,
    evidence: kinds.join(', '),
    explanation: `${n} earlier report${n === 1 ? '' : 's'} about the same ${kinds.join(' / ')} said it was ${m.verdict === 'scam' ? 'a scam' : 'genuine'} (${shift > 0 ? '+' : ''}${shift} points).`,
    lang: 'en',
    source: 'server',
    direction: m.verdict,
    reports: n,
    on: kinds,
  });
  r.memory = { match: 'related', scam: m.scam, real: m.real, verdict: m.verdict, applied: true, shift, on: kinds };
  return r;
}
