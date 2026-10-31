// Copies the OCR engine (tesseract.js worker + WASM core) and the English/Hindi/Kannada language
// data from node_modules into client/public/ocr, so screenshot reading works with Wi-Fi OFF.
// Runs automatically before `vite` dev/build. Output is git-ignored.
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = path.join(ROOT, 'client', 'public', 'ocr');
const pkgDir = (name) => path.dirname(require.resolve(`${name}/package.json`, { paths: [path.join(ROOT, 'client'), ROOT] }));

function copy(from, to) {
  mkdirSync(path.dirname(to), { recursive: true });
  if (existsSync(to) && statSync(to).size === statSync(from).size) return 0;
  copyFileSync(from, to);
  return 1;
}

let n = 0;
n += copy(path.join(pkgDir('tesseract.js'), 'dist', 'worker.min.js'), path.join(OUT, 'worker.min.js'));
const core = pkgDir('tesseract.js-core');
// LSTM-only builds (the OCR mode we use); the worker picks SIMD / relaxed-SIMD when available.
for (const f of readdirSync(core).filter((f) => /^tesseract-core(-simd|-relaxedsimd)?-lstm\.wasm\.js$/.test(f))) {
  n += copy(path.join(core, f), path.join(OUT, 'core', f));
}
for (const lang of ['eng', 'hin', 'kan']) {
  n += copy(path.join(pkgDir(`@tesseract.js-data/${lang}`), '4.0.0_best_int', `${lang}.traineddata.gz`), path.join(OUT, 'lang', `${lang}.traineddata.gz`));
}
console.log(`copy-ocr: ${n ? `${n} file(s) copied` : 'up to date'} → client/public/ocr`);
