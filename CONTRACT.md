# TrustLens — Integration Contract (P1 / P2 / P3 / P4)

This file is the single source of truth for how the pieces plug together.
If you follow it, merging your code is a one-line change and `npm test` tells you
whether it worked (`tests/contract.test.js` checks the engine automatically).

All code is **plain JavaScript, ES modules** (`import` / `export`), Node 20+.
**No network calls, no file writes, no storage, no `console.log` of message text.**

---

## 1. Detection engine (P2) — `engine/index.js`

`engine/index.js` currently re-exports the stub. To plug in your engine:

```js
// engine/index.js
export { detect } from './p2/index.js';   // ← your file(s), any layout you like inside engine/
export const engineName = 'p2';
```

### Signature

```js
detect({
  text,        // string — the message, ALREADY PII-REDACTED by the server (see §1.3)
  type,        // "sms" | "email" | "qr"
  sender,      // string | undefined — redacted sender ("[PHONE]", "VM-SBIINB", "[EMAIL]" …)
  senderInfo,  // object — structure of the sender without the raw value (see §1.4)
  subject,     // string | undefined — email subject (redacted)
  replyTo,     // string | undefined — email Reply-To (redacted)
  replyToInfo, // object | undefined — same shape as senderInfo
}) → {
  signals: Signal[],
  links:   Link[],
  claimedOrgs?: string[]          // optional, ids from server/src/orgs.json
}
// may be sync or async (return a Promise) — both work
```

### Signal

| field         | type                                                                                 | notes |
|---------------|--------------------------------------------------------------------------------------|-------|
| `id`          | string                                                                               | stable snake_case id, e.g. `otp_request`, `lookalike_domain`. Same kind of thing → same id (the "this is legit" flow disputes by id). |
| `category`    | `"urgency"│"threat"│"credential"│"money"│"link"│"sender"│"impersonation"│"other"`   | |
| `strength`    | `"weak"│"serious"`                                                                   | **serious** = can never be dismissed by the user (OTP/PIN/password request, dangerous link, money request, impersonation). |
| `weight`      | number, 1–40                                                                          | contribution to the 0–100 score. |
| `start`,`end` | number (JS string indices, UTF-16) **or `null`**                                     | span in the `text` you were given. `null`/`null` only for metadata signals (sender, reply-to, subject). |
| `evidence`    | string                                                                               | **must equal `text.slice(start, end)`** when start/end are numbers (the test checks this). |
| `explanation` | string                                                                               | one plain-English sentence a non-technical person understands. |
| `lang`        | `"en"│"kn"│"kanglish"│"hi"│"hinglish"`                                              | language of the matched words. |

### Link

```js
{ url, start, end, verdict: "ok" | "suspicious" | "dangerous", reasons: [string] }
// url must equal text.slice(start, end)
```
Links are **text only** — never fetch, resolve, DNS-lookup or open them.
If a link is suspicious/dangerous, also emit a matching `link` signal so it is scored.

### 1.1 Rules
- Pure function: same input → same output. No network, no `fs` writes, no globals that persist between calls, no logging of text.
- Never throw on odd input (empty-ish text, emoji, Kannada, 5,000 chars, zero-width chars). Return empty arrays instead.
- **Offsets point into the exact `text` you received.** If you normalise internally (remove zero-width chars, `0TP`→`OTP`, `bit . ly`→`bit.ly`, lowercase …), keep an index map and translate back. `text.slice(start, end)` must be the original characters.
- Overlapping signals are fine — the UI handles them.
- Kannada: use Unicode-aware regexes (`/u` flag), don't rely on `\b` around Kannada letters (`\b` is ASCII-only in JS).

### 1.2 Server-side signals (you don't need to produce these)
The server adds a few signals of its own, with `source: "server"`:
`org_link_mismatch` (message names an organisation but links to a domain that isn't theirs), `upi_receive_scam` (QR). Don't duplicate them.

### 1.3 Redaction tokens you will see in `text`
`[PHONE] [OTP] [ACCOUNT] [CARD] [AADHAAR] [PAN] [UPI_ID] [EMAIL]` — treat them as opaque words.
e.g. `"call [PHONE] and share the [OTP]"`. A token is itself evidence (e.g. `[UPI_ID]` near "pay").

### 1.4 `senderInfo`
```js
{
  kind: "none" | "header" | "mobile" | "landline" | "intl" | "shortcode" | "email" | "name",
  header?: "VM-SBIINB",   // only for kind "header" — TRAI-style headers are public, not PII
  domain?: "gmail.com",   // only for kind "email"
  freemail?: boolean,     // email domain is gmail/yahoo/outlook/… 
}
```
Use it for checks like "a bank texting from a normal 10-digit mobile number" (`kind === "mobile"`).

---

## 2. Dataset (P1) — `data/messages.json`

JSON array, same schema as `data/seed.json`:

```json
{
  "id": "en-kyc-001",
  "type": "sms",
  "sender": "+91 98765 43210",
  "subject": "only for email",
  "replyTo": "only for email",
  "text": "Dear customer, your SBI account …",
  "lang": "en",
  "label": "scam",
  "scamType": "kyc",
  "expectedLevel": "critical"
}
```
- `type`: `"sms" | "email" | "qr"` · `lang`: `"en" | "kn" | "kanglish" | "hi" | "hinglish"` · `label`: `"scam" | "normal"`
- `scamType` (scams only): `kyc | electricity | upi | courier | fake_police | job | lottery | refund | loan | other`
- `expectedLevel` (optional): `"safe" | "caution" | "high" | "critical"`
- Target: 150–200 messages, ~60 % scam / 40 % normal, mix of all three languages.
- Use **fake** numbers/IDs only (e.g. 98765 43210, never a real person's number).

Run `npm run eval` — it picks up `data/messages.json` automatically (falls back to `seed.json`).

## 3. Baseline (P1) — `baseline/index.js`

```js
export function keywordFilter(text) → { flagged: boolean, matched: string[] }
```
Dumb on purpose (that's the point of the comparison). Synchronous, no network.
`npm run eval` prints its accuracy next to TrustLens'.

---

## 4. HTTP API (P3 ↔ P4)

All JSON, stateless, nothing is persisted. Server: `http://127.0.0.1:5050`.

| Method | Path            | Body → Response |
|--------|-----------------|-----------------|
| GET    | `/api/health`   | → `{ ok, engine: "stub"│"p2", ai: "ready"│"unavailable", model }` |
| GET    | `/api/samples`  | → `{ source: "seed"│"dataset", samples: [...] }` |
| POST   | `/api/feedback` | analyze body + `{ userVerdict, note? }` → `{ ok, id, stats }`; results may then carry `memory: { match: "exact"│"related", verdict, scam, real, applied, shift?, on? }` and a `community_reports` signal |
| POST   | `/api/analyze`  | `{ text, type, sender?, subject?, replyTo?, context?, expectedOrg?, trustedSenders? }` → AnalyzeResult (incl. `urls[]` URL inspection and `senderCheck`) |
| POST   | `/api/analyze/batch` | `{ items: [{ id?, ...analyze body }], compact?: boolean }` (max 250, or 1,000 compact) → `{ results: [{ id, result }] }` or compact `{ results: [{ id, level, score, top: { id, category, strength, weight, explanation } \| null, signalIds }] }` |
| POST   | `/api/explain`  | `{ redactedText, signals, level, lang?: "en"│"kn"│"hi" }` → `{ explanation: string│null }` |
| POST   | `/api/reassess` | analyze body + `{ disputedSignalIds, reason, trustSender }` → AnalyzeResult + `{ changes }` |

**AnalyzeResult**
```js
{
  level: "safe"|"caution"|"high"|"critical", score: 0-100, verdict: string,
  signals: [Signal & { key, source: "engine"|"server", weightApplied }],   // offsets into ORIGINAL text, evidence redacted
  links:   [Link],                                                          // offsets into ORIGINAL text, url redacted
  orgs: [{ id, name }],
  verifySteps: [{ orgId, title, steps: [string], officialApp?, officialDomains: [string] }],
  reportSteps: [{ id, title, detail }],
  redactedText, redactionSummary: { phone, otp, account, card, aadhaar, pan, upi, email },
  senderVerified: boolean, senderTrusted: boolean,
  displayText?: string,   // QR only: the human-readable text the offsets refer to
  qr?: { kind: "url"|"upi"|"text", ... },
  aiAvailable: boolean, engine: "stub"|"p2",
  combos: [{ id, label, bonus }]
}
```
Reassess adds `changes: [{ id, action: "dropped" | "kept", why }]`.
Errors: `{ error: "message" }` with 400 (bad input), 413 (too big), 429 (rate limit), 500.
