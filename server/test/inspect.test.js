import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { inspectUrl, registrableDomain, normaliseLabel } from '../src/urlinspect.js';
import { compareSender, resolveExpected } from '../src/sendercheck.js';
import { describeSender } from '../src/redact.js';
import { analyze } from '../src/pipeline.js';
import { createApp } from '../src/app.js';

const failed = (u) => inspectUrl(u).checks.filter((c) => c.passed === false).map((c) => c.id).sort();

describe('URL inspection (string analysis only)', () => {
  it('finds the registrable domain, including Indian two-level suffixes', () => {
    expect(registrableDomain('bescom.karnataka.gov.in')).toBe('karnataka.gov.in');
    expect(registrableDomain('www.onlinesbi.sbi')).toBe('onlinesbi.sbi');
    expect(registrableDomain('a.b.sbi-kyc.co.in')).toBe('sbi-kyc.co.in');
  });

  it('bolds the real domain via offsets into the raw URL', () => {
    const u = inspectUrl('https://sbi.co.in.secure-login.xyz/kyc');
    expect(u.raw.slice(u.domainStart, u.domainEnd)).toBe('secure-login.xyz');
    expect(failed(u.raw)).toEqual(['brand_subdomain', 'subdomains', 'tld']);
  });

  it('flags IPs, shorteners, @ tricks, punycode and http', () => {
    expect(failed('http://192.168.1.55/bescom-pay')).toEqual(['https', 'ip']);
    expect(failed('https://bit.ly/sbi-kyc')).toEqual(['shortener']);
    expect(failed('https://www.sbi.co.in@evil.example.com/')).toContain('at_sign');
    expect(failed('https://xn--pypal-4ve.com')).toContain('punycode');
  });

  it('catches lookalikes: digit swaps, typos and embedded brands', () => {
    expect(normaliseLabel('amaz0n')).toBe('amazon');
    expect(inspectUrl('https://amaz0n-refunds.co/x').lookalike?.brand).toBe('Amazon');
    expect(inspectUrl('https://paytm-secure.co').lookalike?.brand).toBe('Paytm');
    expect(inspectUrl('https://flipkrat.com').lookalike?.brand).toBe('Flipkart');
    expect(inspectUrl('http://sbi-kyc-update.in').lookalike?.brand).toBe('SBI');
  });

  it('official domains pass every check', () => {
    expect(failed('https://www.onlinesbi.sbi/')).toEqual([]);
    expect(failed('https://bescom.karnataka.gov.in/pay')).toEqual([]);
    expect(inspectUrl('onlinesbi.sbi').checks.find((c) => c.id === 'https').passed).toBeNull();
  });
});

describe('sender comparison', () => {
  const cmp = (sender, expected, orgs) => compareSender({ senderInfo: describeSender(sender).info, expected, orgs });

  it('resolves names, domains and URLs to the same organisation', () => {
    expect(resolveExpected('SBI').org.id).toBe('sbi');
    expect(resolveExpected('https://www.sbi.co.in/').org.id).toBe('sbi');
    expect(resolveExpected('example.org').domains).toEqual(['example.org']);
  });

  it('match / lookalike / mismatch', () => {
    expect(cmp('alerts@sbi.co.in', 'sbi.co.in').verdict).toBe('match');
    expect(cmp('VM-SBIINB', 'SBI').verdict).toBe('match');
    expect(cmp('alerts@sbi-secure-kyc.com', 'sbi.co.in').verdict).toBe('lookalike');
    expect(cmp('alerts@amaz0n-help.com', 'amazon.in').verdict).toBe('lookalike');
    expect(cmp('VK-SBIALR', 'SBI')).toMatchObject({ verdict: 'unknown', reason: 'header_unlisted' });
    expect(cmp('VK-REWARD', 'SBI').verdict).toBe('mismatch');
    expect(cmp('helpdesk@gmail.com', 'sbi.co.in')).toMatchObject({ verdict: 'mismatch', reason: 'freemail' });
    expect(cmp('+91 98765 43210', 'sbi.co.in')).toMatchObject({ verdict: 'mismatch', reason: 'personal_number', value: null });
  });

  it('returns null when there is nothing to compare', () => {
    expect(cmp('VM-SBIINB', undefined, [])).toBeNull();
  });

  it('adds a scored signal only when the user named the expected sender', async () => {
    const text = 'Your statement is ready. Log in to view it.';
    const named = await analyze({ text, type: 'email', sender: 'alerts@hdfc-statements.net', expectedOrg: 'hdfcbank.com' });
    expect(named.senderCheck.verdict).toBe('lookalike');
    expect(named.signals.map((s) => s.id)).toContain('sender_lookalike');
    const r = await analyze({ text: 'Hi, see you at 5', type: 'sms', sender: 'friend@gmail.com', expectedOrg: 'sbi.co.in' });
    expect(r.signals.map((s) => s.id)).toContain('sender_mismatch');
  });
});

describe('Hindi + Hinglish detection', () => {
  it('flags a Hindi KYC scam and leaves a genuine Hindi OTP alone', async () => {
    const scam = await analyze({ type: 'sms', sender: '+91 98765 11223', text: 'प्रिय ग्राहक, आपका SBI खाता आज ब्लॉक कर दिया जाएगा। तुरंत KYC अपडेट करें: http://sbi-kyc-update.in और OTP इस नंबर पर भेजें।' });
    expect(scam.level).toBe('critical');
    expect(scam.signals.filter((s) => s.lang === 'hi').map((s) => s.id)).toEqual(expect.arrayContaining(['otp_request', 'urgency', 'threat']));
    const ok = await analyze({ type: 'sms', sender: 'VM-SBIINB', text: 'आपके SBI लॉगिन के लिए OTP 482913 है। इसे किसी के साथ साझा न करें। -SBI' });
    expect(ok.level).toBe('safe');
  });

  it('respects Hinglish negation ("OTP kisi ko mat batao")', async () => {
    const r = await analyze({ type: 'sms', text: 'Apna OTP kisi ko mat batao. -Bank' });
    expect(r.signals.map((s) => s.id)).not.toContain('otp_request');
  });
});

describe('POST /api/analyze/batch', () => {
  const app = createApp({ rateLimitPerMin: 1000 });
  it('analyses many messages in one request', async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ id: `m${i}`, type: 'sms', text: i % 2 ? 'URGENT share your OTP now' : 'See you at lunch' }));
    const res = await request(app).post('/api/analyze/batch').send({ items });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(30);
    expect(res.body.results[1].id).toBe('m1');
    expect(res.body.results[1].result.level).not.toBe('safe');
    expect(res.body.results[0].result._orgs).toBeUndefined();
  });
  it('rejects empty, oversized and invalid batches', async () => {
    expect((await request(app).post('/api/analyze/batch').send({ items: [] })).status).toBe(400);
    expect((await request(app).post('/api/analyze/batch').send({ items: Array(251).fill({ text: 'x' }) })).status).toBe(400);
    const bad = await request(app).post('/api/analyze/batch').send({ items: [{ text: 'ok' }, { text: '' }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/Message 2/);
  });
  it('still caps single /api/analyze bodies at 20 KB', async () => {
    const res = await request(app).post('/api/analyze').send({ text: 'x'.repeat(30000) });
    expect(res.status).toBe(413);
  });
});

describe('general (non-India) scam patterns', () => {
  const ids = async (text) => (await analyze({ type: 'sms', text })).signals.map((s) => s.id);
  const level = async (text) => (await analyze({ type: 'sms', text })).level;

  it('prize / "is this you?" bait plus a hiding link is serious', async () => {
    expect(await ids('You won 2 ETH in our weekly crypto giveaway. Redeem here: is.gd/x1')).toContain('bait_link');
    expect(await level('Hey, is this you? Someone just uploaded a hidden video of you: bit.ly/abc')).toMatch(/high|critical/);
  });

  it('legal threats and "verify your identity" with a risky link reach High', async () => {
    expect(await ids('Legal Notice: illegal activity linked to your IP address. Pay the penalty to prevent a warrant at http://x-gov.work/1')).toEqual(expect.arrayContaining(['legal_threat', 'money_request']));
    expect(await level('SECURITY ALERT: your account has been permanently locked. Verify your identity at tinyurl.com/zz')).toMatch(/high|critical/);
  });

  it('bait without a link, and ordinary links, stay low', async () => {
    expect(await level('Congratulations on your promotion! Dinner at 8?')).toBe('safe');
    expect(await level('Your verification code is 659730. Do not share this code with anyone.')).toBe('safe');
    expect(await ids('Reward points credited. Check them in the official app.')).not.toContain('bait_link');
  });
});

describe('international brands, fake invoices and free forms', () => {
  const run = (text, sender) => analyze({ type: 'sms', text, sender });
  const high = (r) => ['high', 'critical'].includes(r.level);

  it('international brands with non-official links are impersonation', async () => {
    const r = await run('URGENT: Your Chase account has been temporarily restricted due to unauthorized wire of $3016.67. Verify immediately at http://secure-update-banking.com/auth-543');
    expect(r.orgs.map((o) => o.id)).toContain('chase');
    expect(r.signals.map((s) => s.id)).toContain('org_link_mismatch');
    expect(high(r)).toBe(true);
    // "purchase" must not read as Chase
    expect((await run('Your purchase order is ready for review.')).orgs.map((o) => o.id)).not.toContain('chase');
  });

  it('fake invoices with a callback number are serious; real "call the number on your card" is not', async () => {
    const fake = await run('Billing Confirmation: Invoice #INV-92356 for McAfee ($376.00) processed. If unauthorized, call 1-800-555-3392 immediately to cancel.');
    expect(fake.signals.map((s) => s.id)).toContain('callback_scam');
    expect(high(fake)).toBe(true);
    const real = await run('Rs 2,350.00 debited from HDFC Bank A/c XX4012. Not you? Call the number on the back of your card.', 'AD-HDFCBK');
    expect(real.signals.map((s) => s.id)).not.toContain('callback_scam');
  });

  it('free forms are flagged only when used to secure accounts, pay or claim money', async () => {
    const alert = await run('Security Alert: Sign-in attempt detected from unrecognized device. Secure account at http://forms.gle/xyz');
    expect(alert.signals.map((x) => x.id)).toEqual(expect.arrayContaining(['threat', 'form_link']));
    expect(alert.level).not.toBe('safe');
    const claim = await run('IRS Tax Rebate Notice: You are eligible for an unclaimed refund of $1250. Claim at http://forms.gle/xyz/form');
    expect(claim.signals.map((s) => s.id)).toContain('form_link');
    expect(high(claim)).toBe(true);
    const fest = await run('Greetings from BMSCE IEEE! PARALLAX 24-hour National Hackathon. Date: 30th October. Prize Pool: ₹40,000. Registration: https://forms.gle/zVmK961gykk4bFa88');
    expect(fest.level).toBe('safe');
  });
});

describe('compact bulk runs', () => {
  const app = createApp({ rateLimitPerMin: 1000 });

  it('compact batches return a small summary, up to 1,000 per request', async () => {
    const items = Array.from({ length: 1000 }, (_, i) => ({ id: `c${i}`, type: 'sms', text: i % 2 ? `URGENT ${i}: share your OTP now at http://x-${i}.xyz` : `Lunch at ${i}?` }));
    const res = await request(app).post('/api/analyze/batch').send({ compact: true, items });
    expect(res.status).toBe(200);
    expect(res.body.results).toHaveLength(1000);
    const hit = res.body.results[1];
    expect(Object.keys(hit).sort()).toEqual(['id', 'level', 'score', 'signalIds', 'top']);
    expect(hit.top.strength).toBe('serious');
    expect(res.body.results[0].top).toBeNull();
    expect(JSON.stringify(res.body).length).toBeLessThan(400_000);
    // full results stay capped at 250 per request, compact at 1,000
    expect((await request(app).post('/api/analyze/batch').send({ items: items.slice(0, 251) })).status).toBe(400);
    expect((await request(app).post('/api/analyze/batch').send({ compact: true, items: [...items, items[0]] })).status).toBe(400);
  });

  it('bulk runs have their own rate budget', async () => {
    const strict = createApp({ rateLimitPerMin: 2 });
    for (let i = 0; i < 5; i++) {
      expect((await request(strict).post('/api/analyze/batch').send({ compact: true, items: [{ text: 'hi' }] })).status).toBe(200);
    }
    await request(strict).get('/api/health');
    await request(strict).get('/api/health');
    expect((await request(strict).get('/api/health')).status).toBe(429);
  });
});
