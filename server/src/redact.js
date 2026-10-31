// PII redaction BEFORE any analysis. Replaces personal values with tokens and keeps an
// offset map so spans found on the redacted text can be mapped back onto the original text.
// Offsets are JS string indices (UTF-16), the same unit the browser uses.

const ZW = '\\u200B-\\u200D\\u2060\\uFEFF'; // zero-width chars sometimes hidden inside numbers
const SEP = `[\\s\\-${ZW}]?`;

export const TOKENS = {
  email: '[EMAIL]',
  upi: '[UPI_ID]',
  card: '[CARD]',
  phone: '[PHONE]',
  aadhaar: '[AADHAAR]',
  pan: '[PAN]',
  account: '[ACCOUNT]',
  otp: '[OTP]',
};

const digitsOnly = (s) => s.replace(/\D/g, '');

function luhn(num) {
  let sum = 0;
  let dbl = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let d = num.charCodeAt(i) - 48;
    if (dbl) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

const OTP_WORDS = /otp|code|pin|password|passcode|verification|ಒಟಿಪಿ|ಓಟಿಪಿ|ಕೋಡ್/i;
const CURRENCY_BEFORE = /(?:rs\.?|₹|inr|usd|\$|rupees?)\s*$/i;

// Order = priority. Earlier rules claim text first; later rules skip overlapping matches.
const RULES = [
  {
    type: 'email',
    re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
  },
  {
    type: 'upi',
    // name@bank — no dot-TLD after the handle (that would be an email)
    re: /(?<![\w.@-])[A-Za-z0-9][\w.-]{1,255}@[A-Za-z][A-Za-z0-9]{1,63}(?![\w@-]|\.[A-Za-z])/g,
  },
  {
    type: 'card',
    re: new RegExp(`(?<![\\d])(?:\\d${SEP}){12,18}\\d(?!\\d)`, 'g'),
    accept: (m) => {
      const d = digitsOnly(m);
      return d.length >= 13 && d.length <= 19 && luhn(d);
    },
  },
  {
    type: 'phone', // Indian mobile: +91 / 0091 / 91 / 0 prefixes, 5-5 or 3-3-4 grouping
    re: new RegExp(
      `(?<![\\d+])(?:(?:\\+|00)?91${SEP}|0)?[6-9]\\d{4}${SEP}\\d{5}(?!\\d)` +
        `|(?<![\\d+])(?:(?:\\+|00)?91${SEP})?[6-9]\\d{2}[\\s\\-]\\d{3}[\\s\\-]\\d{4}(?!\\d)`,
      'g',
    ),
  },
  {
    type: 'phone', // international numbers (+44 7911 123456)
    re: /(?<![\d+])\+(?!91)\d{1,3}[\s-]?\d{2,5}(?:[\s-]?\d{2,5}){1,3}(?!\d)/g,
    accept: (m) => {
      const n = digitsOnly(m).length;
      return n >= 8 && n <= 15;
    },
  },
  {
    type: 'phone', // landline with STD code: 080-2345 6789
    re: /(?<!\d)0\d{2,4}[\s-]\d{3,4}[\s-]?\d{3,4}(?!\d)/g,
    accept: (m) => {
      const n = digitsOnly(m).length;
      return n >= 10 && n <= 12;
    },
  },
  {
    type: 'aadhaar',
    re: new RegExp(`(?<!\\d)[2-9]\\d{3}${SEP}\\d{4}${SEP}\\d{4}(?!\\d)`, 'g'),
  },
  {
    type: 'pan', // 4th letter is the holder type (P person, C company, …)
    re: /(?<![A-Za-z0-9])[A-Za-z]{3}[ABCFGHLJPTKEabcfghljptke][A-Za-z]\d{4}[A-Za-z](?![A-Za-z0-9])/g,
  },
  {
    type: 'account',
    re: /(?<!\d)\d{9,18}(?!\d)/g,
  },
  {
    type: 'otp',
    re: /(?<![A-Za-z\d₹,.])\d{4,8}(?![\d,]|\.\d|\/-|%)/g,
    accept: (m, text, index) => {
      if (CURRENCY_BEFORE.test(text.slice(Math.max(0, index - 8), index))) return false;
      const near = text.slice(Math.max(0, index - 40), index + m.length + 40);
      if (/^(19|20)\d\d$/.test(m) && !OTP_WORDS.test(near)) return false; // a year, not a code
      return true;
    },
  },
];

function findMatches(text) {
  const taken = [];
  const overlaps = (s, e) => taken.some((t) => s < t.end && e > t.start);
  for (const rule of RULES) {
    rule.re.lastIndex = 0;
    for (const m of text.matchAll(rule.re)) {
      const start = m.index;
      const end = start + m[0].length;
      if (overlaps(start, end)) continue;
      if (rule.accept && !rule.accept(m[0], text, start)) continue;
      taken.push({ type: rule.type, start, end });
    }
  }
  return taken.sort((a, b) => a.start - b.start);
}

export function emptySummary() {
  return { phone: 0, otp: 0, account: 0, card: 0, aadhaar: 0, pan: 0, upi: 0, email: 0 };
}

/**
 * @param {string} text original text
 * @returns {{
 *   redactedText: string,
 *   summary: Record<string, number>,
 *   matches: {type:string,start:number,end:number}[],   // positions in ORIGINAL text, never the values
 *   toOriginal: (start:number, end:number) => {start:number,end:number},
 * }}
 */
export function redact(text) {
  const input = typeof text === 'string' ? text : '';
  const matches = findMatches(input);
  const summary = emptySummary();
  const segments = []; // { rStart, rEnd, oStart, oEnd, token }
  let out = '';
  let o = 0;
  for (const m of matches) {
    if (m.start > o) {
      segments.push({ rStart: out.length, rEnd: out.length + (m.start - o), oStart: o, oEnd: m.start, token: false });
      out += input.slice(o, m.start);
    }
    const tok = TOKENS[m.type];
    segments.push({ rStart: out.length, rEnd: out.length + tok.length, oStart: m.start, oEnd: m.end, token: true });
    out += tok;
    summary[m.type] += 1;
    o = m.end;
  }
  if (o < input.length) {
    segments.push({ rStart: out.length, rEnd: out.length + (input.length - o), oStart: o, oEnd: input.length, token: false });
    out += input.slice(o);
  }

  function mapStart(r) {
    if (r <= 0) return 0;
    if (r >= out.length) return input.length;
    const seg = segments.find((s) => r >= s.rStart && r < s.rEnd);
    if (!seg) return input.length;
    return seg.token ? seg.oStart : seg.oStart + (r - seg.rStart);
  }
  function mapEnd(r) {
    if (r <= 0) return 0;
    if (r >= out.length) return input.length;
    const seg = segments.find((s) => r > s.rStart && r <= s.rEnd);
    if (!seg) return 0;
    return seg.token ? seg.oEnd : seg.oStart + (r - seg.rStart);
  }

  return {
    redactedText: out,
    summary,
    matches,
    toOriginal: (start, end) => ({ start: mapStart(start), end: mapEnd(end) }),
  };
}

/** Redact a short value and return only the redacted string. */
export function redactValue(value) {
  if (typeof value !== 'string' || !value) return value;
  return redact(value).redactedText;
}

const FREEMAIL = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'yahoo.in', 'ymail.com', 'outlook.com', 'outlook.in',
  'hotmail.com', 'live.com', 'msn.com', 'rediffmail.com', 'aol.com', 'icloud.com', 'me.com', 'protonmail.com',
  'proton.me', 'gmx.com', 'mail.com', 'zohomail.in', 'yandex.com',
]);

/**
 * Describe a sender's STRUCTURE without passing the raw number/address on.
 * @returns {{ redacted: string|undefined, info: object }}
 */
export function describeSender(sender) {
  const s = typeof sender === 'string' ? sender.trim() : '';
  if (!s) return { redacted: undefined, info: { kind: 'none' } };

  const email = s.match(/<?([A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}))>?\s*$/);
  if (email) {
    const domain = email[2].toLowerCase();
    return { redacted: '[EMAIL]', info: { kind: 'email', domain, freemail: FREEMAIL.has(domain) } };
  }

  const compact = s.replace(new RegExp(`[\\s\\-()${ZW}]`, 'g'), '');
  if (/^(?:(?:\+|00)?91|0)?[6-9]\d{9}$/.test(compact)) return { redacted: '[PHONE]', info: { kind: 'mobile' } };
  if (/^(?:\+|00)\d{8,15}$/.test(compact)) return { redacted: '[PHONE]', info: { kind: 'intl' } };
  if (/^0\d{9,11}$/.test(compact)) return { redacted: '[PHONE]', info: { kind: 'landline' } };
  if (/^\d{5,6}$/.test(compact)) return { redacted: compact, info: { kind: 'shortcode' } };

  // TRAI-style header: VM-SBIINB, AD-HDFCBK, JX-SBIINB-S, or bare SBIINB
  const header = s.toUpperCase();
  if (/^[A-Z]{2}-[A-Z0-9]{3,9}(?:-[A-Z])?$/.test(header) || /^[A-Z]{6}$/.test(header)) {
    return { redacted: header, info: { kind: 'header', header } };
  }
  return { redacted: redactValue(s).slice(0, 80), info: { kind: 'name' } };
}

/** Normalise a sender for "trusted sender" comparisons (never logged or stored server-side). */
export function senderKey(sender) {
  if (typeof sender !== 'string') return '';
  const s = sender.trim().toLowerCase();
  const digits = s.replace(/\D/g, '');
  if (/^[+\d\s\-()]+$/.test(s) && digits.length >= 10) return digits.slice(-10);
  return s.replace(/\s+/g, '');
}
