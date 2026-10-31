// CONTRACT TEST — validates whatever engine / dataset / baseline is plugged in (CONTRACT.md).
// Merging P2's engine = swap engine/index.js, run `npm test`. If this file is green, it fits.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import * as engine from '../engine/index.js';
import { keywordFilter } from '../baseline/index.js';
import { redact, describeSender } from '../server/src/redact.js';

const read = (p) => JSON.parse(readFileSync(new URL(p, import.meta.url), 'utf8'));
const seed = read('../data/seed.json');
const datasetUrl = new URL('../data/messages.json', import.meta.url);
const dataset = existsSync(datasetUrl) ? read('../data/messages.json') : null;

const CATEGORIES = ['urgency', 'threat', 'credential', 'money', 'link', 'sender', 'impersonation', 'other'];
const LANGS = ['en', 'kn', 'kanglish', 'hi', 'hinglish'];

/** Build exactly what the server passes to detect(). */
function engineInput(m) {
  const sender = describeSender(m.sender);
  const replyTo = describeSender(m.replyTo);
  return {
    text: redact(m.text).redactedText,
    type: m.type || 'sms',
    sender: sender.redacted,
    senderInfo: sender.info,
    subject: m.subject ? redact(m.subject).redactedText : undefined,
    replyTo: replyTo.redacted,
    replyToInfo: replyTo.info.kind === 'none' ? undefined : replyTo.info,
  };
}

function assertShape(out, text) {
  expect(out && typeof out === 'object').toBe(true);
  expect(Array.isArray(out.signals)).toBe(true);
  expect(Array.isArray(out.links)).toBe(true);
  for (const s of out.signals) {
    expect(typeof s.id, 'signal.id').toBe('string');
    expect(s.id).toMatch(/^[a-z0-9_]+$/);
    expect(CATEGORIES, `category of ${s.id}`).toContain(s.category);
    expect(['weak', 'serious'], `strength of ${s.id}`).toContain(s.strength);
    expect(typeof s.weight).toBe('number');
    expect(s.weight).toBeGreaterThanOrEqual(1);
    expect(s.weight).toBeLessThanOrEqual(40);
    expect(typeof s.explanation).toBe('string');
    expect(s.explanation.length).toBeGreaterThan(5);
    expect(LANGS, `lang of ${s.id}`).toContain(s.lang);
    expect(typeof s.evidence).toBe('string');
    if (s.start === null || s.end === null) {
      expect(s.start, `${s.id}: start/end must both be null`).toBeNull();
      expect(s.end).toBeNull();
    } else {
      expect(Number.isInteger(s.start) && Number.isInteger(s.end), `${s.id}: integer offsets`).toBe(true);
      expect(s.start).toBeGreaterThanOrEqual(0);
      expect(s.end).toBeLessThanOrEqual(text.length);
      expect(s.start).toBeLessThan(s.end);
      expect(text.slice(s.start, s.end), `${s.id}: evidence must equal text.slice(start, end)`).toBe(s.evidence);
    }
  }
  for (const l of out.links) {
    expect(typeof l.url).toBe('string');
    expect(['ok', 'suspicious', 'dangerous']).toContain(l.verdict);
    expect(Array.isArray(l.reasons)).toBe(true);
    expect(text.slice(l.start, l.end), 'link url must equal text.slice(start, end)').toBe(l.url);
  }
  if (out.claimedOrgs !== undefined) expect(Array.isArray(out.claimedOrgs)).toBe(true);
}

afterEach(() => vi.restoreAllMocks());

describe(`engine contract (engine = "${engine.engineName}")`, () => {
  it('exports detect() and engineName', () => {
    expect(typeof engine.detect).toBe('function');
    expect(['stub', 'p2']).toContain(engine.engineName);
  });

  const messages = [...seed, ...(dataset || [])];
  it.each(messages.map((m) => [m.id, m]))('returns the contract shape for %s', async (_id, m) => {
    const input = engineInput(m);
    const out = await engine.detect(input);
    assertShape(out, input.text);
  });

  it('is deterministic (same input → same output)', async () => {
    for (const m of seed) {
      const a = await engine.detect(engineInput(m));
      const b = await engine.detect(engineInput(m));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('flags something on every seed scam and keeps offsets valid on tricky input', async () => {
    for (const m of seed.filter((x) => x.label === 'scam')) {
      const out = await engine.detect(engineInput(m));
      expect(out.signals.length, m.id).toBeGreaterThan(0);
    }
  });

  it.each([
    ['empty-ish', ' '],
    ['emoji', '🎉🎉 You won ₹10,000!!! 👉 bit.ly/x 🎁'],
    ['zero-width chars', 'Share your O​T​P now: bit​.ly/abc'],
    ['digit tricks', 'Send 0TP to verify, visit bit . ly/x'],
    ['kannada only', 'ನಿಮ್ಮ ಖಾತೆ ಬ್ಲಾಕ್ ಆಗುತ್ತದೆ ತಕ್ಷಣ OTP ತಿಳಿಸಿ'],
    ['very long', 'URGENT update KYC now '.repeat(220)],
    ['html', '<script>alert(1)</script> share OTP <img src=x>'],
    ['tokens only', '[PHONE] [OTP] [UPI_ID] [EMAIL] [CARD]'],
  ])('never throws and keeps offsets valid: %s', async (_name, text) => {
    const out = await engine.detect({ text, type: 'sms', senderInfo: { kind: 'none' } });
    assertShape(out, text);
  });

  it('works with missing optional fields', async () => {
    const out = await engine.detect({ text: 'hello', type: 'email' });
    assertShape(out, 'hello');
  });

  it('makes no network calls and never fetches links in the message', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(() => {
      throw new Error('engine must not use the network');
    });
    for (const m of seed) await engine.detect(engineInput(m));
    await engine.detect({ text: 'visit https://sbi-kyc.xyz/login now', type: 'sms' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('baseline contract', () => {
  it('keywordFilter(text) → { flagged: boolean, matched: string[] }', () => {
    for (const m of seed) {
      const r = keywordFilter(m.text);
      expect(typeof r.flagged).toBe('boolean');
      expect(Array.isArray(r.matched)).toBe(true);
      r.matched.forEach((x) => expect(typeof x).toBe('string'));
    }
  });
});

describe('dataset contract', () => {
  const sets = [['seed.json', seed], ...(dataset ? [['messages.json', dataset]] : [])];
  it.each(sets)('%s follows the schema', (_name, data) => {
    expect(Array.isArray(data)).toBe(true);
    const ids = new Set();
    for (const m of data) {
      expect(typeof m.id).toBe('string');
      expect(ids.has(m.id), `duplicate id ${m.id}`).toBe(false);
      ids.add(m.id);
      expect(['sms', 'email', 'qr']).toContain(m.type);
      expect(typeof m.text).toBe('string');
      expect(m.text.length).toBeGreaterThan(0);
      expect(m.text.length).toBeLessThanOrEqual(5000);
      expect(LANGS).toContain(m.lang);
      expect(['scam', 'normal']).toContain(m.label);
      if (m.expectedLevel !== undefined) expect(['safe', 'caution', 'high', 'critical']).toContain(m.expectedLevel);
    }
  });
});
