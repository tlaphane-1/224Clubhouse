import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Star, AlertTriangle, Check, X, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import AdminLayout from '../../components/admin/AdminLayout'
import { Stars } from '../../components/store/StarRating'
import { useAdminReviews, useModerateReview, useDeleteReview } from '../../hooks/useProductReviews'

const FILTERS = [
  { key: 'pending', label: 'Waiting' },
  { key: 'approved', label: 'Published' },
  { key: 'rejected', label: 'Rejected' },
  { key: 'all', label: 'All' },
]

const STATUS_PILL = {
  pending: 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20',
  approved: 'bg-green-500/10 text-green-400 border-green-500/20',
  rejected: 'bg-red-500/10 text-red-400 border-red-500/20',
}

function formatDate(iso) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-ZA', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

export default function AdminReviews() {
  const [filter, setFilter] = useState('pending')
  const { data: reviews, isLoading, isError, refetch } = useAdminReviews(filter)
  const moderate = useModerateReview()
  const remove = useDeleteReview()

  useEffect(() => {
    document.title = 'Reviews | 224 Admin'
  }, [])

  const setStatus = async (id, status) => {
    try {
      await moderate.mutateAsync({ id, status })
      toast.success(status === 'approved' ? 'Review published' : 'Review rejected')
    } catch (err) {
      toast.error(err.message || 'Could not update the review')
    }
  }

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this review? This cannot be undone.')) return
    try {
      await remove.mutateAsync(id)
      toast.success('Review deleted')
    } catch (err) {
      toast.error(err.message || 'Could not delete the review')
    }
  }

  return (
    <AdminLayout>
      <div className="flex items-center gap-3 mb-2">
        <Star size={22} className="text-gold" />
        <h1 className="font-heading text-3xl font-bold text-white">Reviews</h1>
      </div>
      <p className="text-muted text-sm mb-6 max-w-2xl">
        Only customers with a delivered order can review a product, and nothing appears on the store
        until you publish it. Reject anything with health or medical claims, personal details or
        abuse.
      </p>

      <div className="flex gap-2 overflow-x-auto scrollbar-hide mb-6" role="group" aria-label="Filter reviews">
        {FILTERS.map(f => (
          <button
            key={f.key}
            type="button"
            aria-pressed={filter === f.key}
            onClick={() => setFilter(f.key)}
            className={`chip ${filter === f.key ? 'chip-active' : 'chip-idle'}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-surface border border-border rounded-xl overflow-hidden">
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="w-8 h-8 border-2 border-gold border-t-transparent rounded-full animate-spin" />
          </div>
        ) : isError ? (
          <div className="p-10 text-center">
            <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
            <p className="text-white text-sm mb-5">Couldn't load reviews. Please check your connection and try again.</p>
            <button onClick={() => refetch()} className="btn-gold text-sm">Retry</button>
          </div>
        ) : reviews.length === 0 ? (
          <div className="p-8 text-center text-muted text-sm">
            {filter === 'pending' ? 'Nothing waiting for approval.' : 'No reviews here yet.'}
          </div>
        ) : (
          reviews.map(r => (
            <div key={r.id} className="border-b border-border/50 last:border-0 px-4 sm:px-5 py-4">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2">
                <div className="min-w-0">
                  {r.products ? (
                    <Link to={`/store/${r.products.slug}`} target="_blank" rel="noreferrer"
                      className="text-white font-medium text-sm underline underline-offset-2 hover:text-gold transition-colors">
                      {r.products.name}
                    </Link>
                  ) : (
                    <span className="text-muted text-sm">Deleted product</span>
                  )}
                  <div className="flex flex-wrap items-center gap-2 mt-1">
                    <Stars value={r.rating} size={14} />
                    <span className="text-muted text-xs">by {r.display_name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_PILL[r.status]}`}>{FILTERS.find(f => f.key === r.status)?.label ?? r.status}</span>
                  </div>
                </div>
                <p className="text-muted text-xs flex-shrink-0">{formatDate(r.updated_at ?? r.created_at)}</p>
              </div>
              {r.body
                ? <p className="text-muted text-sm mt-2 whitespace-pre-wrap break-words">{r.body}</p>
                : <p className="text-muted text-xs mt-2 italic">Rating only, no text.</p>}
              <div className="flex flex-wrap gap-2 mt-3">
                {r.status !== 'approved' && (
                  <button type="button" onClick={() => setStatus(r.id, 'approved')} disabled={moderate.isPending}
                    className="focus-ring h-11 px-4 rounded-lg inline-flex items-center gap-1.5 text-sm border border-green-500/30 text-green-400 hover:bg-green-500/10 disabled:opacity-50 transition-colors">
                    <Check size={15} /> Publish
                  </button>
                )}
                {r.status !== 'rejected' && (
                  <button type="button" onClick={() => setStatus(r.id, 'rejected')} disabled={moderate.isPending}
                    className="focus-ring h-11 px-4 rounded-lg inline-flex items-center gap-1.5 text-sm border border-border text-muted hover:text-white disabled:opacity-50 transition-colors">
                    <X size={15} /> Reject
                  </button>
                )}
                <button type="button" onClick={() => handleDelete(r.id)} disabled={remove.isPending}
                  aria-label={`Delete review by ${r.display_name}`}
                  className="focus-ring h-11 w-11 rounded-lg inline-flex items-center justify-center text-muted hover:text-red-400 disabled:opacity-50 transition-colors">
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </AdminLayout>
  )
}
