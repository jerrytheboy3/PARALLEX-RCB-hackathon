# TrustLens — Demo guide

## Wi-Fi-off checklist (do this 30 min before judging)

- [ ] `git pull`, then `npm install` **while online**.
- [ ] `npm test`: all green.
- [ ] (Optional) Ollama running (`ollama serve`), model pulled (`ollama list` shows `llama3.2:3b`), warmed once: `ollama run llama3.2:3b "hi"`.
- [ ] **Turn Wi-Fi OFF.**
- [ ] `npm run demo`, then open **http://127.0.0.1:5050**.
- [ ] Switch to **ಕನ್ನಡ** and **हिन्दी** once (top right) — no boxes anywhere — then back to English.
- [ ] Upload a screenshot once (**Scam or Real? → Upload a screenshot → Bank SMS (हिन्दी)**) so the OCR files are warm.
- [ ] Browser zoom at 110–125% so the riskometer reads from across the room.
- [ ] For a physical demo, have `client/public/samples/qr-upi-receive-scam.png` and `screenshot-courier-en.png` on a phone.
- [ ] Double-check the report channels in `server/src/report.js` and the copy in the action steps (1930, cybercrime.gov.in).

## 3-minute script

| Time | Do | Say |
|---|---|---|
| 0:00–0:15 | Landing page. Point at the lock line. | "Check any message, link or QR code before you trust it. Wi-Fi is off right now — it all runs on this laptop." Click **Explore Dashboard**. |
| 0:15–0:25 | Dashboard → **Scam or Real?** | "Three tools. The main one is Scam or Real?" |
| 0:25–1:05 | **Try an example** (fills an SBI KYC SMS, a mobile-number sender and *expected: sbi.co.in*) → **Check this message**. | "Reading, links, sender, done. The needle swings to 100: HIGH RISK. Three plain sentences: it pretends to be SBI, the link goes to `sbi-kyc-verify.xyz`, and it rushes you." Open **See the evidence**: "Every signal, the exact words highlighted — hover 'share the OTP'. The link card bolds the *real* domain and shows ⚠ rows: http, cheap .xyz ending, imitates SBI — all without opening it. And the sender comparison: a personal number vs SBI → Mismatch." |
| 1:05–1:20 | Scroll to **What should you do now?** | "Five steps, adapted to this message, with 1930 and cybercrime.gov.in. One click to copy and forward to a parent." |
| 1:20–1:45 | **Ask the bot**: type *"I was expecting a delivery today"*, then tap **I know this sender**. | "It answers from the evidence: expecting something makes it feel real, but the link isn't sbi.co.in. And knowing the sender can't argue away an OTP request." |
| 1:45–2:05 | Top right → **हिन्दी**, then **ಕನ್ನಡ**. | "The whole interface — including this result — in Hindi and Kannada." Back to English. |
| 2:05–2:30 | **Check another message → Upload a QR code → “Scan to receive cashback”** → Check. Then **Upload a screenshot → Bank SMS (हिन्दी)**. | "The QR is decoded in the browser: a UPI request that *takes* money. And a screenshot: the Hindi text is read on this laptop, editable, then checked." |
| 2:30–2:50 | **Sample Message Library → Everything → Run all**, click a row. | "80 messages — English, Kannada, Hindi, Kanglish, Hinglish, our team's labelled dataset — in one go. Filters, CSV export, and any row opens the full result." |
| 2:50–3:00 | **Privacy**. | "Every line here is true for this code: checked on 127.0.0.1, images never uploaded, links never opened, nothing saved." |

**Backup lines if asked**

- *"How accurate is it?"* → `npm run eval` on P1's dataset vs a plain keyword filter (the library also shows "N of M match the expected label").
- *"What if Ollama crashes?"* → The **Explain with on-device AI** button just disappears; everything else works.
- *"What if the server dies?"* → The page says it can't reach the checker; it never invents a result.
- *"Is the AI deciding?"* → No. Scores are fixed rules (`server/src/scoring.js`); the AI only writes words, and only if you press the button.
- *"Privacy proof?"* → [PRIVACY.md](PRIVACY.md); `npm test` checks logs, the AI prompt, request bodies and browser storage.

## If something goes wrong

| Symptom | Fix |
|---|---|
| "Can't reach the TrustLens checker" | Start `npm run demo`. A port clash shows "Port 5050 is already in use" → `lsof -i :5050`, stop that process, or set `API_PORT`. |
| Screenshot stays at "Getting the text reader ready…" | Hard-refresh. `client/public/ocr/` must exist — `npm run build` recreates it. |
| Kannada / Hindi shows boxes | Hard-refresh. Fonts are bundled, so a stale cache is the only cause. |
| "Too many checks in a minute" | The API allows 60 requests/minute. Use the library's **Run all** (one request) for bulk demos. |
