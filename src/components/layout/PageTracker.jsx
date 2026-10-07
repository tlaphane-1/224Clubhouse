import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuth } from '../../context/useAuth'
import { setAnalyticsOptOut, trackEvent } from '../../utils/analytics'

/**
 * Records one page_view per route change. Waits for auth to settle so an
 * admin's first page isn't counted before we know they're an admin.
 */
export default function PageTracker() {
  const { pathname } = useLocation()
  const { loading, isAdmin } = useAuth()

  useEffect(() => {
    setAnalyticsOptOut(isAdmin)
  }, [isAdmin])

  useEffect(() => {
    if (loading) return
    trackEvent('page_view', pathname)
  }, [pathname, loading])

  return null
}
