// Playwright screenshots of every screen, at 1440×900 and 390×844, into screenshots/.
// Needs the demo server running (npm run demo). Usage: node scripts/screenshots.js
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL || 'http://127.0.0.1:5050';
const OUT = fileURLToPath(new URL('../screenshots/', import.meta.url));
mkdirSync(OUT, { recursive: true });

async function run(width, height) {
  const tag = width < 600 ? 'mobile' : 'desktop';
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height }, reducedMotion: 'reduce' });
  const shot = async (name) => {
    await page.waitForTimeout(300);
    await page.screenshot({ path: `${OUT}${tag}-${name}.png`, fullPage: true });
  };
  const result = async () => {
    await page.getByTestId('check-button').click();
    await page.getByTestId('risk-score').waitFor();
  };

  await page.goto(`${BASE}/#/`);
  await shot('01-landing');
  await page.getByTestId('explore').click();
  await shot('02-dashboard');
  await page.getByTestId('tile-check').click();
  await shot('03-check-empty');
  await page.getByTestId('try-example').click();
  await result();
  await page.getByRole('button', { name: /See the evidence/ }).click();
  await shot('04-result-evidence');
  await page.getByRole('button', { name: 'Why is this risky?' }).click();
  await page.waitForTimeout(900);
  await shot('05-bot');
  await page.getByRole('button', { name: /Check another message/ }).click();
  await page.getByRole('tab', { name: /QR code/ }).click();
  await page.getByRole('button', { name: /scan to receive cashback/i }).click();
  await page.getByTestId('qr-decoded').waitFor();
  await result();
  await shot('06-qr-result');
  await page.getByRole('button', { name: /Check another message/ }).click();
  await page.getByRole('tab', { name: /screenshot/i }).click();
  await page.getByRole('button', { name: /Bank SMS/ }).click();
  await page.getByTestId('ocr-text').waitFor({ timeout: 90000 });
  await shot('07-screenshot-ocr');
  await page.goto(`${BASE}/#/dashboard/library`);
  await page.getByRole('button', { name: /Judges' set/ }).click();
  await page.getByTestId('run-all').click();
  await page.getByTestId('library-summary').waitFor();
  await shot('08-library');
  await page.goto(`${BASE}/#/dashboard/check`);
  await page.getByRole('button', { name: 'ಕನ್ನಡ' }).click();
  await page.getByTestId('try-example').click();
  await result();
  await shot('09-kannada');
  await page.getByRole('button', { name: 'हिन्दी' }).click();
  await shot('10-hindi');
  await page.goto(`${BASE}/#/dashboard/privacy`);
  await page.getByRole('button', { name: 'English' }).click();
  await shot('11-privacy');
  await browser.close();
  console.log(`screenshots: ${tag} done`);
}

await run(1440, 900);
await run(390, 844);
