import { Star } from 'lucide-react'

/** Read-only stars. The label carries the value for screen readers. */
export function Stars({ value, size = 16, className = '' }) {
  const rounded = Math.round(Number(value) || 0)
  return (
    <span className={`inline-flex items-center gap-0.5 ${className}`} role="img" aria-label={`${value} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map(n => (
        <Star
          key={n}
          size={size}
          aria-hidden="true"
          className={n <= rounded ? 'text-gold fill-gold' : 'text-border fill-border'}
        />
      ))}
    </span>
  )
}

/**
 * 1–5 picker built from real radio inputs (keyboard: arrow keys), each a
 * 44px tap target.
 */
export function StarPicker({ value, onChange, name = 'rating' }) {
  return (
    <fieldset>
      <legend className="block text-muted text-xs uppercase tracking-widest mb-1.5">Your rating *</legend>
      <div className="flex">
        {[1, 2, 3, 4, 5].map(n => (
          <label
            key={n}
            className="w-11 h-11 flex items-center justify-center rounded-lg cursor-pointer
                       has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-gold"
          >
            <input
              type="radio"
              name={name}
              value={n}
              checked={value === n}
              onChange={() => onChange(n)}
              className="sr-only"
              aria-label={`${n} star${n === 1 ? '' : 's'}`}
            />
            <Star
              size={26}
              aria-hidden="true"
              className={`transition-colors ${n <= value ? 'text-gold fill-gold' : 'text-muted'}`}
            />
          </label>
        ))}
      </div>
    </fieldset>
  )
}
