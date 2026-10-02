import { useEffect, useRef } from 'react'
import { ALL_CATEGORY, CATEGORIES } from './categories'

const chips = [ALL_CATEGORY, ...CATEGORIES]

export default function CategoryFilter({ active = 'all', onChange }) {
  const rowRef = useRef(null)

  // Arriving from a home-page tile (e.g. /store?category=merchandise) can leave
  // the active chip off-screen on a phone. Scroll the row — horizontally only,
  // so the page itself never jumps. Waits for web fonts, because chip widths
  // change when Inter loads on a cold visit.
  useEffect(() => {
    let cancelled = false
    const centreActiveChip = () => {
      const row = rowRef.current
      const chip = row?.querySelector('[aria-pressed="true"]')
      if (cancelled || !row || !chip) return
      const target = chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2
      const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
      row.scrollTo({ left: Math.max(0, target), behavior: reduceMotion ? 'auto' : 'smooth' })
    }
    if (document.fonts?.ready) document.fonts.ready.then(centreActiveChip)
    else centreActiveChip()
    return () => { cancelled = true }
  }, [active])

  return (
    <div
      ref={rowRef}
      role="group"
      aria-label="Filter by category"
      className="flex gap-2 overflow-x-auto scrollbar-hide snap-x scroll-px-4 px-4 sm:px-6 lg:px-8 py-3"
    >
      {chips.map(({ value, label, icon: Icon }) => {
        const isActive = active === value
        return (
          <button
            key={value}
            type="button"
            aria-pressed={isActive}
            onClick={() => onChange(value)}
            className={`chip snap-start ${isActive ? 'chip-active' : 'chip-idle'}`}
          >
            <Icon size={16} className={isActive ? 'text-black' : 'text-gold'} />
            {label}
          </button>
        )
      })}
    </div>
  )
}
