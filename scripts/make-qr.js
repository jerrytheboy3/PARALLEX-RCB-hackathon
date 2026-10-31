// Generates the sample QR images used in the demo (offline, via the `qrcode` package).
// Output: client/src/assets/samples/*.png — all payees/URLs are FAKE.
import QRCode from 'qrcode';
import { fileURLToPath } from 'node:url';

export const QR_SAMPLES = [
  { file: 'qr-upi-receive-scam.png', label: 'UPI "receive cashback" scam', text: 'upi://pay?pa=cashback.rewards@ybl&pn=Amazon%20Rewards&am=4999&cu=INR&tn=Scan%20to%20receive%20cashback' },
  { file: 'qr-url-scam.png', label: 'Fake SBI reward link', text: 'https://sbi-rewards-claim.xyz/redeem?ref=QR' },
  { file: 'qr-upi-shop.png', label: 'Normal shop UPI QR', text: 'upi://pay?pa=sharma.kirana@okicici&pn=Sharma%20Kirana%20Store&cu=INR' },
];

const out = fileURLToPath(new URL('../client/src/assets/samples/', import.meta.url));
for (const s of QR_SAMPLES) {
  await QRCode.toFile(out + s.file, s.text, { width: 360, margin: 2, errorCorrectionLevel: 'M' });
  console.log(`wrote client/src/assets/samples/${s.file}`);
}
