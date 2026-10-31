import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// One test runner for the whole monorepo.
// Client tests opt into jsdom with a `// @vitest-environment jsdom` comment.
export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    include: ['tests/**/*.test.js', 'server/test/**/*.test.js', 'client/src/**/*.test.{js,jsx}'],
    environment: 'node',
    testTimeout: 15000,
  },
});
