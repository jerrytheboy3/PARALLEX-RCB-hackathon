import { readFileSync } from 'node:fs';

export const ORGS = JSON.parse(readFileSync(new URL('./orgs.json', import.meta.url), 'utf8')).orgs;
const BY_ID = new Map(ORGS.map((o) => [o.id, o]));

export const getOrg = (id) => BY_ID.get(id);

const ZW = /[​-‍⁠﻿]/g;
const norm = (s) => String(s || '').normalize('NFC').replace(ZW, '').toLowerCase();
// Redaction tokens must not count as mentions ("[UPI_ID]" is not the user talking about UPI).
const TOKEN_RE = /\[(?:phone|otp|account|card|aadhaar|pan|upi_id|email)\]/g;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const isLatin = (s) => /^[\x20-\x7E]+$/.test(s);

// Pre-compile alias matchers. Latin aliases need word boundaries; Kannada ones are substring matches.
const MATCHERS = ORGS.map((org) => {
  const all = [...(org.aliases.en || []), ...(org.aliases.kn || []), ...(org.aliases.kanglish || []), ...(org.aliases.hi || []), ...(org.aliases.hinglish || [])].map(norm);
  const latin = all.filter(isLatin);
  const other = all.filter((a) => !isLatin(a));
  const re = latin.length
    ? new RegExp(`(?<![a-z0-9])(?:${latin.map((a) => escape(a).replace(/\\?\s+/g, '[\\s-]*')).join('|')})(?![a-z0-9])`, 'i')
    : null;
  return { org, re, other };
});

function firstIndex(text, m) {
  let best = -1;
  if (m.re) {
    const hit = text.match(m.re);
    if (hit) best = hit.index;
  }
  for (const a of m.other) {
    const i = text.indexOf(a);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  return best;
}

function headerPatternToRegex(p) {
  return new RegExp(`^${p.split('*').map(escape).join('[A-Z0-9]{2}')}(?:-[A-Z])?$`, 'i');
}

export function headerMatches(org, header) {
  if (!header) return false;
  const h = header.toUpperCase();
  return (org.officialSmsHeaders || []).some((p) => headerPatternToRegex(p).test(h) || h === p.replace(/^\*-/, ''));
}

export function isOfficialDomain(org, host) {
  const h = String(host || '').toLowerCase().replace(/^www\./, '');
  return (org.officialDomains || []).some((d) => h === d || h.endsWith(`.${d}`));
}

export function hostOf(url) {
  return String(url || '').replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').split(/[/:?#@]/)[0].toLowerCase().replace(/^www\./, '');
}

/**
 * Organisations the message claims to be from / talks about, in order of first mention.
 * Also counts an org whose official SMS header or email domain sent the message.
 */
export function detectOrgs({ text, subject, senderInfo, engineClaims = [] }) {
  const hay = norm(`${subject || ''}\n${text || ''}`).replace(TOKEN_RE, (t) => ' '.repeat(t.length));
  const found = [];
  for (const m of MATCHERS) {
    const i = firstIndex(hay, m);
    if (i >= 0) found.push({ org: m.org, i });
  }
  for (const org of ORGS) {
    if (found.some((f) => f.org.id === org.id)) continue;
    const viaHeader = senderInfo?.kind === 'header' && headerMatches(org, senderInfo.header);
    const viaDomain = senderInfo?.kind === 'email' && isOfficialDomain(org, senderInfo.domain);
    const viaEngine = engineClaims.includes(org.id);
    if (viaHeader || viaDomain || viaEngine) found.push({ org, i: viaEngine ? hay.length : -1 });
  }
  const ordered = found.sort((a, b) => a.i - b.i).map((f) => f.org);
  // The organisation whose official header/domain SENT the message comes first, so a bank OTP
  // that mentions a merchant ("txn at Amazon … -SBI" from VM-SBIINB) gets the bank's advice.
  const senderOrg = ordered.find(
    (o) => (senderInfo?.kind === 'header' && headerMatches(o, senderInfo.header)) || (senderInfo?.kind === 'email' && isOfficialDomain(o, senderInfo.domain)),
  );
  return senderOrg ? [senderOrg, ...ordered.filter((o) => o !== senderOrg)] : ordered;
}

/** Does the sender match an official header/domain of one of the claimed orgs? */
export function senderIsOfficial(orgs, senderInfo) {
  if (!senderInfo) return false;
  if (senderInfo.kind === 'header') return orgs.some((o) => headerMatches(o, senderInfo.header));
  if (senderInfo.kind === 'email') return orgs.some((o) => isOfficialDomain(o, senderInfo.domain));
  return false;
}

/**
 * Server-side signal: message names an organisation but links somewhere that isn't theirs.
 * Offsets are in whatever text the links came from (redacted text in the pipeline).
 */
export function orgLinkMismatch(links, orgs) {
  const specific = orgs.filter((o) => !o.generic && o.officialDomains?.length);
  if (!specific.length) return [];
  const out = [];
  for (const l of links) {
    const host = hostOf(l.url);
    if (!host) continue;
    if (ORGS.some((o) => isOfficialDomain(o, host))) continue;
    const o = specific[0];
    out.push({
      id: 'org_link_mismatch',
      category: 'impersonation',
      strength: 'serious',
      weight: 25,
      start: l.start,
      end: l.end,
      evidence: l.url,
      explanation: `Mentions ${o.short}, but this link is not an official ${o.short} website (theirs is ${o.officialDomains[0]}).`,
      lang: 'en',
      source: 'server',
    });
  }
  return out;
}

const GENERIC_STEPS = {
  orgId: 'generic',
  title: 'Check it safely',
  steps: [
    'Do not click links or call numbers given in the message.',
    'Open the official app, or type the official website address yourself.',
    'Call the number printed on your card, bill or passbook — not one from the message.',
    'Never share OTP, PIN, CVV or passwords. No real bank, company or police officer will ask.',
  ],
  officialDomains: [],
};

export function verifyStepsFor(orgs) {
  const list = orgs.slice(0, 3).map((o) => ({
    orgId: o.id,
    title: o.generic ? `About ${o.name}` : `Check with ${o.short} directly`,
    steps: o.verifySteps,
    ...(o.officialApp ? { officialApp: o.officialApp } : {}),
    officialDomains: o.officialDomains || [],
  }));
  return list.length ? list : [GENERIC_STEPS];
}
