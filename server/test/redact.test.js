import { describe, it, expect } from 'vitest';
import { redact, redactValue, describeSender, senderKey } from '../src/redact.js';

describe('redact — what gets replaced', () => {
  const cases = [
    ['Call +91 98765 43210 now', '[PHONE]', 'phone'],
    ['Call 9876543210 now', '[PHONE]', 'phone'],
    ['Call +91-9876543210 now', '[PHONE]', 'phone'],
    ['Call 098765 43210 now', '[PHONE]', 'phone'],
    ['Call 919876543210 now', '[PHONE]', 'phone'],
    ['Call +44 7911 123456 now', '[PHONE]', 'phone'],
    ['Call 080-2345 6789 now', '[PHONE]', 'phone'],
    ['Your OTP is 482913.', '[OTP]', 'otp'],
    ['Code 4829', '[OTP]', 'otp'],
    ['A/c 123456789012345 debited', '[ACCOUNT]', 'account'],
    ['Card 4111 1111 1111 1111 blocked', '[CARD]', 'card'],
    ['Card 4111-1111-1111-1111 blocked', '[CARD]', 'card'],
    ['Aadhaar 2345 6789 0123 linked', '[AADHAAR]', 'aadhaar'],
    ['Aadhaar 234567890123 linked', '[AADHAAR]', 'aadhaar'],
    ['PAN ABCPE1234F expired', '[PAN]', 'pan'],
    ['Pay to ramesh.k@okaxis today', '[UPI_ID]', 'upi'],
    ['Pay to 9876543210@ybl today', '[UPI_ID]', 'upi'],
    ['Mail me at someone@example.com', '[EMAIL]', 'email'],
  ];
  it.each(cases)('%s → %s', (input, token, type) => {
    const r = redact(input);
    expect(r.redactedText).toContain(token);
    expect(r.summary[type]).toBe(1);
    expect(r.redactedText).not.toMatch(/\d{4,}/);
  });

  it('does not redact amounts, years, times or short numbers', () => {
    const t = 'Pay Rs 2500 or ₹1,240 or Rs.5000 by 15-11-2026 at 9:30, order 141, 1999/- only';
    const r = redact(t);
    expect(r.redactedText).toBe(t);
  });

  it('a 16-digit number that fails Luhn is not called a card', () => {
    const r = redact('Ref 1234567812345678');
    expect(r.summary.card).toBe(0);
    expect(r.redactedText).toBe('Ref [ACCOUNT]');
  });

  it('handles zero-width characters hidden inside a phone number', () => {
    const r = redact('call 98765​43210');
    expect(r.redactedText).toBe('call [PHONE]');
  });

  it('never leaks values into matches metadata', () => {
    const r = redact('OTP 482913 to 9876543210');
    expect(JSON.stringify(r.matches)).not.toContain('482913');
    expect(JSON.stringify(r.matches)).not.toContain('9876543210');
  });
});

describe('redact — offset mapping back to original text', () => {
  const check = (original, word) => {
    const r = redact(original);
    const rs = r.redactedText.indexOf(word);
    expect(rs).toBeGreaterThanOrEqual(0);
    const m = r.toOriginal(rs, rs + word.length);
    expect(original.slice(m.start, m.end)).toBe(word);
  };

  it('maps words after one or more tokens', () => {
    const t = 'Call 9876543210 and share OTP 482913 with agent at +91 98765 43210 immediately';
    check(t, 'share OTP');
    check(t, 'immediately');
    check(t, 'Call');
  });

  it('maps a span that covers a token onto the full original value', () => {
    const t = 'pay to ramesh@okaxis now';
    const r = redact(t);
    const s = r.redactedText.indexOf('pay');
    const e = r.redactedText.indexOf(' now');
    const m = r.toOriginal(s, e);
    expect(t.slice(m.start, m.end)).toBe('pay to ramesh@okaxis');
  });

  it('maps exactly on Kannada text, with a phone number before the span', () => {
    const t = 'ಕರೆ ಮಾಡಿ 9876543210 ತಕ್ಷಣ OTP ಅನ್ನು ತಿಳಿಸಿ. ನಿಮ್ಮ ಖಾತೆ 123456789012 ಬ್ಲಾಕ್ ಆಗುತ್ತದೆ';
    check(t, 'ತಕ್ಷಣ');
    check(t, 'OTP ಅನ್ನು ತಿಳಿಸಿ');
    check(t, 'ಬ್ಲಾಕ್');
    check(t, 'ಕರೆ ಮಾಡಿ');
  });

  it('identity mapping when nothing is redacted', () => {
    const t = 'nothing personal here';
    const r = redact(t);
    expect(r.redactedText).toBe(t);
    expect(r.toOriginal(8, 16)).toEqual({ start: 8, end: 16 });
  });

  it('edges: start/end of text', () => {
    const t = '9876543210 is calling';
    const r = redact(t);
    expect(r.toOriginal(0, r.redactedText.length)).toEqual({ start: 0, end: t.length });
    expect(r.toOriginal(0, 7)).toEqual({ start: 0, end: 10 });
  });
});

describe('describeSender — structure without the raw value', () => {
  it.each([
    ['+91 98765 43210', 'mobile', '[PHONE]'],
    ['9876543210', 'mobile', '[PHONE]'],
    ['+44 7911 123456', 'intl', '[PHONE]'],
    ['VM-SBIINB', 'header', 'VM-SBIINB'],
    ['jx-sbiinb-s', 'header', 'JX-SBIINB-S'],
    ['56767', 'shortcode', '56767'],
    ['', 'none', undefined],
  ])('%s → %s', (input, kind, redacted) => {
    const r = describeSender(input);
    expect(r.info.kind).toBe(kind);
    expect(r.redacted).toBe(redacted);
  });

  it('email sender keeps only the domain', () => {
    const r = describeSender('Amazon HR <amazon.hr.recruit@gmail.com>');
    expect(r.redacted).toBe('[EMAIL]');
    expect(r.info).toEqual({ kind: 'email', domain: 'gmail.com', freemail: true });
    expect(JSON.stringify(r)).not.toContain('recruit');
  });

  it('senderKey normalises phone formats', () => {
    expect(senderKey('+91 98765 43210')).toBe(senderKey('9876543210'));
    expect(senderKey('VM-SBIINB')).toBe('vm-sbiinb');
  });

  it('redactValue returns redacted string', () => {
    expect(redactValue('otp 123456')).toBe('otp [OTP]');
  });
});
