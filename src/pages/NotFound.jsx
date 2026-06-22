import { useEffect } from 'react'
import { Link } from 'react-router-dom'

export default function NotFound() {
  useEffect(() => { document.title = 'Page Not Found | 224 Clubhouse' }, [])
  return (
    <div className="min-h-screen pt-28 pb-20 flex flex-col items-center justify-center text-center px-4 animate-fadeIn">
      <div className="font-heading text-7xl font-bold text-gold/30 mb-4">404</div>
      <h1 className="font-heading text-2xl text-white mb-3">Page not found</h1>
      <p className="text-muted text-sm mb-8 max-w-sm">
        The page you're looking for doesn't exist or has moved.
      </p>
      <Link to="/store" className="btn-gold">Back to Store</Link>
    </div>
  )
}
