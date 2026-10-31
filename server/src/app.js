import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { rateLimit } from 'express-rate-limit';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { requestLogger, log } from './logger.js';
import * as defaultEngine from '../../engine/index.js';
import { analyze, reassess, publicResult, compactResult } from './pipeline.js';
import { validateAnalyze, validateReassess, validateExplain, validateBatch, validateFeedback } from './validate.js';
import { createMemory, buildRecord, fingerprintOf } from './memory.js';
import { aiStatus, aiConfig, explain } from './ai.js';
import { loadSamples } from './samples.js';

const DIST = fileURLToPath(new URL('../../client/dist', import.meta.url));
export const DEV_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173'];

export function createApp({ serveClient = false, rateLimitPerMin = 60, engine = defaultEngine, memory = createMemory() } = {}) {
  const app = express();
  app.disable('x-powered-by');
  app.set('etag', false);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          'default-src': ["'self'"],
          // 'wasm-unsafe-eval' lets the in-browser OCR engine (tesseract.js) run its WebAssembly; no JS eval.
          'script-src': ["'self'", "'wasm-unsafe-eval'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:', 'blob:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': ["'self'"],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'frame-ancestors': ["'none'"],
          'form-action': ["'self'"],
        },
      },
      hsts: false, // plain http on loopback
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.use(requestLogger);
  app.use('/api', cors({ origin: DEV_ORIGINS, methods: ['GET', 'POST'] }));
  // Bulk runs (the Sample Library) get their own, larger budget: a 43k-message dataset is ~44 requests.
  app.use(
    '/api/analyze/batch',
    rateLimit({ windowMs: 60_000, limit: rateLimitPerMin * 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many requests — slow down a little.' } }),
  );
  app.use(
    '/api',
    rateLimit({
      windowMs: 60_000,
      limit: rateLimitPerMin,
      skip: (req) => req.path === '/analyze/batch',
      standardHeaders: 'draft-7',
      legacyHeaders: false,
      message: { error: 'Too many requests — slow down a little.' },
    }),
  );
  // The Sample Library sends up to 250 messages per request; everything else stays at 20 KB.
  app.use('/api/analyze/batch', express.json({ limit: '2mb', strict: true }));
  app.use('/api', express.json({ limit: '20kb', strict: true }));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  app.get('/api/health', async (req, res) => {
    const ai = await aiStatus();
    res.json({ ok: true, engine: engine.engineName === 'p2' ? 'p2' : 'stub', ai, model: aiConfig().model, memory: memory.stats() });
  });

  // "Was this report correct?" — stores a MASKED record (see memory.js) that later analyses learn from.
  app.post('/api/feedback', async (req, res, next) => {
    try {
      const { value, error } = validateFeedback(req.body);
      if (error) return res.status(400).json({ error });
      const { userVerdict, note, ...input } = value;
      const analysis = await analyze(input, { engine, memory });
      const record = memory.add(buildRecord({ input, analysis, userVerdict, note, salt: memory.salt }));
      res.json({ ok: true, id: record.id, stats: memory.stats() });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/feedback/stats', (req, res) => res.json(memory.stats()));

  app.get('/api/samples', (req, res) => {
    res.json(loadSamples());
  });

  app.post('/api/analyze', async (req, res, next) => {
    try {
      const { value, error } = validateAnalyze(req.body);
      if (error) return res.status(400).json({ error });
      const result = await analyze(value, { engine, memory, aiAvailable: (await aiStatus()) === 'ready' });
      res.json(publicResult(result));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/analyze/batch', async (req, res, next) => {
    try {
      const { value, compact, error } = validateBatch(req.body);
      if (error) return res.status(400).json({ error });
      const results = [];
      for (const { id, ...input } of value) {
        const r = await analyze(input, { engine, memory, aiAvailable: false });
        results.push(compact ? { id, ...compactResult(r) } : { id, result: publicResult(r) });
      }
      res.json({ results });
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/reassess', async (req, res, next) => {
    try {
      const { value, error } = validateReassess(req.body);
      if (error) return res.status(400).json({ error });
      const result = await reassess(value, { engine, memory, aiAvailable: (await aiStatus()) === 'ready' });
      res.json(publicResult(result));
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/explain', async (req, res, next) => {
    try {
      const { value, error } = validateExplain(req.body);
      if (error) return res.status(400).json({ error });
      // the 5 most relevant user corrections ride along as few-shot examples
      const examples = memory.relevant({ fingerprint: fingerprintOf(value.redactedText) }, 5);
      res.json(await explain({ ...value, examples }));
    } catch (err) {
      next(err);
    }
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  if (serveClient && existsSync(DIST)) {
    // Hashed assets can be cached; HTML must not be, or a rebuilt UI won't show up.
    app.use(
      express.static(DIST, {
        index: 'index.html',
        maxAge: '1h',
        setHeaders: (res, file) => {
          if (file.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      }),
    );
    app.use((req, res, next) => {
      if (req.method !== 'GET') return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(DIST, 'index.html'));
    });
  }

  // Error handler: NEVER echo err.message (JSON parse errors contain the raw body).
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    const status = err?.status || err?.statusCode || 500;
    const message =
      err?.type === 'entity.too.large' ? 'Message too large (max 20 KB).'
      : err?.type === 'entity.parse.failed' ? 'Body must be valid JSON.'
      : status < 500 ? 'Bad request.'
      : 'Something went wrong.';
    if (status >= 500) log(`error ${err?.name || 'Error'} on ${req.method} ${(req.originalUrl || '').split('?')[0]}`);
    res.status(status).json({ error: message });
  });

  return app;
}
