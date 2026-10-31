// Renders two phone-style SMS screenshots for the "Upload a screenshot" demo
// (client/src/assets/samples/screenshot-*.png). Text only — no real brands' artwork.
// Usage: node scripts/make-screenshot-samples.js
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../client/src/assets/samples/', import.meta.url));
const SHOTS = [
  {
    file: 'screenshot-courier-en.png',
    sender: '+91 91234 56789',
    time: 'Today 10:42 AM',
    text: 'India Post: Your parcel IND-9021 is on hold due to an incomplete address. Pay Rs 25 redelivery fee within 24 hours or it will be returned: http://indiapost-redelivery.top/pay',
  },
  {
    file: 'screenshot-bank-hi.png',
    sender: '+91 98765 11223',
    time: 'आज 9:15 PM',
    text: 'प्रिय ग्राहक, आपका SBI खाता आज रात ब्लॉक कर दिया जाएगा। तुरंत KYC अपडेट करें: http://sbi-kyc-update.in/login और आपको मिला OTP इस नंबर पर भेजें।',
  },
];

const html = (s) => `<!doctype html><meta charset="utf-8"><style>
  body{margin:0;background:#fff;font:21px/1.45 -apple-system,'Helvetica Neue','Kohinoor Devanagari','Noto Sans Devanagari',sans-serif;color:#000}
  .top{padding:26px 28px 18px;border-bottom:1px solid #e5e5ea;text-align:center}
  .who{font-weight:600;font-size:22px}.sub{color:#8e8e93;font-size:16px;margin-top:2px}
  .t{color:#8e8e93;font-size:15px;text-align:center;margin:22px 0 10px}
  .b{margin:0 90px 40px 22px;background:#e9e9eb;border-radius:22px;padding:14px 18px;word-break:break-word}
</style><div class="top"><div class="who">${s.sender}</div><div class="sub">Text Message · SMS</div></div>
<div class="t">${s.time}</div><div class="b">${s.text}</div>`;

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 560, height: 520 }, deviceScaleFactor: 2 });
for (const s of SHOTS) {
  await page.setContent(html(s));
  const h = await page.evaluate(() => document.body.scrollHeight);
  await page.setViewportSize({ width: 560, height: h });
  await page.screenshot({ path: OUT + s.file });
  console.log('wrote client/src/assets/samples/' + s.file);
}
await browser.close();
