// ┌───────────────────────────────────────────────────────────────────────┐
// │ ENGINE SWAP POINT. The server imports { detect, engineName } from here. │
// │ To plug in P2's engine, replace the two lines below with:              │
// │   export { detect } from './p2/index.js';                              │
// │   export const engineName = 'p2';                                      │
// │ then run `npm test` — tests/contract.test.js checks the output shape.  │
// └───────────────────────────────────────────────────────────────────────┘
export { detect } from './stub.js';
export const engineName = 'stub';
