import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    testTimeout: 15000,
    hookTimeout: 30000,
    // Rules test files share a single Firestore emulator instance and a
    // singleton RulesTestEnvironment.  Running files in parallel causes
    // clearFirestore() in one file's afterEach to race with operations in
    // another file, producing spurious "Null value error" failures on
    // documents that were wiped mid-test.  Serial execution is required.
    fileParallelism: false,
    // Firebase v12 ships ESM with conditional exports that Vite occasionally
    // fails to pre-bundle under SSR/node. Inlining sidesteps that.
    server: { deps: { inline: ['firebase', '@firebase/rules-unit-testing'] } },
  },
});
