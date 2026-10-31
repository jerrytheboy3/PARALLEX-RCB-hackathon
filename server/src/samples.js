import { existsSync, readFileSync } from 'node:fs';

const DATA = new URL('../../data/', import.meta.url);
const MAX_SAMPLES = 300;

function readJson(name) {
  const url = new URL(name, DATA);
  if (!existsSync(url)) return null;
  try {
    const data = JSON.parse(readFileSync(url, 'utf8'));
    return Array.isArray(data) && data.length ? data : null;
  } catch {
    return null;
  }
}

/**
 * Example messages for the UI: the hand-made seed (demo script relies on it) followed by
 * P1's full dataset when present. De-duplicated by id.
 */
export function loadSamples() {
  const seed = readJson('seed.json') || [];
  const dataset = (readJson('messages.json') || []).filter((m) => m?.id && m?.text);
  const seen = new Set();
  const samples = [...seed, ...dataset].filter((m) => !seen.has(m.id) && seen.add(m.id)).slice(0, MAX_SAMPLES);
  return { source: dataset.length ? 'dataset' : 'seed', samples };
}
