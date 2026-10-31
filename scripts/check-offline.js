// Fails the build if the client bundle references anything on the internet
// (CDNs, Google Fonts, remote images). The demo must work with Wi-Fi OFF.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../client/dist', import.meta.url));
const REMOTE = /(?:src|href)\s*=\s*["']\s*(?:https?:)?\/\/|url\(\s*["']?\s*(?:https?:)?\/\/|@import\s+(?:url\()?\s*["']?(?:https?:)?\/\/|fonts\.(?:googleapis|gstatic)\.com|cdn\.jsdelivr|unpkg\.com|cdnjs/i;

function walk(dir) {
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

let files;
try {
  files = walk(dist).filter((f) => /\.(html|css)$/.test(f));
} catch {
  console.error('check-offline: client/dist not found — run the client build first.');
  process.exit(1);
}
const bad = [];
for (const f of files) {
  const src = readFileSync(f, 'utf8');
  const m = src.match(REMOTE);
  if (m) bad.push(`${path.relative(dist, f)}: …${src.slice(Math.max(0, m.index - 40), m.index + 60)}…`);
}
const fonts = walk(dist).filter((f) => /\.woff2?$/.test(f));
if (bad.length) {
  console.error('check-offline: remote references found:\n' + bad.join('\n'));
  process.exit(1);
}
for (const script of ['kannada', 'devanagari']) {
  if (!fonts.some((f) => new RegExp(script, 'i').test(f))) {
    console.error(`check-offline: Noto Sans ${script} font files missing from the bundle.`);
    process.exit(1);
  }
}
console.log(`check-offline: OK — ${files.length} html/css files, ${fonts.length} bundled font files, no remote references.`);
