import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        // Split large dependencies into separate, long-cacheable chunks so they
        // don't bloat the entry and are re-fetched only when they actually change.
        manualChunks(id) {
          if (!id.includes('node_modules')) return
          if (id.includes('firebase')) return 'firebase'
          if (id.includes('@supabase')) return 'supabase'
          if (id.includes('@paystack')) return 'paystack'
          if (id.includes('react-router')) return 'router'
          if (id.includes('@tanstack')) return 'query'
          if (id.includes('/react/') || id.includes('/react-dom/') || id.includes('/scheduler/')) return 'react'
        },
      },
    },
  },
  test: {
    environment: 'node',
    setupFiles: ['./test/loadEnv.mjs'],
    // Reaps live-DB fixtures left behind by crashed runs, once per run, before
    // any test file. Replaces the per-suite prefix purges that used to delete a
    // concurrent run's fixtures out from under it — see
    // src/__tests__/helpers/liveFixtures.js.
    globalSetup: ['./test/globalSetup.mjs'],
    // The contract suites hit the live Supabase project; running the files in
    // parallel makes their user-provisioning beforeAll hooks time out under
    // concurrent load. Serial file execution keeps them deterministic.
    fileParallelism: false,
    // Sized from measurement, not guessed. Round-trip latency to this project
    // is ~250ms median but has a long tail: 3.9s on /auth/v1/token and 3.1s on
    // a plain select were both observed during otherwise healthy runs. A hook
    // makes 4-6 sequential calls and a test up to 4, so vitest's 5s test /
    // 10s hook defaults sat close enough to the tail that a single slow
    // response failed the run. These budgets absorb two tail responses per hook
    // while still failing fast on a genuine hang (a blocked row lock used to
    // stall for minutes, not seconds).
    testTimeout: 20000,
    hookTimeout: 30000,
  },
})
