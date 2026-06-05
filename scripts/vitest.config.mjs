import { defineConfig } from 'vitest/config';

// Dedicated config so the Boondi capture harness's pure unit tests (the CRM
// capture matcher) are discoverable. The repo-root vitest config only includes
// apps/core + packages/contracts, so `vitest run scripts/lib/...` finds nothing
// without this. Run from the repo root:
//   npx vitest run -c scripts/vitest.config.mjs
export default defineConfig({
  test: {
    include: ['scripts/lib/**/*.test.mjs'],
  },
});
