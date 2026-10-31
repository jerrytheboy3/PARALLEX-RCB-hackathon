import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app.js';
import { setLogSink } from '../src/logger.js';

let app;
beforeAll(() => {
  setLogSink(() => {});
  app = createApp({ rateLimitPerMin: 1000 });
});
afterAll(() => setLogSink((l) => console.log(l)));

describe('API', () => {
  it('GET /api/health', async () => {
    const r = await request(app).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, engine: 'stub' });
    expect(['ready', 'unavailable']).toContain(r.body.ai);
  });

  it('GET /api/samples returns the seed', async () => {
    const r = await request(app).get('/api/samples');
    expect(r.body.samples.length).toBeGreaterThanOrEqual(10);
  });

  it('POST /api/analyze returns the contract shape', async () => {
    const r = await request(app).post('/api/analyze').send({ type: 'sms', text: 'URGENT share OTP now at bit.ly/abc', sender: '9876543210' });
    expect(r.status).toBe(200);
    for (const k of ['level', 'score', 'verdict', 'signals', 'links', 'orgs', 'verifySteps', 'reportSteps', 'redactedText', 'redactionSummary', 'aiAvailable', 'engine']) {
      expect(r.body).toHaveProperty(k);
    }
    expect(r.body).not.toHaveProperty('_orgs');
    expect(r.headers['cache-control']).toBe('no-store');
  });

  it.each([
    [{}, 'text is required'],
    [{ text: '   ' }, 'text is required'],
    [{ text: 'hi', type: 'fax' }, 'type'],
    [{ text: 42 }, 'text is required'],
    [{ text: 'x'.repeat(5001) }, 'too long'],
    [{ text: 'hi', sender: 'x'.repeat(201) }, 'sender'],
    [{ text: 'hi', trustedSenders: 'nope' }, 'trustedSenders'],
    [[1, 2, 3], 'JSON object'],
  ])('400 on invalid body %#', async (body, msg) => {
    const r = await request(app).post('/api/analyze').send(body);
    expect(r.status).toBe(400);
    expect(r.body.error).toMatch(new RegExp(msg));
  });

  it('400 on malformed JSON, without echoing the body', async () => {
    const r = await request(app).post('/api/analyze').set('Content-Type', 'application/json').send('{"text": "my otp 482913",');
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).not.toContain('482913');
  });

  it('413 on bodies over 20 KB, never a crash', async () => {
    const r = await request(app).post('/api/analyze').send({ text: 'a'.repeat(25_000) });
    expect(r.status).toBe(413);
    const after = await request(app).get('/api/health');
    expect(after.status).toBe(200);
  });

  it('unknown API routes → JSON 404', async () => {
    const r = await request(app).get('/api/nope');
    expect(r.status).toBe(404);
    expect(r.body.error).toBeDefined();
  });

  it('security headers are set (helmet CSP, nosniff, no x-powered-by)', async () => {
    const r = await request(app).get('/api/health');
    expect(r.headers['content-security-policy']).toMatch(/default-src 'self'/);
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['x-powered-by']).toBeUndefined();
  });

  it('CORS only allows the dev client origin', async () => {
    const ok = await request(app).get('/api/health').set('Origin', 'http://127.0.0.1:5173');
    expect(ok.headers['access-control-allow-origin']).toBe('http://127.0.0.1:5173');
    const evil = await request(app).get('/api/health').set('Origin', 'https://evil.example');
    expect(evil.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('rate limits at 60 requests/minute by default', async () => {
    const limited = createApp();
    let last;
    for (let i = 0; i < 61; i++) last = await request(limited).get('/api/health');
    expect(last.status).toBe(429);
  });

  it('POST /api/reassess returns changes', async () => {
    const r = await request(app)
      .post('/api/reassess')
      .send({ type: 'sms', text: 'URGENT: pay Rs 500 fine now', sender: '9876543210', disputedSignalIds: ['urgency', 'money_request'], reason: 'known', trustSender: true });
    expect(r.status).toBe(200);
    expect(r.body.changes).toEqual(
      expect.arrayContaining([
        { id: 'urgency', action: 'dropped', why: expect.any(String) },
        { id: 'money_request', action: 'kept', why: expect.any(String) },
      ]),
    );
  });

  it('serves the built client with HTML never cached (so a rebuild shows up)', async () => {
    const { existsSync } = await import('node:fs');
    if (!existsSync(new URL('../../client/dist/index.html', import.meta.url))) return; // build not present
    const withClient = createApp({ serveClient: true, rateLimitPerMin: 1000 });
    const root = await request(withClient).get('/');
    expect(root.status).toBe(200);
    expect(root.headers['cache-control']).toBe('no-cache');
    const deep = await request(withClient).get('/some/route');
    expect(deep.headers['cache-control']).toBe('no-cache');
  });

  it('server binds to 127.0.0.1 by default', async () => {
    const src = (await import('node:fs')).readFileSync(new URL('../src/index.js', import.meta.url), 'utf8');
    expect(src).toMatch(/process\.env\.HOST \|\| '127\.0\.0\.1'/);
  });
});
