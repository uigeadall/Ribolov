import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 30000,
    // Firebase v12 ships ESM with conditional exports that Vite occasionally
    // fails to pre-bundle under SSR/node. Inlining sidesteps that.
    server: { deps: { inline: ['firebase', '@firebase/rules-unit-testing'] } },
  },
});
