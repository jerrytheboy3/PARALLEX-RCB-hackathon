// Deterministic, rule-based risk scoring. The AI model NEVER influences this.
// Every number lives in SCORING so the team can tune in one place.

export const SCORING = {
  cap: 100,
  thresholds: { caution: 20, high: 45, critical: 75 }, // safe < 20 ≤ caution < 45 ≤ high < 75 ≤ critical
  weakOnlyMax: 44, // weak signals alone can never exceed Caution
  criticalRequiresSerious: true,
  // Repeated signals with the same id count once (the highest weight), so "URGENT!!! urgent" ≠ 2× risk.
  dedupeById: true,
  // Multipliers applied to WEAK signals only. Serious signals are never reduced.
  weakFactor: {
    officialSender: 0.5, // SMS header / email domain matches the claimed organisation
    trustedSender: 0.5, // the user marked this sender as trusted (from their browser's localStorage)
  },
  combos: [
    { id: 'credential_link', label: 'Asks for login details/OTP and has a link', all: ['credential', 'link'], bonus: 20 },
    { id: 'impersonation_link', label: 'Pretends to be an organisation and has a link', all: ['impersonation', 'link'], bonus: 15 },
    { id: 'urgency_money', label: 'Rushes you and asks for money', all: ['urgency', 'money'], bonus: 10 },
    { id: 'urgency_credential', label: 'Rushes you and asks for OTP/PIN', all: ['urgency', 'credential'], bonus: 8 },
    { id: 'reward_money', label: 'Promises a reward and asks for money', all: ['other', 'money'], bonus: 15 },
    { id: 'threat_police', label: 'Threatens you and claims to be police/CBI', all: ['threat', 'org:police'], bonus: 20 },
    { id: 'urgency_link', label: 'Rushes you and has a risky link', all: ['urgency', 'link'], bonus: 10 },
    { id: 'threat_link', label: 'Threatens you and has a risky link', all: ['threat', 'link'], bonus: 10 },
    { id: 'impersonation_lure', label: 'Pretends to be an organisation and dangles a refund or prize', all: ['impersonation', 'other'], bonus: 15 },
  ],
};

export const LEVELS = ['safe', 'caution', 'high', 'critical'];

export function levelFor(score, hasSerious, cfg = SCORING) {
  const t = cfg.thresholds;
  let level = score >= t.critical ? 'critical' : score >= t.high ? 'high' : score >= t.caution ? 'caution' : 'safe';
  if (!hasSerious && (level === 'high' || level === 'critical')) level = 'caution';
  if (cfg.criticalRequiresSerious && level === 'critical' && !hasSerious) level = 'high';
  return level;
}

/**
 * @param {{signals: object[], orgs?: {id:string}[], senderVerified?: boolean, senderTrusted?: boolean}} input
 * @returns {{score:number, level:string, signals:object[], combos:object[], hasSerious:boolean}}
 *          signals are returned with `weightApplied`.
 */
export function scoreSignals({ signals = [], orgs = [], senderVerified = false, senderTrusted = false }, cfg = SCORING) {
  let factor = 1;
  if (senderVerified) factor *= cfg.weakFactor.officialSender;
  if (senderTrusted) factor *= cfg.weakFactor.trustedSender;

  const weighted = signals.map((s) => ({
    ...s,
    weightApplied: s.strength === 'weak' ? Math.round(s.weight * factor * 10) / 10 : s.weight,
  }));

  const perId = new Map();
  for (const s of weighted) {
    const key = cfg.dedupeById ? s.id : s.key;
    perId.set(key, Math.max(perId.get(key) || 0, s.weightApplied));
  }
  const base = [...perId.values()].reduce((a, b) => a + b, 0);

  const present = new Set(weighted.map((s) => s.category));
  for (const o of orgs) present.add(`org:${o.id}`);
  const combos = cfg.combos.filter((c) => c.all.every((k) => present.has(k))).map(({ id, label, bonus }) => ({ id, label, bonus }));
  const bonus = combos.reduce((a, c) => a + c.bonus, 0);

  const hasSerious = weighted.some((s) => s.strength === 'serious');
  let score = Math.min(cfg.cap, Math.round(base + bonus));
  if (!hasSerious) score = Math.min(score, cfg.weakOnlyMax);
  const level = levelFor(score, hasSerious, cfg);
  return { score, level, signals: weighted, combos, hasSerious };
}

// ── verdict: one templated sentence ─────────────────────────────────────────
const TOPICS = [
  ['kyc', /\bkyc\b|ಕೆವೈಸಿ|\bpan\b[^.]{0,20}update/i, 'KYC'],
  ['police', /arrest|\bcbi\b|cyber cell|narcotics|customs|ಅರೆಸ್ಟ್/i, '"digital arrest"'],
  ['electricity', /electricity|power cut|current bill|bescom|ವಿದ್ಯುತ್|ಬೆಸ್ಕಾಂ/i, 'electricity bill'],
  ['courier', /parcel|courier|redelivery|shipment|delivery fee/i, 'delivery'],
  ['job', /\bjob\b|hiring|recruit|work[- ]from[- ]home|joining|ಉದ್ಯೋಗ/i, 'job offer'],
  ['refund', /refund/i, 'refund'],
  ['reward', /reward|cashback|prize|lottery|lucky draw|you (?:have )?won|ಬಹುಮಾನ/i, 'reward'],
  ['upi', /\bupi\b|collect request|\bqr\b/i, 'UPI payment'],
];

const GOALS = [
  [(s) => s.category === 'credential' && s.strength === 'serious', 'get your login details or OTP'],
  [(s) => s.category === 'money', 'make you pay money'],
  [(s) => s.id === 'digital_arrest', 'scare you into paying or sharing details'],
  [(s) => s.category === 'link' || s.category === 'impersonation', 'get you to open a fake website'],
  [(s) => s.category === 'credential', 'get your personal details'],
];

export function verdictFor({ level, signals, orgs, text, qr }) {
  const org = orgs.find((o) => !o.generic && o.id !== 'police') || orgs.find((o) => o.id === 'police') || null;
  const topic = TOPICS.find(([, re]) => re.test(text || ''));
  const goal = GOALS.find(([pred]) => signals.some(pred))?.[1];

  if (qr?.kind === 'upi' && signals.some((s) => s.id === 'upi_receive_scam')) {
    return 'This QR code will TAKE money from you — scanning a UPI QR never gives you money.';
  }
  if (level === 'critical' || level === 'high') {
    const who = org ? `${org.short} ` : '';
    const what = topic ? `${topic[2]} ` : '';
    const lead = level === 'critical' ? 'This looks like a fake' : 'This is likely a fake';
    const subject = `${who}${what}`.trim();
    return `${lead} ${subject ? `${subject} ` : ''}message trying to ${goal || 'trick you'}.`;
  }
  if (level === 'caution') {
    return org
      ? `Some warning signs in this message about ${org.short}. Check it in the official app or on the number printed on your card/bill before acting.`
      : 'Some warning signs found. Check it through official channels before you click, call or pay.';
  }
  return org
    ? `No strong warning signs found. If in doubt, check in the official ${org.short} app — and never share an OTP or PIN.`
    : 'No strong warning signs found. Stay alert anyway — never share an OTP or PIN with anyone.';
}
