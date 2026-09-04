import { defineConfig } from 'vitest/config';

// Two workers max: this machine wedges under the default parallelism (house rule).
// The "source" export condition resolves sibling workspace packages from src/ without a
// build step; workspace links are externalised by Vite's SSR resolver, hence both lists.
export default defineConfig({
  resolve: { conditions: ['source'] },
  ssr: { resolve: { conditions: ['source'], externalConditions: ['source'] } },
  test: {
    pool: 'threads',
    minWorkers: 1,
    maxWorkers: 2,
  },
});
