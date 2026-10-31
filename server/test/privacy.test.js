// Privacy & security guarantees, each one tested.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '../src/app.js';
import { setLogSink } from '../src/logger.js';
import { resetAiCache } from '../src/ai.js';

// Fake but realistic personal data that must never escape.
const PII = {
  phone: '9876543210',
  otp: '482913',
  account: '50100234567891',
  card: '4111 1111 1111 1111',
  aadhaar: '2345 6789 0123',
  pan: 'ABCPE1234F',
  upi: 'ramesh.k@okaxis',
  email: 'ramesh.kumar@example.com',
};
const SECRET_WORD = 'zebracrossing'; // a word only present in message text
const MESSAGE = `Dear customer ${SECRET_WORD}, call ${PII.phone}, share OTP ${PII.otp}. A/c ${PII.account}, card ${PII.card}, Aadhaar ${PII.aadhaar}, PAN ${PII.pan}, pay ${PII.upi}, mail ${PII.email}. Verify at https://sbi-kyc-verify.xyz/login?u=${PII.phone}`;
const RAW_VALUES = [...Object.values(PII), PII.card.replace(/ /g, ''), PII.aadhaar.replace(/ /g, ''), SECRET_WORD];

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OLLAMA = 'http://127.0.0.1:11434';

function mockOllama({ ready = true, response = 'This message asks for your OTP. Do not share it. Check in the official app.' } = {}) {
  const calls = [];
  const fetchMock = vi.fn(async (url, init = {}) => {
    calls.push({ url: String(url), body: init.body ? String(init.body) : '' });
    const u = String(url);
    if (u.endsWith('/api/tags')) {
      return new Response(JSON.stringify({ models: ready ? [{ name: 'llama3.2:3b' }] : [] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (u.endsWith('/api/generate')) {
      return new Response(JSON.stringify({ response }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    throw new Error(`unexpected network call to ${u}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return { calls, fetchMock };
}

let logs;
let app;
beforeEach(() => {
  resetAiCache();
  logs = [];
  setLogSink((l) => logs.push(String(l)));
  for (const m of ['log', 'info', 'warn', 'error', 'debug']) vi.spyOn(console, m).mockImplementation((...a) => logs.push(a.join(' ')));
  app = createApp({ rateLimitPerMin: 1000 });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  setLogSink((l) => console.log(l));
  resetAiCache();
});

describe('logging never contains message content', () => {
  it('logs only method/path/status/ms — no body, text, sender, PII or prompts', async () => {
    mockOllama();
    const body = { type: 'sms', text: MESSAGE, sender: `+91 ${PII.phone}` };
    const a = await request(app).post('/api/analyze?leak=' + PII.otp).send(body);
    expect(a.status).toBe(200);
    await request(app).post('/api/reassess').send({ ...body, disputedSignalIds: ['urgency'], reason: `my friend ${SECRET_WORD}`, trustSender: true });
    await request(app).post('/api/explain').send({ redactedText: a.body.redactedText, signals: a.body.signals, level: a.body.level });
    await request(app).post('/api/analyze').set('Content-Type', 'application/json').send(`{"text": "${SECRET_WORD} ${PII.otp}",`);
    await request(app).post('/api/analyze').send({ text: `${SECRET_WORD} ${PII.phone}`, type: 'fax' });

    expect(logs.length).toBeGreaterThanOrEqual(5);
    const all = logs.join('\n');
    for (const v of RAW_VALUES) expect(all).not.toContain(v);
    expect(all).not.toContain('Dear customer');
    expect(all).not.toContain('[PHONE]'); // not even redacted text
    expect(all).not.toContain('leak=');
    for (const line of logs) expect(line).toMatch(/^(GET|POST) \/api\/\w+ \d{3} \d+\.\dms$/);
  });
});

describe('the AI only ever sees redacted text', () => {
  it('prompt contains no raw phone/OTP/account/card/Aadhaar/PAN/UPI/email', async () => {
    const { calls } = mockOllama();
    const a = await request(app).post('/api/analyze').send({ type: 'sms', text: MESSAGE });
    const e = await request(app).post('/api/explain').send({ redactedText: a.body.redactedText, signals: a.body.signals, level: a.body.level });
    expect(e.body.explanation).toBeTruthy();
    const gen = calls.find((c) => c.url.endsWith('/api/generate'));
    const prompt = JSON.parse(gen.body).prompt;
    for (const v of Object.values(PII)) expect(prompt).not.toContain(v);
    expect(prompt).toContain('[PHONE]');
    expect(prompt).toContain('[OTP]');
    expect(prompt).toMatch(/Do NOT change, question or contradict the risk level/);
    expect(prompt).toMatch(/Do NOT invent/);
  });

  it('even if a client sends RAW text to /api/explain, it is redacted before reaching the model', async () => {
    const { calls } = mockOllama();
    await request(app).post('/api/explain').send({ redactedText: MESSAGE, level: 'critical', signals: [{ id: 'otp_request', strength: 'serious', evidence: `share OTP ${PII.otp}`, explanation: `call ${PII.phone}` }] });
    const prompt = JSON.parse(calls.find((c) => c.url.endsWith('/api/generate')).body).prompt;
    for (const v of Object.values(PII)) expect(prompt).not.toContain(v);
  });

  it('analysis itself never calls the model, so the AI cannot influence the level', async () => {
    const { calls } = mockOllama({ response: 'This is completely safe.' });
    const a = await request(app).post('/api/analyze').send({ type: 'sms', text: MESSAGE });
    expect(calls.some((c) => c.url.endsWith('/api/generate'))).toBe(false);
    expect(a.body.level).toBe('critical');
  });

  it('drops AI output that contradicts the level', async () => {
    mockOllama({ response: 'Do not worry, this message is safe and genuine.' });
    const e = await request(app).post('/api/explain').send({ redactedText: 'share [OTP]', signals: [], level: 'critical' });
    expect(e.body.explanation).toBeNull();
  });
});

describe('network: nothing leaves the laptop', () => {
  it('the only network destination is Ollama on 127.0.0.1:11434; message URLs are never fetched', async () => {
    const { fetchMock } = mockOllama();
    const urls = ['https://sbi-kyc-verify.xyz/login', 'http://bit.ly/abc', 'www.evil.top/x'];
    const text = `Click ${urls.join(' or ')} now, share OTP`;
    const a = await request(app).post('/api/analyze').send({ type: 'sms', text });
    await request(app).post('/api/reassess').send({ type: 'sms', text, disputedSignalIds: ['urgency'] });
    await request(app).post('/api/analyze').send({ type: 'qr', text: 'https://sbi-rewards-claim.xyz/redeem' });
    await request(app).post('/api/analyze').send({ type: 'qr', text: 'upi://pay?pa=x@ybl&pn=Prize&tn=receive%20money' });
    await request(app).post('/api/explain').send({ redactedText: a.body.redactedText, signals: a.body.signals, level: a.body.level });
    await request(app).get('/api/health');
    const called = fetchMock.mock.calls.map(([u]) => String(u));
    expect(called.length).toBeGreaterThan(0);
    for (const u of called) expect(u.startsWith(`${OLLAMA}/`)).toBe(true);
    for (const u of urls) expect(called.join(' ')).not.toContain(u.replace(/^https?:\/\//, ''));
  });

  it('refuses to send anything to a non-loopback OLLAMA_URL', async () => {
    const { fetchMock } = mockOllama();
    vi.stubEnv('OLLAMA_URL', 'https://api.example.com');
    const h = await request(app).get('/api/health');
    const e = await request(app).post('/api/explain').send({ redactedText: 'share [OTP]', signals: [], level: 'high' });
    expect(h.body.ai).toBe('unavailable');
    expect(e.body.explanation).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });

  it('server and engine code never import network/disk-writing modules (static check)', () => {
    const walk = (d) => readdirSync(d).flatMap((f) => (statSync(path.join(d, f)).isDirectory() ? walk(path.join(d, f)) : [path.join(d, f)]));
    const files = [...walk(path.join(ROOT, 'server/src')), ...walk(path.join(ROOT, 'engine'))].filter((f) => f.endsWith('.js'));
    for (const f of files) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).not.toMatch(/from ['"](?:node:)?(?:https?|net|dns|tls|dgram|child_process)['"]/);
      expect(src, f).not.toMatch(/\b(?:axios|node-fetch|got|undici)\b/);
      // The ONLY file the server writes is the user-feedback memory (masked records, memory.js).
      if (!f.endsWith(path.join('server', 'src', 'memory.js'))) expect(src, f).not.toMatch(/\b(?:writeFile|appendFile|createWriteStream|writeFileSync|appendFileSync)\b/);
      if (!f.endsWith(path.join('server', 'src', 'ai.js'))) expect(src, f).not.toMatch(/\bfetch\s*\(/);
    }
  });
});

describe('Ollama missing / slow / broken → app still works', () => {
  it('Ollama not running: health says unavailable, analyze works, explain returns null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    const h = await request(app).get('/api/health');
    expect(h.body.ai).toBe('unavailable');
    const a = await request(app).post('/api/analyze').send({ type: 'sms', text: 'share OTP now' });
    expect(a.status).toBe(200);
    expect(a.body.aiAvailable).toBe(false);
    const e = await request(app).post('/api/explain').send({ redactedText: 'x', signals: [], level: 'safe' });
    expect(e.body).toEqual({ explanation: null });
  });

  it('model not pulled → unavailable', async () => {
    mockOllama({ ready: false });
    expect((await request(app).get('/api/health')).body.ai).toBe('unavailable');
  });

  it('slow model → times out and returns null', async () => {
    vi.stubEnv('OLLAMA_TIMEOUT_MS', '150');
    vi.stubGlobal('fetch', vi.fn(async (url, init) => {
      if (String(url).endsWith('/api/tags')) return new Response(JSON.stringify({ models: [{ name: 'llama3.2:3b' }] }), { headers: { 'content-type': 'application/json' } });
      return new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
    }));
    const t0 = Date.now();
    const e = await request(app).post('/api/explain').send({ redactedText: 'x', signals: [], level: 'high' });
    expect(e.body.explanation).toBeNull();
    expect(Date.now() - t0).toBeLessThan(3000);
    vi.unstubAllEnvs();
  });

  it('explain validates input', async () => {
    const r = await request(app).post('/api/explain').send({ redactedText: 'x', level: 'extreme' });
    expect(r.status).toBe(400);
  });
});

describe('repo hygiene', () => {
  it('no .env or secrets are committed; .env.example exists', () => {
    let tracked;
    try {
      tracked = execSync('git ls-files', { cwd: ROOT, encoding: 'utf8' }).split('\n');
    } catch {
      return; // not a git checkout (e.g. zip download) — nothing to check
    }
    expect(tracked.filter((f) => /(^|\/)\.env($|\.)/.test(f) && !f.endsWith('.env.example'))).toEqual([]);
    expect(tracked).toContain('.env.example');
    expect(readFileSync(path.join(ROOT, '.gitignore'), 'utf8')).toMatch(/^\.env$/m);
    // (skip files deleted in the working tree but not yet committed)
    for (const f of tracked.filter((x) => /\.(js|jsx|json|md|example)$/.test(x) && !x.includes('package-lock') && existsSync(path.join(ROOT, x)))) {
      const src = readFileSync(path.join(ROOT, f), 'utf8');
      expect(src, f).not.toMatch(/sk-[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|ghp_[A-Za-z0-9]{30,}|-----BEGIN (?:RSA )?PRIVATE KEY/);
    }
  });
});
