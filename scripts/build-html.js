// Builds TrustLens as ONE self-contained HTML file (TrustLens.html in the project root):
// scripts, styles, fonts, images, the quiz, the detection engine and the OCR engine + language
// data are all inlined. Open it from disk or host it anywhere static (e.g. GitHub Pages).
import { build } from 'vite';
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT_DIR = path.join(ROOT, 'client', 'dist-html');
const TARGET = path.join(ROOT, 'TrustLens.html');

await build({ configFile: path.join(ROOT, 'client', 'vite.standalone.config.js'), logLevel: 'warn' });

let html = readFileSync(path.join(OUT_DIR, 'index.html'), 'utf8');
const asset = (href) => readFileSync(path.join(OUT_DIR, href.replace(/^\.?\//, '')), 'utf8');

// inline <link rel="stylesheet"> and <script src> (escaping "</script" inside the code)
html = html.replace(/<link rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g, (_, href) => `<style>${asset(href)}</style>`);
html = html.replace(/<script type="module"[^>]*src="([^"]+)"[^>]*><\/script>/g, (_, src) => `<script type="module">${asset(src).replace(/<\/script/gi, '<\\/script')}</script>`);
html = html.replace(/<link rel="modulepreload"[^>]*>/g, '');
// favicon as a data: URL
const favicon = readFileSync(path.join(ROOT, 'client', 'public', 'favicon.svg'));
html = html.replace(/href="\/favicon\.svg"/, `href="data:image/svg+xml;base64,${favicon.toString('base64')}"`);

const leftovers = [...html.matchAll(/(?:src|href)="(\/[^"]+|\.\/[^"]+|assets\/[^"]+)"/g)].map((m) => m[1]);
if (leftovers.length) throw new Error(`build-html: external references left: ${leftovers.join(', ')}`);
const extra = readdirSync(path.join(OUT_DIR, 'assets')).filter((f) => !/\.(js|css)$/.test(f));
if (extra.length) throw new Error(`build-html: assets were not inlined: ${extra.join(', ')}`);

// never ship anyone's local feedback memory inside the file
if (/feedback-memory\.json;base64|"records":\[\{/.test(html)) throw new Error('build-html: local feedback memory leaked into the build');

writeFileSync(TARGET, html);
console.log(`build-html: TrustLens.html — ${(statSync(TARGET).size / 1e6).toFixed(1)} MB, one file, no server needed`);
