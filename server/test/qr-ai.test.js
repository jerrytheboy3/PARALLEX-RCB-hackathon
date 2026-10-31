import { describe, it, expect } from 'vitest';
import { analyzeQrContent } from '../src/qr.js';
import { analyze } from '../src/pipeline.js';
import { buildPrompt, cleanExplanation } from '../src/ai.js';

describe('QR content analysis', () => {
  it('upi:// QR shows payee, amount and note, and flags "scan to receive" as serious', () => {
    const r = analyzeQrContent('upi://pay?pa=cashback.rewards@ybl&pn=Amazon%20Rewards&am=4999&cu=INR&tn=Scan%20to%20receive%20cashback');
    expect(r.qr).toMatchObject({ kind: 'upi', payeeVpa: 'cashback.rewards@ybl', payeeName: 'Amazon Rewards', amount: '4999', note: 'Scan to receive cashback' });
    const s = r.signals.find((x) => x.id === 'upi_receive_scam');
    expect(s.strength).toBe('serious');
    expect(r.displayText.slice(s.start, s.end)).toBe(s.evidence);
    // the bait word is in the note, not inside the VPA
    expect(r.displayText.slice(0, s.start)).toContain('Note:');
  });

  it('"receive" bait can come from the message that came with the QR', () => {
    const r = analyzeQrContent('upi://pay?pa=shop@okicici&pn=Shop', 'Scan this to get your refund of Rs 2000');
    expect(r.signals.some((x) => x.id === 'upi_receive_scam')).toBe(true);
  });

  it('a plain shop UPI QR has no serious signal', () => {
    const r = analyzeQrContent('upi://pay?pa=sharma.kirana@okicici&pn=Sharma%20Kirana%20Store&cu=INR');
    expect(r.signals).toEqual([]);
  });

  it('http(s) QR is analysed like a message containing the link; plain text as text', async () => {
    const url = await analyze({ type: 'qr', text: 'https://sbi-rewards-claim.xyz/redeem?ref=QR', trustedSenders: [] });
    expect(url.qr.kind).toBe('url');
    expect(url.links[0].verdict).toBe('dangerous');
    expect(['high', 'critical']).toContain(url.level);
    const txt = await analyze({ type: 'qr', text: 'WIFI:S:CafeNet;T:WPA;P:hello;;', trustedSenders: [] });
    expect(txt.qr.kind).toBe('text');
  });

  it('UPI receive-scam QR is Critical through the full pipeline; VPA is redacted in redactedText', async () => {
    const r = await analyze({ type: 'qr', text: 'upi://pay?pa=cashback.rewards@ybl&pn=Amazon%20Rewards&am=4999&tn=Scan%20to%20receive%20cashback', trustedSenders: [] });
    expect(r.level).toBe('critical');
    expect(r.redactedText).not.toContain('cashback.rewards@ybl');
    expect(r.redactedText).toContain('[UPI_ID]');
    for (const s of r.signals.filter((x) => x.start !== null)) expect(r.displayText.slice(s.start, s.end).length).toBeGreaterThan(0);
  });

  it('malformed upi:// does not crash', () => {
    expect(() => analyzeQrContent('upi://pay?pa=%E0%A4%A&&=&am')).not.toThrow();
  });
});

describe('AI prompt & output guard', () => {
  it('prompt carries the fixed level and instructions, and supports Kannada', () => {
    const p = buildPrompt({ redactedText: 'share [OTP]', signals: [{ id: 'otp_request', strength: 'serious', evidence: 'share [OTP]', explanation: 'x' }], level: 'critical', lang: 'kn' });
    expect(p).toContain('CRITICAL');
    expect(p).toContain('Kannada');
    expect(p).toContain('otp_request');
  });

  it('cleans markdown, links and numbers, keeps max 3 sentences', () => {
    const t = cleanExplanation('**Warning!** One. Two. Three. Four. Visit https://x.com or call 98765 43210.', 'high');
    expect(t).not.toMatch(/\*|https|98765/);
    expect(t.split(/[.!?]/).filter((x) => x.trim()).length).toBeLessThanOrEqual(3);
  });

  it('rejects text that contradicts the level', () => {
    expect(cleanExplanation('This looks safe to me.', 'critical')).toBeNull();
    expect(cleanExplanation('This is a scam.', 'safe')).toBeNull();
    expect(cleanExplanation('Be careful: it asks for your OTP.', 'high')).toBeTruthy();
  });
});
