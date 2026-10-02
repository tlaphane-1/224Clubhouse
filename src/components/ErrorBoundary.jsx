import { Component } from 'react'

/**
 * Top-level error boundary. Without one, a single render error (or a lazy-chunk
 * import that fails after a new deploy) white-screens the whole SPA. This shows
 * a branded fallback and auto-recovers from stale-chunk errors with a one-time
 * reload.
 */
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidMount() {
    // Reached a healthy render — allow a future chunk reload if needed.
    sessionStorage.removeItem('chunk-reload')
  }

  componentDidCatch(error) {
    const msg = String(error?.message || '')
    // After a deploy, an open tab's index.html points at hashed chunks that no
    // longer exist; the dynamic import rejects. Reload once to get fresh assets.
    if (/Loading chunk|dynamically imported module|Importing a module script failed|Failed to fetch dynamically/i.test(msg)) {
      if (!sessionStorage.getItem('chunk-reload')) {
        sessionStorage.setItem('chunk-reload', '1')
        window.location.reload()
      }
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-screen bg-background flex items-center justify-center px-6">
          <div className="max-w-md w-full text-center">
            <div className="font-heading text-5xl font-bold text-gold mb-2">224</div>
            <h1 className="font-heading text-2xl text-white mb-3">Something went wrong</h1>
            <p className="text-muted text-sm mb-8">
              An unexpected error occurred. Please reload — your cart is saved.
            </p>
            <div className="flex items-center justify-center gap-3">
              <button onClick={() => window.location.reload()} className="btn-gold">Reload</button>
              <button onClick={() => window.location.assign('/')} className="btn-outline">Back to Home</button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
