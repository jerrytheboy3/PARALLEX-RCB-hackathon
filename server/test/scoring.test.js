import { describe, it, expect } from 'vitest';
import { scoreSignals, levelFor, SCORING, verdictFor } from '../src/scoring.js';

const s = (id, category, strength, weight) => ({ id, category, strength, weight, start: 0, end: 1 });

describe('scoring', () => {
  it('level thresholds: Safe < 20, Caution 20–44, High 45–74, Critical ≥ 75', () => {
    expect(levelFor(0, true)).toBe('safe');
    expect(levelFor(19, true)).toBe('safe');
    expect(levelFor(20, true)).toBe('caution');
    expect(levelFor(44, true)).toBe('caution');
    expect(levelFor(45, true)).toBe('high');
    expect(levelFor(74, true)).toBe('high');
    expect(levelFor(75, true)).toBe('critical');
    expect(levelFor(100, true)).toBe('critical');
  });

  it('weak signals alone never exceed Caution, however many', () => {
    const many = Array.from({ length: 10 }, (_, i) => s(`weak_${i}`, 'urgency', 'weak', 40));
    const r = scoreSignals({ signals: many });
    expect(r.level).toBe('caution');
    expect(r.score).toBeLessThanOrEqual(SCORING.weakOnlyMax);
  });

  it('critical requires at least one serious signal', () => {
    expect(levelFor(99, false)).not.toBe('critical');
    const r = scoreSignals({ signals: [s('otp_request', 'credential', 'serious', 35), s('dangerous_link', 'link', 'serious', 30), s('urgency', 'urgency', 'weak', 10)] });
    expect(r.level).toBe('critical');
  });

  it('caps at 100', () => {
    const r = scoreSignals({ signals: ['a', 'b', 'c', 'd'].map((id) => s(id, 'credential', 'serious', 40)) });
    expect(r.score).toBe(100);
  });

  it('repeated signal ids count once', () => {
    const r = scoreSignals({ signals: [s('urgency', 'urgency', 'weak', 10), s('urgency', 'urgency', 'weak', 10), s('urgency', 'urgency', 'weak', 10)] });
    expect(r.score).toBe(10);
  });

  it('applies combination bonuses', () => {
    const r = scoreSignals({ signals: [s('otp_request', 'credential', 'serious', 35), s('suspicious_link', 'link', 'weak', 15)] });
    expect(r.combos.map((c) => c.id)).toContain('credential_link');
    expect(r.score).toBe(35 + 15 + 20);
  });

  it('threat + police org combo', () => {
    const r = scoreSignals({ signals: [s('threat', 'threat', 'weak', 12)], orgs: [{ id: 'police' }] });
    expect(r.combos.map((c) => c.id)).toContain('threat_police');
  });

  it('official/trusted sender halves weak signals but never touches serious ones', () => {
    const sigs = [s('urgency', 'urgency', 'weak', 10), s('otp_request', 'credential', 'serious', 35)];
    const r = scoreSignals({ signals: sigs, senderVerified: true, senderTrusted: true });
    expect(r.signals.find((x) => x.id === 'urgency').weightApplied).toBe(2.5);
    expect(r.signals.find((x) => x.id === 'otp_request').weightApplied).toBe(35);
  });

  it('no signals → Safe with score 0', () => {
    expect(scoreSignals({ signals: [] })).toMatchObject({ score: 0, level: 'safe' });
  });

  it('verdict is one templated sentence naming org and topic', () => {
    const v = verdictFor({ level: 'critical', signals: [s('otp_request', 'credential', 'serious', 35)], orgs: [{ id: 'sbi', short: 'SBI' }], text: 'update KYC' });
    expect(v).toBe('This looks like a fake SBI KYC message trying to get your login details or OTP.');
    expect(verdictFor({ level: 'safe', signals: [], orgs: [], text: '' })).not.toMatch(/100%|completely safe/i);
  });
});
