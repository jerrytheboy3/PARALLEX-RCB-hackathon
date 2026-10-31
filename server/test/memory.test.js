import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { createMemory, majority } from '../src/memory.js';
import { buildPrompt } from '../src/ai.js';

const fresh = (file = null) => createApp({ rateLimitPerMin: 1000, memory: createMemory({ file }) });
const SCAMMY_BUT_MISSED = 'Hello, your parcel is waiting. Track it at http://parcel-help-desk.com/t/88 or call 98765 43210.';
const send = (app, body) => request(app).post('/api/feedback').send({ type: 'sms', ...body });

describe('feedback memory', () => {
  it('stores a masked record and counts it', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tl-mem-'));
    const file = path.join(dir, 'mem.json');
    const app = fresh(file);
    const res = await send(app, { text: SCAMMY_BUT_MISSED, sender: '+91 91234 56780', userVerdict: 'scam', note: 'They called me from 98765 43210 too' });
    expect(res.status).toBe(200);
    expect(res.body.stats).toEqual({ reports: 1, scam: 1, real: 0 });
    const stored = readFileSync(file, 'utf8');
    // no raw phone numbers anywhere — not in the text, the note or the indicators
    expect(stored).not.toMatch(/98765|43210|91234|56780/);
    const rec = JSON.parse(stored).records[0];
    expect(rec).toMatchObject({ inputType: 'sms', userVerdict: 'scam', note: expect.stringContaining('[PHONE]') });
    expect(rec.extractedIndicators.domains).toEqual(['parcel-help-desk.com']);
    expect(rec.extractedIndicators.phones.length).toBe(2); // message number + sender, hashed
    expect(Object.keys(rec).sort()).toEqual(['extractedIndicators', 'fingerprint', 'id', 'inputType', 'normalizedInput', 'note', 'originalRiskScore', 'originalVerdict', 'timestamp', 'userVerdict']);
    // survives a restart
    expect((await request(fresh(file)).get('/api/health')).body.memory.reports).toBe(1);
  });

  it('exact match → the corrected verdict is used, with a badge flag', async () => {
    const app = fresh();
    const before = (await request(app).post('/api/analyze').send({ type: 'sms', text: SCAMMY_BUT_MISSED })).body;
    expect(['safe', 'caution']).toContain(before.level);
    await send(app, { text: SCAMMY_BUT_MISSED, userVerdict: 'scam' });
    const after = (await request(app).post('/api/analyze').send({ type: 'sms', text: SCAMMY_BUT_MISSED })).body;
    expect(after.level).toBe('high');
    expect(after.memory).toMatchObject({ match: 'exact', verdict: 'scam', applied: true });
  });

  it('majority wins on conflicting reports; a tie keeps the original verdict', async () => {
    const app = fresh();
    const text = 'URGENT: your KYC is pending, update at http://kyc-fix-now.xyz today';
    const original = (await request(app).post('/api/analyze').send({ type: 'sms', text })).body;
    await send(app, { text, userVerdict: 'real' });
    await send(app, { text, userVerdict: 'scam' });
    const tie = (await request(app).post('/api/analyze').send({ type: 'sms', text })).body;
    expect(tie.level).toBe(original.level);
    expect(tie.memory).toMatchObject({ applied: false, scam: 1, real: 1 });
    await send(app, { text, userVerdict: 'real' });
    const real = (await request(app).post('/api/analyze').send({ type: 'sms', text })).body;
    expect(real.level).toBe('safe');
    expect(majority([{ userVerdict: 'scam' }, { userVerdict: 'scam' }, { userVerdict: 'real' }]).verdict).toBe('scam');
  });

  it('shared domain / sender / phone shifts the score ±25 per net report, capped, with a signal', async () => {
    const app = fresh();
    await send(app, { text: SCAMMY_BUT_MISSED, userVerdict: 'scam' });
    const other = 'Your order update is ready: http://parcel-help-desk.com/o/12';
    const r1 = (await request(app).post('/api/analyze').send({ type: 'sms', text: other })).body;
    const sig = r1.signals.find((s) => s.id === 'community_reports');
    expect(sig).toMatchObject({ direction: 'scam', reports: 1, on: ['domain'] });
    expect(r1.memory).toMatchObject({ match: 'related', shift: 25 });
    for (let i = 0; i < 4; i++) await send(app, { text: `${SCAMMY_BUT_MISSED} ${i}`, userVerdict: 'scam' });
    const r2 = (await request(app).post('/api/analyze').send({ type: 'sms', text: other })).body;
    expect(r2.memory.shift).toBe(50); // capped
    expect(['high', 'critical']).toContain(r2.level);
    // an unrelated message is untouched
    const clean = (await request(app).post('/api/analyze').send({ type: 'sms', text: 'Lunch at 1?' })).body;
    expect(clean.memory).toBeUndefined();
  });

  it('official domains and shared hosts are never used to match', async () => {
    const app = fresh();
    await send(app, { text: 'Fake: update KYC at sbi.co.in and bit.ly/zz now', userVerdict: 'scam' });
    const genuine = (await request(app).post('/api/analyze').send({ type: 'sms', text: 'Your statement is ready on sbi.co.in', sender: 'VM-SBIINB' })).body;
    expect(genuine.level).toBe('safe');
    expect(genuine.memory).toBeUndefined();
  });

  it('validates feedback input', async () => {
    const app = fresh();
    expect((await send(app, { text: 'x', userVerdict: 'maybe' })).status).toBe(400);
    expect((await send(app, { text: 'x', userVerdict: 'scam', note: 'n'.repeat(201) })).status).toBe(400);
    expect((await send(app, { text: '', userVerdict: 'scam' })).status).toBe(400);
  });

  it('relevant corrections ride along in the LLM prompt as few-shot examples', () => {
    const prompt = buildPrompt({ redactedText: 'hi', level: 'safe', examples: [{ normalizedInput: 'pay at [PHONE] now', originalVerdict: 'safe', userVerdict: 'scam', note: 'call 9876543210' }] });
    expect(prompt).toMatch(/Past corrections/);
    expect(prompt).toMatch(/users said SCAM/);
    expect(prompt).not.toMatch(/9876543210/);
  });
});
