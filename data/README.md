# data/

| File | What | Used by |
|---|---|---|
| `messages.csv` | **P1's dataset, the source of truth** (`id,channel,language,sender,claimed_org,message,label`, 60 rows) | → `messages.json` via `npm run import:data` |
| `messages.json` | generated | `npm run eval`, `npm test`, Library “Team dataset” |
| `seed.json` | 20 hand-made messages in English, ಕನ್ನಡ, हिन्दी, Kanglish, Hinglish that the demo relies on | “Try an example”, Library “Judges' set” |

Don't hand-edit the JSON files; edit the CSV (or the raw exports) and re-run the build.

| `cyberQuiz.json` | **Be Cyber Aware** quiz: 109 hand-written scenario questions in 14 categories (`id, category, difficulty, scenario, question, options[4], correctIndex, explanation, redFlags`) | the quiz tile, `tests/quiz.test.js` |
| `feedback-memory.json` | **runtime, git-ignored**: masked user corrections ("Was this report correct?") — see `server/src/memory.js` | the analysis pipeline |

All numbers, IDs and UPI handles in committed files must be **fake**.
