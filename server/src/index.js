import { createApp } from './app.js';
import { log } from './logger.js';

const HOST = process.env.HOST || '127.0.0.1';
// API_PORT (not PORT): dev tools often set PORT for the frontend, which would collide with Vite.
const PORT = Number(process.env.API_PORT || 5050);
const serveClient = process.argv.includes('--serve-client');

const app = createApp({ serveClient });
// Express 5 calls this callback with the error when listen fails (e.g. port in use);
// the 'error' handler below reports it, so only announce success here.
const server = app.listen(PORT, HOST, (err) => {
  if (err) return;
  log(`TrustLens server on http://${HOST}:${PORT}${serveClient ? ' (serving client/dist)' : ''}`);
  if (HOST !== '127.0.0.1' && HOST !== 'localhost' && HOST !== '::1') {
    log('WARNING: HOST is not loopback — the API is reachable from your network.');
  }
});

server.on('error', (err) => {
  log(err.code === 'EADDRINUSE' ? `Port ${PORT} is already in use — stop the other TrustLens server or set API_PORT.` : `Server error: ${err.code || err.name}`);
  process.exit(1);
});
