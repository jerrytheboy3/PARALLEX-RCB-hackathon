// Input validation for every API body. Returns { value } or { error }.
export const LIMITS = {
  textMax: 5000,
  fieldMax: 200,
  contextMax: 1000,
  reasonMax: 500,
  listMax: 200,
  batchMax: 250,
  batchMaxCompact: 1000,
};
const TYPES = new Set(['sms', 'email', 'qr']);

const optString = (v, max, name) => {
  if (v === undefined || v === null || v === '') return { ok: true, v: undefined };
  if (typeof v !== 'string') return { ok: false, error: `${name} must be a string` };
  if (v.length > max) return { ok: false, error: `${name} is too long (max ${max} characters)` };
  return { ok: true, v };
};

const strList = (v, name) => {
  if (v === undefined || v === null) return { ok: true, v: [] };
  if (!Array.isArray(v) || v.length > LIMITS.listMax || !v.every((x) => typeof x === 'string' && x.length <= LIMITS.fieldMax)) {
    return { ok: false, error: `${name} must be a list of short strings` };
  }
  return { ok: true, v };
};

export function validateAnalyze(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Body must be a JSON object' };
  const { text, type = 'sms' } = body;
  if (typeof text !== 'string' || !text.trim()) return { error: 'text is required' };
  if (text.length > LIMITS.textMax) return { error: `text is too long (max ${LIMITS.textMax} characters)` };
  if (!TYPES.has(type)) return { error: 'type must be one of sms, email, qr' };
  const out = { text, type };
  for (const [k, max] of [['sender', LIMITS.fieldMax], ['subject', LIMITS.fieldMax], ['replyTo', LIMITS.fieldMax], ['context', LIMITS.contextMax], ['expectedOrg', LIMITS.fieldMax]]) {
    const r = optString(body[k], max, k);
    if (!r.ok) return { error: r.error };
    out[k] = r.v;
  }
  const ts = strList(body.trustedSenders, 'trustedSenders');
  if (!ts.ok) return { error: ts.error };
  out.trustedSenders = ts.v;
  return { value: out };
}

/** Bulk check for the Sample Library: { items: [{ id?, ...analyze body }] } */
export function validateBatch(body) {
  if (!body || typeof body !== 'object' || !Array.isArray(body.items)) return { error: 'items must be a list' };
  if (body.items.length === 0) return { error: 'items is empty' };
  if (body.compact !== undefined && typeof body.compact !== 'boolean') return { error: 'compact must be true or false' };
  const max = body.compact ? LIMITS.batchMaxCompact : LIMITS.batchMax;
  if (body.items.length > max) return { error: `Too many messages (max ${max} per request)` };
  const items = [];
  for (const [i, it] of body.items.entries()) {
    const r = validateAnalyze(it);
    if (r.error) return { error: `Message ${i + 1}: ${r.error}` };
    const id = typeof it.id === 'string' ? it.id.slice(0, 64) : String(i + 1);
    items.push({ id, ...r.value });
  }
  return { value: items, compact: !!body.compact };
}

/** "Was this report correct?" — the message again (we re-analyse it) plus the user's verdict. */
export function validateFeedback(body) {
  const base = validateAnalyze(body);
  if (base.error) return base;
  if (!['scam', 'real'].includes(body.userVerdict)) return { error: 'userVerdict must be scam or real' };
  const note = optString(body.note, 200, 'note');
  if (!note.ok) return { error: note.error };
  return { value: { ...base.value, userVerdict: body.userVerdict, note: note.v } };
}

export function validateReassess(body) {
  const base = validateAnalyze(body);
  if (base.error) return base;
  const ids = strList(body.disputedSignalIds, 'disputedSignalIds');
  if (!ids.ok) return { error: ids.error };
  const reason = optString(body.reason, LIMITS.reasonMax, 'reason');
  if (!reason.ok) return { error: reason.error };
  if (body.trustSender !== undefined && typeof body.trustSender !== 'boolean') return { error: 'trustSender must be true or false' };
  return { value: { ...base.value, disputedSignalIds: ids.v, reason: reason.v, trustSender: !!body.trustSender } };
}

export function validateExplain(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Body must be a JSON object' };
  const { redactedText, signals = [], level, lang = 'en' } = body;
  if (typeof redactedText !== 'string' || !redactedText.trim()) return { error: 'redactedText is required' };
  if (redactedText.length > LIMITS.textMax + 1000) return { error: 'redactedText is too long' };
  if (!['safe', 'caution', 'high', 'critical'].includes(level)) return { error: 'level is invalid' };
  if (!Array.isArray(signals) || signals.length > 100) return { error: 'signals must be a list' };
  if (!['en', 'kn', 'hi'].includes(lang)) return { error: 'lang must be en, kn or hi' };
  const clean = signals
    .filter((s) => s && typeof s === 'object')
    .map((s) => ({
      id: String(s.id || '').slice(0, 64),
      category: String(s.category || '').slice(0, 32),
      strength: s.strength === 'serious' ? 'serious' : 'weak',
      evidence: String(s.evidence || '').slice(0, 200),
      explanation: String(s.explanation || '').slice(0, 300),
    }));
  return { value: { redactedText, signals: clean, level, lang } };
}
