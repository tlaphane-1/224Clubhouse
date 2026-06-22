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
  },
})
