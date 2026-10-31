// P1 baseline: the "dumb" keyword filter (CONTRACT.md §3).
// JavaScript port of baseline/python/dumb_filter.py — same word list, same substring
// matching — so `npm run eval` can compare it with TrustLens on the same dataset.
export const baselineName = 'p1';

export const NAIVE_BAD_WORDS = ['urgent', 'immediately', 'block', 'disconnected', 'otp', 'password', 'click', 'pay', 'verify', 'bill', 'cut', 'turthu', 'challan'];

export function keywordFilter(text) {
  const clean = String(text ?? '').toLowerCase();
  const matched = NAIVE_BAD_WORDS.filter((w) => clean.includes(w));
  return { flagged: matched.length > 0, matched };
}
