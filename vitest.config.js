import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // mongodb-memory-server may download a binary on first run; give hooks room.
    testTimeout: 30_000,
    hookTimeout: 120_000,
    // Each test file gets an isolated module registry so config/mongoose re-init per file.
    isolate: true,
    fileParallelism: false,
  },
});
