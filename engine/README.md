# engine/ — P2's detection engine goes here

1. Put your code in `engine/p2/` (any layout; entry exporting `detect`).
2. Edit `engine/index.js`:
   ```js
   export { detect } from './p2/index.js';
   export const engineName = 'p2';
   ```
3. Run `npm test`. `tests/contract.test.js` checks your output shape, that
   `text.slice(start, end) === evidence`, determinism, no network calls, and
   robustness on emoji / Kannada / zero-width / 5,000-char input.
4. Run `npm run eval` to see accuracy on the dataset.

`stub.js` is a placeholder — delete it once yours is in (or keep it as a fallback).
Full interface: [../CONTRACT.md](../CONTRACT.md).
