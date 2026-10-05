import { useState } from 'react'
import { MessageSquare, AlertTriangle, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuth } from '../../context/useAuth'
import { useProductReviews, useMyReviewStatus, useSubmitReview } from '../../hooks/useProductReviews'
import { Stars, StarPicker } from './StarRating'

const dateFmt = new Intl.DateTimeFormat('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })

/**
 * Reviews section for the product page. Anyone sees approved reviews; a
 * signed-in customer whose order containing this product was DELIVERED gets
 * the form (the server enforces the same rule in submit_product_review).
 */
export default function ProductReviews({ productId }) {
  const { user } = useAuth()
  const { data, isLoading, isError, refetch } = useProductReviews(productId)
  const mine = useMyReviewStatus(productId)

  return (
    <section aria-labelledby="reviews-heading" className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-10 md:pt-0 md:mb-20">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-5 md:mb-8">
        <h2 id="reviews-heading" className="section-heading text-white">Reviews</h2>
        {data?.count > 0 && (
          <p className="flex items-center gap-2 text-sm text-muted">
            <Stars value={data.average} />
            <span><span className="text-white font-semibold">{data.average}</span> · {data.count} review{data.count === 1 ? '' : 's'}</span>
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 lg:gap-8">
        <div className="lg:col-span-2 space-y-3">
          {isLoading && [0, 1].map(i => (
            <div key={i} className="bg-surface border border-border rounded-xl p-4 space-y-2">
              <div className="h-4 w-24 skeleton rounded" />
              <div className="h-4 w-3/4 skeleton rounded" />
            </div>
          ))}

          {isError && (
            <div className="bg-surface border border-red-500/20 rounded-2xl p-6 text-center">
              <AlertTriangle size={28} className="text-red-400 mx-auto mb-3" />
              <p className="text-white text-sm mb-4">Reviews couldn't be loaded.</p>
              <button type="button" onClick={() => refetch()} className="btn-gold text-sm">Retry</button>
            </div>
          )}

          {data && data.count === 0 && (
            <div className="bg-surface border border-border rounded-2xl p-8 text-center">
              <MessageSquare size={28} className="text-muted mx-auto mb-3" />
              <p className="text-white text-sm mb-1">No reviews yet</p>
              <p className="text-muted text-xs">Customers who have received this product can leave the first one.</p>
            </div>
          )}

          {data?.reviews?.map((r, i) => (
            <article key={`${r.created_at}-${i}`} className="bg-surface border border-border rounded-xl p-4">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                <Stars value={r.rating} size={14} />
                <span className="text-muted text-xs">{dateFmt.format(new Date(r.created_at))}</span>
              </div>
              {r.body && <p className="text-white text-sm leading-relaxed whitespace-pre-line break-words">{r.body}</p>}
              <p className="text-muted text-xs mt-2">— {r.display_name}</p>
            </article>
          ))}
        </div>

        <div>
          {user && mine.data?.eligible && (
            <ReviewForm productId={productId} existing={mine.data.review} />
          )}
          {user && mine.data && !mine.data.eligible && (
            <p className="text-muted text-xs leading-relaxed">
              Reviews are from customers whose order for this product has been delivered.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function ReviewForm({ productId, existing }) {
  const [rating, setRating] = useState(existing?.rating ?? 0)
  const [body, setBody] = useState(existing?.body ?? '')
  const [displayName, setDisplayName] = useState(existing?.display_name ?? '')
  const [editing, setEditing] = useState(!existing)
  const submit = useSubmitReview(productId)

  if (existing && !editing) {
    return (
      <div className="bg-surface border border-border rounded-xl p-4 sm:p-6">
        <h3 className="text-white font-semibold text-sm uppercase tracking-widest mb-3">Your review</h3>
        <Stars value={existing.rating} size={14} />
        {existing.body && <p className="text-muted text-sm mt-2 whitespace-pre-line break-words">{existing.body}</p>}
        <p className="flex items-center gap-1.5 text-xs mt-3 text-muted">
          {existing.status === 'approved' && <span className="text-green-400">Published</span>}
          {existing.status === 'pending' && <><Clock size={12} /> Waiting for approval</>}
          {existing.status === 'rejected' && <span className="text-red-400">Not published</span>}
        </p>
        <button type="button" onClick={() => setEditing(true)} className="btn-outline text-xs uppercase tracking-widest px-4 py-2 mt-4">
          Edit review
        </button>
      </div>
    )
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (rating < 1) {
      toast.error('Please choose a star rating')
      return
    }
    try {
      await submit.mutateAsync({ rating, body, displayName })
      toast.success('Thanks! Your review will appear once it has been approved.')
      setEditing(false)
    } catch (err) {
      toast.error(err.message || 'Could not save your review')
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-surface border border-border rounded-xl p-4 sm:p-6 space-y-4">
      <h3 className="text-white font-semibold text-sm uppercase tracking-widest">
        {existing ? 'Edit your review' : 'Write a review'}
      </h3>
      <StarPicker value={rating} onChange={setRating} />
      <div>
        <label htmlFor="review-body" className="block text-muted text-xs uppercase tracking-widest mb-1.5">Your review</label>
        <textarea
          id="review-body"
          rows={4}
          maxLength={1000}
          value={body}
          onChange={e => setBody(e.target.value)}
          className="input-base text-sm"
          placeholder="Taste, quality, delivery…"
        />
        <p className="text-muted text-xs mt-1">
          Please don't include health or medical claims, or personal details. Reviews are checked before they appear.
        </p>
      </div>
      <div>
        <label htmlFor="review-name" className="block text-muted text-xs uppercase tracking-widest mb-1.5">Display name *</label>
        <input
          id="review-name"
          required
          maxLength={40}
          autoComplete="given-name"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          className="input-base text-sm"
          placeholder="e.g. Thabo M."
        />
      </div>
      <div className="flex gap-3">
        <button type="submit" disabled={submit.isPending} className="btn-outline flex-1 py-3 text-sm disabled:opacity-50">
          {submit.isPending ? 'Saving…' : 'Submit review'}
        </button>
        {existing && (
          <button type="button" onClick={() => setEditing(false)} className="btn-outline px-4 text-sm">Cancel</button>
        )}
      </div>
    </form>
  )
}
