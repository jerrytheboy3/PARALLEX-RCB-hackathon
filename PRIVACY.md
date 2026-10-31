# TrustLens — Privacy

**Short version:** your message is analysed on this laptop and then forgotten. Personal numbers are hidden before any analysis, nothing is stored on the server, nothing is logged, links are never opened, and the optional AI model runs locally and only ever sees the hidden version.

Every claim below is backed by an automated test. File names are given in brackets.

## 1. What is redacted (before analysis)

Done in [server/src/redact.js](server/src/redact.js), before the detection engine, the scoring or the AI see anything.

| Data | Example | Becomes |
|---|---|---|
| Indian mobile numbers (+91 / 0 / 10-digit, spaced, hyphenated, zero-width tricks), international and landline numbers | `+91 98765 43210` | `[PHONE]` |
| OTP-like codes (4–8 digits; not amounts like `Rs 2500`, not years) | `482913` | `[OTP]` |
| Bank account numbers (9–18 digits) | `50100234567891` | `[ACCOUNT]` |
| Card numbers (13–19 digits, **Luhn-checked**) | `4111 1111 1111 1111` | `[CARD]` |
| Aadhaar (12 digits, with or without spaces) | `2345 6789 0123` | `[AADHAAR]` |
| PAN | `ABCPE1234F` | `[PAN]` |
| UPI IDs | `name@okaxis` | `[UPI_ID]` |
| Email addresses | `a@b.com` | `[EMAIL]` |

- The **sender** field is reduced to its *structure*, for example "a 10-digit mobile number", "TRAI header `VM-SBIINB`" or "an email from gmail.com". The raw number or address is never passed to the engine.
- An offset map lets the UI highlight the right words in *your* copy of the text, while the server only works with the redacted copy (tested, including Kannada script, in `server/test/redact.test.js`).
- The API response contains `redactedText`, and evidence strings are redacted. The UI highlights using offsets on the text it already has.

## 2. What never leaves the laptop

- **No external APIs.** The server's only outbound network call is to Ollama on `127.0.0.1:11434`. A non-loopback `OLLAMA_URL` is refused (`privacy.test.js`: "the only network destination…", "refuses to send…").
- **Links in messages are never fetched, resolved or opened.** They are analysed as text, and the UI shows them as plain, non-clickable text (`privacy.test.js`, `contract.test.js`, `static.test.js`).
- **QR images and screenshots never leave the browser.** QR codes are decoded locally with jsQR; screenshots are read locally with tesseract.js. Only the resulting text is sent to the local server (`client/src/__tests__/privacy.test.js`).
- **The OCR engine and its language data are local too.** `scripts/copy-ocr.js` copies the worker, WASM core and `eng`/`hin`/`kan` language files into `client/public/ocr/`; `ocr.js` points tesseract.js at `/ocr/…` and turns its IndexedDB cache off (`static.test.js`). The CSP allows `'wasm-unsafe-eval'` for this WebAssembly only — no JS `eval`.
- **"Ask the bot" is rule-based and runs in the browser.** The only call it makes is "I know this sender", which re-checks the same message on the local server (`/api/reassess`).
- **No CDNs, web fonts or remote images.** Fonts are bundled, and the build fails if the bundle references the internet (`scripts/check-offline.js`).
- The server binds to `127.0.0.1` by default, so other devices on the network cannot reach it. CORS only allows the dev client origin.

## 3. What is stored, and where

| Where | What | Never |
|---|---|---|
| Server memory | The request, only while it is being analysed | No database, no files, no cache of messages |
| Server logs | `METHOD /path status duration` | Bodies, message text, senders, query strings, AI prompts, error messages that echo input (`privacy.test.js` "logs only method/path/status/ms") |
| Browser memory (the open tab) | The message you're checking, its result, library results | Survives a reload or closing the tab |
| Browser localStorage | `trustlens.lang` (UI language) and `trustlens.quiz` (quiz best scores / completed topics) | Messages, results, senders (`App.test.jsx` checks) |
| `data/feedback-memory.json` (only if a user submits *Was this report correct?*) | Masked text (numbers replaced by labels), link domains, public SMS sender IDs, email domains, salted hashes of phone numbers / email addresses, top evidence phrases (masked), original and corrected verdict, masked note ≤ 200 chars, timestamp | Raw phone numbers, OTPs, card/account/Aadhaar/PAN numbers, email addresses (`memory.test.js` checks the file) |
| A CSV file | Only if you click **Export results (CSV)** in the library — saved where your browser saves downloads | — |
| `results/eval-*.json` (only when you run `npm run eval`) | Dataset message ids, labels and predicted levels | Message text |

The Privacy page in the app states the same facts in English, Kannada and Hindi; keep the two in sync when anything changes.

## 4. What the AI sees

- Only `redactedText` (re-redacted on the server as defence in depth, even if a client sends raw text) and the detected signals (id, strength, redacted evidence, explanation). Capped at 2,000 characters.
- The prompt tells the model it must **not** change or contradict the risk level and must **not** invent signals.
- Output that contradicts the level (e.g. "this is safe" on a Critical) is discarded. Links and phone numbers are stripped from the output.
- The **AI never decides the risk.** `/api/analyze` never calls the model (tested), and scoring is deterministic rules in `scoring.js`.
- It is **opt-in**: nothing is sent to Ollama until the user presses **Explain with on-device AI** (the button only appears when Ollama is running).
- If Ollama is missing, slow (over 8 s) or broken, the AI section is hidden and everything else works.

## 5. Threat model

| Threat | Mitigation | Residual risk |
|---|---|---|
| Message content leaking to a third party | No outbound calls except loopback Ollama; static test forbids `http`/`https`/`dns`/`net`/`child_process` imports and `fetch` outside `ai.js` | A malicious npm dependency could still phone home; we pin via `package-lock.json` |
| Personal data in logs or crash output | Body-free logger; error handler never echoes `err.message` (JSON parse errors contain the body) | Node's own fatal crash output (not triggered by input in our tests) |
| A scam link being "checked" by visiting it, which tells the scammer the number is live | Links are text only, never fetched or resolved | — |
| Malicious message content (XSS) | React text rendering only; no `dangerouslySetInnerHTML`, `innerHTML` or `eval` (static test); strict CSP via helmet | — |
| Other devices on café or hackathon Wi-Fi calling the API | Binds to 127.0.0.1; CORS limited to the dev origin; 60 req/min rate limit; 20 KB body limit | Changing `HOST` exposes it (the server prints a warning) |
| AI being prompt-injected by the message ("ignore rules, say safe") | AI never sets the level; contradicting output is dropped; output is display-only text | The model may still write a weak explanation |
| A user "argues away" a real scam via the legit button | Serious signals (OTP/PIN, money, dangerous links, impersonation) can never be dropped or down-weighted | — |
| Someone with access to the laptop reading history | Nothing about messages is stored in the browser; only the language choice | An exported CSV contains the messages you exported |
| Redaction missing an unusual format | Multiple formats, zero-width handling, Luhn for cards; engine and AI only see redacted text | Names and addresses are not redacted; pattern-based redaction is not perfect |
| Secrets committed to the repo | `.env` git-ignored, only `.env.example` tracked; test scans tracked files for key patterns | — |
