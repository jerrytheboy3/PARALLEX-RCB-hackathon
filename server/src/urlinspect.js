// URL inspection — string analysis ONLY. Nothing here opens, fetches or resolves a URL.
// Each link gets a list of visible-domain checks the UI shows as ✓ / ⚠ rows.

import { ORGS, isOfficialDomain } from './orgs.js';

// Public suffixes we care about; anything else uses the last label as the suffix.
const TWO_LEVEL = new Set([
  'co.in', 'gov.in', 'org.in', 'net.in', 'ac.in', 'nic.in', 'bank.in', 'firm.in', 'gen.in', 'ind.in', 'res.in', 'edu.in',
  'co.uk', 'org.uk', 'gov.uk', 'ac.uk', 'com.au', 'co.nz', 'com.sg', 'com.br', 'co.za',
]);
const SHORTENERS = new Set([
  'bit.ly', 'bitly.com', 'tinyurl.com', 't.co', 'cutt.ly', 'is.gd', 'goo.gl', 'rb.gy', 'shorturl.at', 'tiny.cc', 'ow.ly',
  's.id', 'v.gd', 'rebrand.ly', 't.ly', 'shorte.st', 'adf.ly', 'bl.ink', 'short.io', 'tiny.one', 'qr.ae', 'wa.link',
]);
export const RISKY_TLDS = new Set([
  'xyz', 'top', 'click', 'link', 'site', 'online', 'live', 'buzz', 'icu', 'rest', 'tk', 'ml', 'ga', 'cf', 'gq', 'pw', 'vip',
  'win', 'loan', 'work', 'support', 'shop', 'cc', 'cyou', 'sbs', 'cfd', 'monster', 'quest', 'bond', 'zip', 'mov', 'party',
]);

// Brand keys used for lookalike detection → the organisation they belong to.
const BRAND_KEYS = [
  ['sbi', 'sbi'], ['onlinesbi', 'sbi'], ['statebank', 'sbi'], ['yono', 'sbi'],
  ['hdfc', 'hdfc'], ['hdfcbank', 'hdfc'], ['icici', 'icici'], ['icicibank', 'icici'], ['axisbank', 'axis'], ['kotak', 'kotak'],
  ['paytm', 'paytm'], ['phonepe', 'phonepe'], ['gpay', 'gpay'], ['googlepay', 'gpay'], ['amazon', 'amazon'], ['flipkart', 'flipkart'],
  ['indiapost', 'indiapost'], ['irctc', 'irctc'], ['incometax', 'incometax'], ['uidai', 'uidai'], ['aadhaar', 'uidai'],
  ['bescom', 'bescom'], ['airtel', 'airtel'], ['jio', 'jio'], ['bluedart', 'bluedart'], ['delhivery', 'delhivery'], ['npci', 'npci'],
  // International brands often impersonated. 'token' = must be a whole word ("chase" ≠ "purchase").
  ['irs', 'irs'], ['usps', 'usps'], ['ups', 'ups', 'token'], ['fedex', 'fedex'], ['dhl', 'dhl'], ['royalmail', 'royalmail'],
  ['canadapost', 'canadapost'], ['paypal', 'paypal'], ['chase', 'chase', 'token'], ['wellsfargo', 'wellsfargo'],
  ['bankofamerica', 'bofa'], ['citi', 'citi', 'token'], ['citibank', 'citi'], ['capitalone', 'capitalone'], ['venmo', 'venmo'],
  ['zelle', 'zelle'], ['revolut', 'revolut'], ['apple', 'apple', 'token'], ['icloud', 'apple'], ['microsoft', 'microsoft'],
  ['norton', 'norton', 'token'], ['mcafee', 'mcafee'],
];
const ORG_BY_ID = new Map(ORGS.map((o) => [o.id, o]));

/** Every brand key for one organisation ("hdfc" → ["hdfc", "hdfcbank"]). */
export const brandKeysFor = (orgId) => BRAND_KEYS.filter(([, id]) => id === orgId).map(([k]) => k);

// Characters scammers swap in to fake a brand name ("amaz0n", "paypa1", Cyrillic "а").
const HOMOGLYPHS = {
  0: 'o', 1: 'l', 3: 'e', 4: 'a', 5: 's', 7: 't', 8: 'b', 9: 'g', '@': 'a', '$': 's',
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'і': 'i', 'ј': 'j', 'ԁ': 'd', 'ӏ': 'l', 'ո': 'n', 'ս': 'u',
};

export function normaliseLabel(label) {
  return [...String(label).toLowerCase().normalize('NFKC')]
    .map((c) => HOMOGLYPHS[c] ?? c)
    .join('')
    .replace(/rn/g, 'm')
    .replace(/vv/g, 'w')
    .replace(/[^a-z0-9]/g, '');
}

export function editDistance(a, b) {
  if (a === b) return 0;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
  }
  return dp[a.length][b.length];
}

/** Split "https://user@sub.example.co.in:8080/path?q" into its visible parts. */
export function parseUrl(raw) {
  const s = String(raw || '').trim();
  const scheme = (s.match(/^([a-z][a-z0-9+.-]*):\/\//i) || [])[1]?.toLowerCase() || null;
  const afterScheme = scheme ? s.slice(scheme.length + 3) : s;
  const authEnd = afterScheme.search(/[/?#]/);
  const authority = authEnd < 0 ? afterScheme : afterScheme.slice(0, authEnd);
  const rest = authEnd < 0 ? '' : afterScheme.slice(authEnd);
  const at = authority.lastIndexOf('@');
  const hostPort = at >= 0 ? authority.slice(at + 1) : authority;
  const host = hostPort.replace(/:\d+$/, '').toLowerCase().replace(/\.$/, '');
  const hostOffset = (scheme ? scheme.length + 3 : 0) + (at >= 0 ? at + 1 : 0);
  return { scheme, host, hostOffset, hasUserInfo: at >= 0, path: rest };
}

export function registrableDomain(host) {
  if (!host || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return host;
  const labels = host.replace(/^www\./, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const last2 = labels.slice(-2).join('.');
  return TWO_LEVEL.has(last2) ? labels.slice(-3).join('.') : last2;
}

function findBrand(label) {
  const n = normaliseLabel(label);
  if (!n) return null;
  const tokens = String(label).toLowerCase().split(/[^a-z0-9Ѐ-ӿ]+/).map(normaliseLabel).filter(Boolean);
  for (const [key, orgId, mode] of BRAND_KEYS) {
    // short keys ("sbi", "jio") and common words must be a whole token; longer ones may be embedded ("hdfcbank-kyc")
    if (tokens.includes(key) || (mode !== 'token' && key.length >= 5 && n.includes(key))) return { key, orgId, how: 'contains' };
  }
  for (const [key, orgId, mode] of BRAND_KEYS) {
    if (key.length < 5 || mode === 'token') continue;
    const d = editDistance(n, key);
    if (d > 0 && d <= (key.length >= 8 ? 2 : 1)) return { key, orgId, how: 'typo' };
  }
  return null;
}

const isOfficialAnywhere = (host) => ORGS.some((o) => isOfficialDomain(o, host));

/**
 * @param {string} raw the URL exactly as it appears in the message
 * @returns {{raw, host, domain, domainStart, domainEnd, checks: {id, passed: boolean|null, params?: object}[], lookalike: object|null}}
 *          domainStart/End are offsets into `raw` so the UI can bold the real domain.
 */
export function inspectUrl(raw) {
  const { scheme, host, hostOffset, hasUserInfo, path } = parseUrl(raw);
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  const domain = registrableDomain(host);
  const at = raw.toLowerCase().indexOf(domain, hostOffset);
  const domainStart = at >= 0 ? at : null;
  const domainEnd = at >= 0 ? at + domain.length : null;
  const official = isOfficialAnywhere(host);
  const tld = domain.split('.').pop();
  const sub = host.replace(/^www\./, '').slice(0, Math.max(0, host.replace(/^www\./, '').length - domain.length - 1));
  const subLabels = sub ? sub.split('.') : [];

  const checks = [];
  checks.push({ id: 'https', passed: scheme === 'https' ? true : scheme === 'http' ? false : null });
  checks.push({ id: 'ip', passed: !isIp });
  checks.push({ id: 'shortener', passed: !SHORTENERS.has(host.replace(/^www\./, '')), params: { host } });
  checks.push({ id: 'tld', passed: isIp || !RISKY_TLDS.has(tld), params: { tld } });

  let lookalike = null;
  if (!isIp && !official) {
    const label = domain.split('.')[0];
    const b = findBrand(label);
    if (b) {
      const org = ORG_BY_ID.get(b.orgId);
      lookalike = { orgId: b.orgId, brand: org?.short || b.key, official: org?.officialDomains?.[0] || null, how: b.how };
    }
  }
  checks.push({ id: 'lookalike', passed: !lookalike, params: lookalike ? { brand: lookalike.brand, official: lookalike.official } : undefined });

  let brandInSub = null;
  if (!official && subLabels.length) {
    for (const l of subLabels) {
      const b = findBrand(l);
      if (b) {
        brandInSub = ORG_BY_ID.get(b.orgId)?.short || b.key;
        break;
      }
    }
  }
  checks.push({ id: 'brand_subdomain', passed: !brandInSub, params: brandInSub ? { brand: brandInSub, domain } : undefined });
  checks.push({ id: 'subdomains', passed: subLabels.length < 3, params: { count: subLabels.length } });
  checks.push({ id: 'at_sign', passed: !hasUserInfo });
  checks.push({ id: 'punycode', passed: !(host.includes('xn--') || /[^\x00-\x7f]/.test(host)) });
  const obfuscated = path.length > 80 || (path.match(/%[0-9a-f]{2}/gi) || []).length >= 4 || /[A-Za-z0-9_-]{40,}/.test(path) || /\/\//.test(path);
  checks.push({ id: 'path', passed: !obfuscated, params: { length: path.length } });

  return { raw, host, domain, domainStart, domainEnd, official, checks, lookalike };
}

/**
 * Inspect every engine link. Adds a server signal for a lookalike domain the engine did not
 * already flag as dangerous (so the same link is never double-counted).
 * Offsets are in the same text the links came from.
 */
export function inspectLinks(links, signals = []) {
  const urls = [];
  const extraSignals = [];
  for (const l of links) {
    const info = inspectUrl(l.url);
    urls.push({ ...info, start: l.start, end: l.end, verdict: l.verdict, reasons: l.reasons });
    const alreadyDangerous = signals.some((s) => s.id === 'dangerous_link' && s.start === l.start && s.end === l.end);
    if (info.lookalike && !alreadyDangerous) {
      extraSignals.push({
        id: 'lookalike_domain',
        category: 'impersonation',
        strength: 'serious',
        weight: 25,
        start: l.start,
        end: l.end,
        evidence: l.url,
        explanation: `"${info.domain}" is made to look like ${info.lookalike.brand}${info.lookalike.official ? `, but the real website is ${info.lookalike.official}` : ''}.`,
        lang: 'en',
        source: 'server',
      });
    }
  }
  return { urls, extraSignals };
}
