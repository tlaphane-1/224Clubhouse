// Vite config for LOCAL demos only (used by scripts/demo-explosive420-local.mjs).
// It is the normal vite.config.js plus a dev-server proxy: the browser talks to
// http://localhost:<port>/sb/* and Vite forwards it to the local Supabase stack,
// whose https endpoint uses a self-signed certificate that Chrome would block.
// The proxy target must be a loopback host; anything else is refused.
import { mergeConfig } from 'vite'
import base from '../vite.config.js'

const target = process.env.DEMO_LOCAL_API_URL
if (!target || !['127.0.0.1', 'localhost'].includes(new URL(target).hostname)) {
  throw new Error(`vite.demo-local.config: DEMO_LOCAL_API_URL must be a local stack URL (got ${JSON.stringify(target)})`)
}

export default mergeConfig(base, {
  server: {
    proxy: {
      '/sb': {
        target,
        changeOrigin: true,
        secure: false, // the local stack's self-signed certificate
        ws: true,
        rewrite: (p) => p.replace(/^\/sb/, ''),
      },
    },
  },
})
