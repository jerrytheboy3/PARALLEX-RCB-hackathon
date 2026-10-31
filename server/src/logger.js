// Request logger. PRIVACY RULE: logs method, path (no query string), status and duration ONLY.
// Never log bodies, message text, senders, headers, query strings or AI prompts.

let sink = (line) => console.log(line);

/** Swap the output sink (used by tests to capture everything we print). */
export function setLogSink(fn) {
  sink = fn;
}

export function log(line) {
  sink(line);
}

export function requestLogger(req, res, next) {
  const startedAt = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
    const path = (req.originalUrl || req.url || '').split('?')[0];
    sink(`${req.method} ${path} ${res.statusCode} ${ms.toFixed(1)}ms`);
  });
  next();
}
