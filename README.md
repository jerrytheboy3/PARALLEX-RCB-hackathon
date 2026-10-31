# TrustLens — Catch the Impersonation

> **Pitch (placeholder — P1 to finalise):** TrustLens tells you in one glance whether an SMS, email, link, QR code or screenshot is a scam — in English, ಕನ್ನಡ, हिन्दी, Kanglish and Hinglish — and shows *exactly which words* gave it away. It runs entirely on your laptop: no message ever leaves the device.

Built for the **Parallax 24-hour hackathon, problem statement PS-03 — "TrustLens: Catch the Impersonation"**.

- Paste an SMS, email or link, drop a QR code, or upload a **screenshot** (read in the browser with tesseract.js, English + Hindi + Kannada). The result is a **riskometer** (0–100), a **LOW / MEDIUM / HIGH RISK** badge, a 2–3 sentence plain-language summary and every suspicious phrase highlighted with an explanation.
- **URL inspection without opening links** (https, raw IP, shortener, risky TLD, lookalike/typosquat, brand in subdomain, `@` trick, punycode, obfuscated path) and **sender comparison** (supplied sender vs the organisation you expected: Match / Lookalike / Mismatch).
- **Safe Action Advisor** (3–5 steps that adapt to the level and evidence) and **"Not sure? Ask the bot"** — a rule-based assistant that answers from this message's evidence, offline.
- **Sample Message Library** for judges: one-click sets (20 judge samples, P1's 60, everything), or paste / upload a .txt or .csv of any size (duplicates merged). Run all with a progress bar and Stop, then stat cards, search, filters, open any row in full, and CSV export.
- **Learns from corrections:** every result ends with *Was this report correct?* — a masked record is stored in `data/feedback-memory.json`; an exact repeat uses the majority verdict (badge *Adjusted using community feedback*), and messages sharing a link domain, sender or phone number move ±25 points per net report (capped ±50). The 5 most relevant corrections are given to the local LLM as examples.
- **Be Cyber Aware:** a 109-question scenario quiz (14 topics incl. 22 on new techniques like voice clones, quishing and ClickFix) with explanations, red-flag tags, scores and *Retry wrong ones*.
- The whole UI is in **English, ಕನ್ನಡ and हिन्दी**.
- **Rule-based, explainable scoring.** Every point of the score traces back to a detected signal. An optional **local** AI model writes a plain-language explanation, but it never decides the risk.
- **"Verify safely" steps** for 21 Indian organisations (banks, BESCOM, India Post, couriers, UPI apps, Income Tax, UIDAI, police/"digital arrest", telecoms, jobs), plus reporting via 1930, cybercrime.gov.in and Chakshu.
- **"I know this sender"** (in the bot) re-checks the message treating the sender as trusted: weak signs count for less, but serious ones (OTP/PIN requests, money requests, dangerous links) can never be argued away.
- **Privacy first.** Personal data is redacted *before* analysis, nothing is stored (the browser keeps only your language choice), nothing is logged, links are never opened, and QR codes and screenshots never leave the browser. See [PRIVACY.md](PRIVACY.md).

### Demo flow for judges (2 minutes)

1. Open **http://127.0.0.1:5050** → **Explore Dashboard** → **Scam or Real?**
2. **Try an example** → **Check this message**: riskometer swings to 100, HIGH RISK, three plain sentences. Open **See the evidence** for signals, the highlighted message, the link card (`sbi-kyc-verify.xyz` bolded, ⚠ rows) and the sender comparison (Mismatch).
3. In **Ask the bot**, type *"I was expecting a delivery today"* or tap **I know this sender**.
4. Switch to **ಕನ್ನಡ** or **हिन्दी** (top right) — everything, including the result, re-renders.
5. **Upload a QR code → “Scan to receive cashback”**, then **Upload a screenshot → Bank SMS (हिन्दी)** (text is read in the browser in ~5 s).
6. **Sample Message Library → Judges' set → Run all** (or **Everything**, 80 messages) → click any row for the full result.
7. **Privacy** explains, truthfully, what happens to a message.

---

## Architecture

```
 ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐   ┌──────────────┐
 │    Input     │──▶│    Redact    │──▶│    Engine    │──▶│    Score     │──▶│ Verify steps │──▶│ AI explain   │──▶│ Legit        │
 │ SMS / email /│   │ phone, OTP,  │   │ P2's detect()│   │ rule-based,  │   │ per org +    │   │ local Ollama │   │ feedback     │
 │ QR (decoded  │   │ account, card│   │ on REDACTED  │   │ one config,  │   │ 1930 /       │   │ redacted in, │   │ weak signals │
 │ in browser)  │   │ Aadhaar, PAN,│   │ text → spans │   │ Safe…Critical│   │ cybercrime / │   │ optional,    │   │ drop, serious│
 │              │   │ UPI, email   │   │ mapped back  │   │              │   │ Chakshu      │   │ never scores │   │ stay         │
 └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘   └──────────────┘
   client/           server/src/        engine/            server/src/        server/src/        server/src/        server/src/
   lib/qr.js         redact.js          index.js           scoring.js         orgs.json          ai.js              pipeline.js
                                                                                                                    (reassess)
```

Everything runs on **one laptop**: React UI ⇄ Express on `127.0.0.1:5050` ⇄ (optional) Ollama on `127.0.0.1:11434`.

```
/client     React (Vite) + Tailwind v4 + Motion — the UI judges see            (P4)
            src/pages: Landing · DashboardHome · CheckTile · LibraryTile · PrivacyTile
            src/components: RiskGauge · StepCard · SignalItem · HighlightedText · UrlCard ·
                            SenderCompare · ActionChecklist · AskBot · LanguageSwitcher · Sidebar
            src/lib: analysis.js (server result → UI shape, summary, actions) · bot.js (askBot) ·
                     ocr.js (tesseract.js, local files) · qr.js (jsQR) · lang.js · bulk.js
            src/i18n: en.json · kn.json · hi.json (every UI string)
/server     Express API: redaction, pipeline, scoring, orgs, AI, QR, logger    (P3)
/engine     detection engine — index.js is the swap point, stub.js is a STUB   (P2)
/baseline   keyword-filter baseline (stub until P1's lands)                   (P1)
/data       seed.json (20, en/kn/hi) · messages.csv → .json (P1's 60) · cyberQuiz.json (109 quiz questions)  (P1)
/scripts    eval.js · check-offline.js · copy-ocr.js · make-qr.js · make-screenshot-samples.js · screenshots.js
/tests      contract.test.js — validates whatever engine/dataset is plugged in
```

## Run it offline on a Mac

**Once, while you still have internet:**

```bash
brew install node
```

```bash
npm install
```

```bash
brew install ollama
```

```bash
ollama serve
```

Then, in another terminal:

```bash
ollama pull llama3.2:3b
```

Ollama is optional. Without it, the AI explanation section is simply hidden.

**Demo (Wi-Fi can be off):**

```bash
npm run demo
```

Open **http://127.0.0.1:5050**. One command and one port: it builds the client, checks that the bundle has no remote references, and serves it from the API server.

| Command | What it does |
|---|---|
| `npm run dev` | API on :5050 + Vite on http://127.0.0.1:5173 with hot reload |
| `npm run demo` | Build the client and serve everything from http://127.0.0.1:5050 |
| `npm test` | All tests (server, client, privacy/security, engine contract) |
| `npm run eval` | Run the dataset through the full pipeline (and baseline) and print accuracy |
| `npm run import:data` | Convert P1's `data/messages.csv` into `data/messages.json` |
| `node scripts/screenshots.js` | Playwright screenshots of every screen (1440 and 390 wide) into `screenshots/` |

Configuration (all optional, see [.env.example](.env.example)): `HOST` (default `127.0.0.1`), `API_PORT` (5050), `OLLAMA_URL` (must be loopback), `OLLAMA_MODEL` (`llama3.2:3b`), `OLLAMA_TIMEOUT_MS` (8000).

If the server is unreachable, the UI says so plainly ("Can't reach the TrustLens checker on this computer…") instead of showing made-up results.

The OCR engine (tesseract.js worker + WASM) and its English/Hindi/Kannada language files are copied from `node_modules` into `client/public/ocr/` by `scripts/copy-ocr.js` before every dev/build, and served by the same local server — screenshot reading works with Wi-Fi off.

## Single-file HTML version

`TrustLens.html` (project root, ~15 MB) is the **whole website in one file** — every page, the detection engine, scoring, URL/sender checks, QR and screenshot reading (OCR engine + English/Hindi/Kannada data), the quiz, fonts and images. No server, no internet: double-click it, or host it on any static host (e.g. GitHub Pages → `https://<user>.github.io/<repo>/TrustLens.html`).

```bash
npm run build:html
```

Differences from the server version: analysis runs inside the page; feedback memory is kept in that browser's localStorage (per visitor); the optional Ollama explanation isn't available. Build config: `client/vite.standalone.config.js` (swaps the API client for `client/src/standalone/api.js` and Node built-ins for browser shims).

## API

All JSON, stateless, nothing persisted. Full shapes are in [CONTRACT.md §4](CONTRACT.md#4-http-api-p3--p4).

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/api/health` | — | `{ ok, engine: "stub"\|"p2", ai: "ready"\|"unavailable", model }` |
| GET | `/api/samples` | — | seed + P1 samples for the Library |
| POST | `/api/feedback` | analyze body + `{ userVerdict: "scam"\|"real", note? }` (≤ 200 chars) | `{ ok, id, stats }` — stores a masked correction |
| GET | `/api/feedback/stats` | — | `{ reports, scam, real }` (also in `/api/health` as `memory`) |
| POST | `/api/analyze` | `{ text, type: "sms"\|"email"\|"qr", sender?, expectedOrg?, subject?, replyTo?, context?, trustedSenders? }` | `{ level, score, verdict, signals, links, urls, senderCheck, orgs, verifySteps, reportSteps, redactedText, redactionSummary, aiAvailable, engine, … }` |
| POST | `/api/analyze/batch` | `{ items: [{ id?, …analyze body }], compact? }` (≤ 250 full / ≤ 1,000 compact, ≤ 2 MB; own rate budget) | `{ results: [{ id, result }] }`, or with `compact: true` `{ results: [{ id, level, score, top, signalIds }] }` — the Library's "Run all" |
| POST | `/api/explain` | `{ redactedText, signals, level, lang?: "en"\|"kn"\|"hi" }` | `{ explanation: string \| null }` (8 s timeout) |
| POST | `/api/reassess` | analyze body + `{ disputedSignalIds, reason, trustSender }` | analyze result + `changes: [{ id, action: "dropped"\|"kept", why }]` |

Limits: `text` ≤ 5,000 chars, body ≤ 20 KB (413), 60 requests/min, invalid input returns 400.

## How scoring works

All numbers live in one object, `SCORING` in [server/src/scoring.js](server/src/scoring.js).

- `score = Σ signal weights (each signal id counted once) + combination bonuses`, capped at 100.
  - Example combos: credential + link +20, impersonation + link +15, urgency + money +10, threat + police +20.
- Levels: **Safe** < 20 ≤ **Caution** < 45 ≤ **High** < 75 ≤ **Critical**.
- **Weak signals alone never exceed Caution. Critical requires at least one serious signal.**
- A sender matching the organisation's official SMS header or email domain, or one the user trusts, halves *weak* weights. Serious signals are never reduced.

## Plugging in P1 and P2

- **P2 (engine):** put your code in `engine/p2/`, change the two lines in [engine/index.js](engine/index.js), then run `npm test`. [tests/contract.test.js](tests/contract.test.js) checks the output shape, `text.slice(start, end) === evidence`, determinism, no network calls, and robustness on tricky input.
- **P1 (dataset):** ✅ merged — 60 messages in [data/messages.csv](data/messages.csv). To update, edit the CSV and run `npm run import:data`; `npm test` validates it, `npm run eval` scores it, and the website's examples menu lists every message.
- **P1 (baseline):** ✅ merged — [baseline/index.js](baseline/index.js) is a JS port of P1's `dumb_filter.py` (same words, same matching; originals in [baseline/python/](baseline/python/)). `npm run eval` prints it next to TrustLens.

Details: [CONTRACT.md](CONTRACT.md).

## Team

| Role | Owner | Scope |
|---|---|---|
| P1 | _name_ | Dataset (150–200 msgs, EN / ಕನ್ನಡ / Kanglish), keyword baseline, accuracy numbers, pitch |
| P2 | _name_ | Detection engine: links, senders, word lists, anti-trick normalisation |
| P3 | _name_ | Backend, PII redaction, local AI, scoring, verify steps, legit logic, privacy/security tests, docs |
| P4 | _name_ | Frontend: landing, dashboard, riskometer, evidence, action advisor, bot, library, i18n, QR + screenshot input |

## Limitations

- **Accuracy so far** (`npm run eval`): P1's dataset 76.7% High/Critical, 88.3% Caution+.
- **Feedback memory** trusts whoever uses this computer: there are no accounts, so one person can submit many corrections (the UI allows one per result and the API is rate-limited). Records are masked but a note could still contain a name.

- **The engine is currently a stub** with a handful of patterns. Real coverage depends on P2's engine. The 100% score on `seed.json` means nothing, because the stub was written against those 10 messages.
- Redaction is pattern-based. It catches numbers and IDs, not names or postal addresses. A number in an unusual format can slip through (it still never leaves the laptop).
- Org detection uses alias lists. Official domains and SMS headers in `orgs.json` should be re-checked; a wrong header only halves weak weights.
- Kanglish and Hinglish spelling varies a lot, and the stub knows only a few spellings. Hindi rules are new and not yet evaluated on a labelled Hindi dataset (P1's data is English + Kanglish).
- The UI shows three levels; the server's four map as Safe → LOW, Caution → MEDIUM, High and Critical → HIGH. The gauge zones follow the server's thresholds (20 / 45), not 35 / 70, so badge and needle always agree with the deterministic scoring.
- OCR quality depends on the image: phone screenshots read well; blurry photos and stylised fonts may need the "Paste it instead" fallback. The first screenshot loads ~20 MB of local OCR files into the browser.
- The bot is rule-based: it recognises a handful of intents (why, I know the sender, I was expecting it, how to verify, is the link safe, I already clicked) and otherwise falls back to the strongest evidence.
- The AI explanation quality depends on the local model (llama3.2:3b is small). It is guarded but can still be bland.
- Sender comparison is string-based: unknown SMS header lists in `orgs.json` mean some real headers show as "Can't confirm".

## Future scope

- Browser extension that checks emails and web pages in place.
- Android **share target** / WhatsApp "share to TrustLens", so users never copy and paste.
- More Indian languages (Tamil, Telugu, Marathi) and their code-mixed forms.
- An optional local-LLM backend for the bot (`VITE_BOT_BACKEND`), labelled on the Privacy page.

## License

Hackathon prototype. Add a license before reusing.
