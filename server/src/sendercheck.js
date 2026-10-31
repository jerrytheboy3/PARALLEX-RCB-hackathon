// Sender comparison: the sender the user supplied vs the organisation they expected it from.
// String comparison only — no DNS, WHOIS or network lookups.

import { ORGS, isOfficialDomain, headerMatches, detectOrgs } from './orgs.js';
import { normaliseLabel, editDistance, registrableDomain, brandKeysFor } from './urlinspect.js';

const DOMAIN_RE = /^(?:[a-z][a-z0-9+.-]*:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[/:?#].*)?$/i;

/** Resolve "sbi.co.in", "https://www.sbi.co.in/", "SBI" or "State Bank" to an org and/or domains. */
export function resolveExpected(expected) {
  const s = String(expected || '').trim();
  if (!s) return null;
  const m = s.match(DOMAIN_RE);
  if (m) {
    const domain = m[1].toLowerCase();
    const org = ORGS.find((o) => isOfficialDomain(o, domain)) || null;
    return { input: s, org, domains: org ? org.officialDomains : [domain], domain };
  }
  const org = detectOrgs({ text: s }).find((o) => !o.generic) || null;
  return org ? { input: s, org, domains: org.officialDomains, domain: org.officialDomains[0] || null } : { input: s, org: null, domains: [], domain: null };
}

/** Brand names to look for: the org's known keys plus the expected domain's own name. */
const brandKeysOf = (expected) => {
  const d = expected.domain ? registrableDomain(expected.domain) : '';
  const own = normaliseLabel((d || '').split('.')[0] || '');
  return [...new Set([...(expected.org ? brandKeysFor(expected.org.id) : []), own].filter(Boolean))];
};

function looksLike(label, key) {
  if (!label || !key) return false;
  const n = normaliseLabel(label);
  if (n.includes(key) && key.length >= 3) return true;
  return key.length >= 5 && editDistance(n, key) <= (key.length >= 8 ? 2 : 1);
}

/**
 * @param {{senderInfo: object, expected?: string, orgs?: object[]}} args
 *   senderInfo comes from describeSender (never the raw phone number)
 * @returns {null | {kind, value, expected, verdict: 'match'|'lookalike'|'mismatch'|'unknown', reason, inferred}}
 */
export function compareSender({ senderInfo, expected, orgs = [] }) {
  const kind = senderInfo?.kind || 'none';
  let exp = resolveExpected(expected);
  let inferred = false;
  if (!exp && kind !== 'none') {
    const org = orgs.find((o) => !o.generic && o.officialDomains?.length);
    if (org) {
      exp = { input: null, org, domains: org.officialDomains, domain: org.officialDomains[0] };
      inferred = true;
    }
  }
  if (!exp) return null;

  const expectedOut = { input: exp.input, org: exp.org ? { id: exp.org.id, name: exp.org.short } : null, domains: exp.domains.slice(0, 4) };
  const base = { kind, expected: expectedOut, inferred };
  if (kind === 'none') return { ...base, value: null, verdict: 'unknown', reason: 'no_sender' };

  if (kind === 'email') {
    const d = senderInfo.domain;
    const match = exp.org ? isOfficialDomain(exp.org, d) : exp.domains.some((x) => d === x || d.endsWith(`.${x}`));
    if (match) return { ...base, value: d, verdict: 'match', reason: 'domain_match' };
    const label = registrableDomain(d).split('.')[0];
    const keys = brandKeysOf(exp);
    const hostLabels = d.split('.');
    if (keys.some((k) => looksLike(label, k) || hostLabels.some((l) => looksLike(l, k)))) return { ...base, value: d, verdict: 'lookalike', reason: 'domain_lookalike' };
    return { ...base, value: d, verdict: 'mismatch', reason: senderInfo.freemail ? 'freemail' : 'domain_different' };
  }

  if (kind === 'header') {
    const h = senderInfo.header;
    if (exp.org && headerMatches(exp.org, h)) return { ...base, value: h, verdict: 'match', reason: 'header_match' };
    if (exp.org && !(exp.org.officialSmsHeaders || []).length) return { ...base, value: h, verdict: 'unknown', reason: 'no_known_headers' };
    const id = h.replace(/^[A-Z]{2}-/, '').replace(/-[A-Z]$/, '');
    // Sender IDs are registered with TRAI, so a brand name in an unlisted header is more likely a
    // real ID missing from orgs.json than a fake: report it as unverified rather than a lookalike.
    if (brandKeysOf(exp).some((k) => looksLike(id, k.slice(0, Math.max(3, Math.min(k.length, 6)))))) return { ...base, value: h, verdict: 'unknown', reason: 'header_unlisted' };
    return { ...base, value: h, verdict: 'mismatch', reason: 'header_different' };
  }

  if (kind === 'mobile' || kind === 'intl' || kind === 'landline') {
    return { ...base, value: null, verdict: 'mismatch', reason: kind === 'intl' ? 'foreign_number' : 'personal_number' };
  }
  return { ...base, value: null, verdict: 'unknown', reason: 'unrecognised' };
}

/** Score impact: only when the user told us who to expect, or the sender is a lookalike. */
export function senderSignals(check) {
  if (!check) return [];
  const base = { start: null, end: null, lang: 'en', source: 'server', category: 'sender' };
  const who = check.expected.org?.name || check.expected.domains[0] || 'the organisation';
  if (check.verdict === 'lookalike') {
    return [{ ...base, id: 'sender_lookalike', strength: 'serious', weight: 28, evidence: check.value || '', explanation: `The sender "${check.value}" imitates ${who} but is not one of its official addresses.` }];
  }
  if (check.verdict === 'mismatch' && !check.inferred) {
    const serious = check.kind === 'email';
    return [{ ...base, id: 'sender_mismatch', strength: serious ? 'serious' : 'weak', weight: serious ? 22 : 15, evidence: check.value || '[PHONE]', explanation: `You expected ${who}, but this came from ${check.value ? `"${check.value}"` : 'a personal phone number'}, which is not theirs.` }];
  }
  return [];
}
