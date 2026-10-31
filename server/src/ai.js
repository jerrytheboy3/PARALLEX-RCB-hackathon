// Local AI explanations via Ollama on THIS laptop. Optional: if Ollama is missing, slow or
// errors, everything still works and the AI section is simply hidden.
// The AI NEVER decides the risk level — it only explains a level the rules already chose.
// It only ever sees redacted text + detected signals. Nothing is logged.

import { redactValue } from './redact.js';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
const STATUS_TTL_MS = 15_000;

export const aiConfig = () => ({
  url: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
  model: process.env.OLLAMA_MODEL || 'llama3.2:3b',
  timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS || 8000),
});

/** Ollama base URL, or null if it isn't on loopback (we refuse to send anything off-device). */
export function ollamaBase() {
  try {
    const u = new URL(aiConfig().url);
    return u.protocol === 'http:' && LOOPBACK.has(u.hostname) ? u.origin : null;
  } catch {
    return null;
  }
}

let cache = { at: 0, status: 'unavailable', key: '' };

export function resetAiCache() {
  cache = { at: 0, status: 'unavailable', key: '' };
}

export async function aiStatus() {
  const base = ollamaBase();
  const { model } = aiConfig();
  if (!base) return 'unavailable';
  const key = `${base}|${model}`;
  if (cache.key === key && Date.now() - cache.at < STATUS_TTL_MS) return cache.status;
  let status = 'unavailable';
  try {
    const res = await globalThis.fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (res.ok) {
      const data = await res.json();
      const names = (data?.models || []).map((m) => String(m.name || m.model || ''));
      const want = model.includes(':') ? [model] : [model, `${model}:latest`];
      if (names.some((n) => want.includes(n))) status = 'ready';
    }
  } catch {
    status = 'unavailable';
  }
  cache = { at: Date.now(), status, key };
  return status;
}

const LEVEL_WORDS = { safe: 'SAFE (low risk)', caution: 'CAUTION', high: 'HIGH RISK', critical: 'CRITICAL (scam)' };

/** Build the prompt. Re-redacts everything as defence in depth. */
export function buildPrompt({ redactedText, signals = [], level, lang = 'en', examples = [] }) {
  const text = redactValue(String(redactedText || '')).slice(0, 2000);
  const list = signals.length
    ? signals
        .slice(0, 12)
        .map((s) => `- [${s.strength}] ${s.id}: "${redactValue(String(s.evidence || '')).slice(0, 80)}" — ${redactValue(String(s.explanation || '')).slice(0, 160)}`)
        .join('\n')
    : '- (none found)';
  return [
    'You are TrustLens, a scam-awareness helper for people in India.',
    `A rule-based checker has ALREADY decided this message's risk level: ${LEVEL_WORDS[level] || level}.`,
    'Your only job: explain in 2-3 short, simple sentences why the warning signs below matter and what the person should do.',
    'Rules:',
    `- Do NOT change, question or contradict the risk level (${LEVEL_WORDS[level] || level}).`,
    '- Only mention the warning signs listed below. Do NOT invent new ones.',
    '- Personal details were replaced by tokens like [PHONE] or [OTP]. Never guess them.',
    '- No links, no phone numbers, no markdown, no lists.',
    lang === 'kn' ? '- Write in simple Kannada (ಕನ್ನಡ).' : lang === 'hi' ? '- Write in simple Hindi (हिन्दी).' : '- Write in simple English.',
    ...(examples.length
      ? [
          '',
          'Past corrections from people who used TrustLens (examples only — the level above is final):',
          ...examples
            .slice(0, 5)
            .map((e) => `- "${redactValue(String(e.normalizedInput || '')).slice(0, 160)}" → we said ${e.originalVerdict}, users said ${e.userVerdict === 'scam' ? 'SCAM' : 'REAL'}${e.note ? ` (${redactValue(String(e.note)).slice(0, 80)})` : ''}`),
        ]
      : []),
    '',
    `Message (redacted):\n"""${text}"""`,
    '',
    `Warning signs:\n${list}`,
    '',
    'Explanation:',
  ].join('\n');
}

const CONTRADICTS = {
  danger: /\b(?:is|seems|looks|appears)\s+(?:to be\s+)?(?:completely\s+|totally\s+)?(?:safe|legit(?:imate)?|genuine|harmless|fine|real)\b|\bnot (?:a )?(?:scam|fraud)\b|\bnothing to worry\b/i,
  safe: /\b(?:is|looks like|seems like)\s+(?:a\s+)?(?:scam|fraud|phishing)\b/i,
};

export function cleanExplanation(raw, level) {
  let t = String(raw || '')
    .replace(/[*#_`>]+/g, '')
    .replace(/https?:\/\/\S+|\bwww\.\S+/gi, '')
    .replace(/\+?\d[\d\s-]{5,}\d/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t) return null;
  const sentences = t.match(/[^.!?।]+[.!?।]+|[^.!?।]+$/g) || [t];
  t = sentences.slice(0, 3).join(' ').trim().slice(0, 600);
  if ((level === 'high' || level === 'critical') && CONTRADICTS.danger.test(t)) return null;
  if (level === 'safe' && CONTRADICTS.safe.test(t)) return null;
  return t;
}

/** @returns {Promise<{explanation: string|null}>} */
export async function explain(input) {
  try {
    if ((await aiStatus()) !== 'ready') return { explanation: null };
    const base = ollamaBase();
    const { model, timeoutMs } = aiConfig();
    const res = await globalThis.fetch(`${base}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt: buildPrompt(input),
        stream: false,
        options: { temperature: 0.2, num_predict: 180 },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { explanation: null };
    const data = await res.json();
    return { explanation: cleanExplanation(data?.response, input.level) };
  } catch {
    return { explanation: null };
  }
}
