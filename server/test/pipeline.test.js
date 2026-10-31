import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { analyze, reassess, sanitizeEngineOutput } from '../src/pipeline.js';

const seed = JSON.parse(readFileSync(new URL('../../data/seed.json', import.meta.url), 'utf8'));
const run = (m, extra = {}) => analyze({ text: m.text, type: m.type, sender: m.sender, subject: m.subject, replyTo: m.replyTo, trustedSenders: [], ...extra });

describe('pipeline on the seed dataset', () => {
  it.each(seed.map((m) => [m.id, m]))('%s gets its expected level', async (_id, m) => {
    const r = await run(m);
    expect(r.level).toBe(m.expectedLevel);
  });

  it('every highlight lands on the original text, including Kannada', async () => {
    for (const m of seed) {
      const r = await run(m);
      for (const sig of r.signals.filter((x) => x.start !== null)) {
        const original = m.text.slice(sig.start, sig.end);
        // evidence is the redacted version of exactly that original text
        const { redact } = await import('../src/redact.js');
        expect(redact(original).redactedText, `${m.id}:${sig.id}`).toBe(sig.evidence);
      }
    }
  });

  it('evidence and links in the response never contain raw PII', async () => {
    const r = await analyze({ type: 'sms', text: 'Pay to ramesh@okaxis or call 9876543210 and share OTP 482913 at http://sbi-kyc.xyz/?m=9876543210', trustedSenders: [] });
    const json = JSON.stringify({ s: r.signals.map((x) => x.evidence), l: r.links.map((x) => x.url), red: r.redactedText });
    expect(json).not.toMatch(/9876543210|482913|ramesh@okaxis/);
    expect(r.redactionSummary).toMatchObject({ phone: 2, otp: 1, upi: 1 });
  });

  it('a normal bank OTP from the official header is Safe and sender is verified', async () => {
    const r = await run(seed.find((m) => m.id === 'en-normal-otp-001'));
    expect(r.level).toBe('safe');
    expect(r.senderVerified).toBe(true);
    expect(r.orgs.map((o) => o.id)).toContain('sbi');
  });

  it('attaches org verify steps without any phone numbers, and generic steps when no org', async () => {
    const r = await run(seed[0]);
    expect(r.verifySteps[0].orgId).toBe('sbi');
    expect(JSON.stringify(r.verifySteps)).not.toMatch(/\b\d{4,}\b/);
    const g = await analyze({ type: 'sms', text: 'hello there', trustedSenders: [] });
    expect(g.verifySteps[0].orgId).toBe('generic');
    expect(g.reportSteps.map((x) => x.id)).toEqual(['1930', 'cybercrime', 'chakshu']);
  });

  it('a bank OTP that mentions a merchant gets the SENDING bank\'s verify steps', async () => {
    const r = await analyze({
      type: 'sms',
      sender: 'VM-SBIINB',
      text: '731904 is the OTP for your txn of Rs 1,299.00 at Amazon on SBI Card ending 4417. Valid for 10 mins. Do not share it with anyone. -SBI',
      trustedSenders: [],
    });
    expect(r.level).toBe('safe');
    expect(r.senderVerified).toBe(true);
    expect(r.orgs.map((o) => o.id)).toEqual(['sbi', 'amazon']);
    expect(r.verifySteps[0].orgId).toBe('sbi');
    expect(r.verdict).toMatch(/SBI/);
  });

  it('org_link_mismatch is added when an org is named but the link is not theirs', async () => {
    const r = await analyze({ type: 'sms', text: 'SBI: verify at https://sbi-secure-login.com/x', trustedSenders: [] });
    expect(r.signals.some((s) => s.id === 'org_link_mismatch' && s.source === 'server')).toBe(true);
    const ok = await analyze({ type: 'sms', text: 'SBI: login at https://www.onlinesbi.sbi', trustedSenders: [] });
    expect(ok.signals.some((s) => s.id === 'org_link_mismatch')).toBe(false);
  });

  it('a crashing engine does not crash the pipeline', async () => {
    const engine = { engineName: 'p2', detect: () => { throw new Error('boom'); } };
    const r = await analyze({ type: 'sms', text: 'hi', trustedSenders: [] }, { engine });
    expect(r.engineError).toBe(true);
    expect(r.level).toBe('safe');
  });

  it('sanitises a sloppy engine output', () => {
    const out = sanitizeEngineOutput(
      { signals: [{ id: 'x', category: 'weird', strength: 'mega', weight: 999, start: 5, end: 2 }, null, { nope: 1 }], links: [{ url: 'a', start: 0, end: 100 }] },
      'short text',
    );
    expect(out.signals).toHaveLength(1);
    expect(out.signals[0]).toMatchObject({ category: 'other', strength: 'weak', weight: 40, start: null, end: null });
    expect(out.links).toHaveLength(0);
  });
});

describe('reassess ("this is actually legit")', () => {
  const bescom = seed.find((m) => m.id === 'kanglish-bescom-001');
  const body = { text: bescom.text, type: 'sms', sender: bescom.sender, trustedSenders: [] };

  it('drops disputed weak signals and keeps serious ones with a reason', async () => {
    const r = await reassess({ ...body, disputedSignalIds: ['urgency', 'money_request'], reason: 'my landlord', trustSender: false });
    expect(r.signals.some((s) => s.id === 'urgency')).toBe(false);
    const money = r.signals.find((s) => s.id === 'money_request');
    expect(money.keptNote).toMatch(/official/);
    expect(r.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'urgency', action: 'dropped' }),
        expect.objectContaining({ id: 'money_request', action: 'kept' }),
      ]),
    );
    const before = await analyze(body);
    expect(r.score).toBeLessThan(before.score);
  });

  it('trusting a sender reduces weak weights on later scans but never removes serious signals', async () => {
    const before = await analyze(body);
    const later = await analyze({ ...body, trustedSenders: ['9008012345'] });
    expect(later.senderTrusted).toBe(true);
    expect(later.score).toBeLessThan(before.score);
    expect(later.signals.some((s) => s.id === 'money_request')).toBe(true);
    expect(later.signals.find((s) => s.id === 'money_request').weightApplied).toBe(22);
  });

  it('a critical OTP scam can never be argued down below High by disputing everything', async () => {
    const kyc = seed[0];
    const first = await analyze({ text: kyc.text, type: 'sms', sender: kyc.sender, trustedSenders: [] });
    const ids = [...new Set(first.signals.map((s) => s.id))];
    const r = await reassess({ text: kyc.text, type: 'sms', sender: kyc.sender, trustedSenders: [], disputedSignalIds: ids, reason: 'it is my bank', trustSender: true });
    expect(['high', 'critical']).toContain(r.level);
    expect(r.signals.some((s) => s.id === 'otp_request')).toBe(true);
  });
});
