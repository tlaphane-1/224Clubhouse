// A box on the paper form that gets a hand-drawn tick when chosen. It is a
// real checkbox/radio input (sr-only) so keyboards and screen readers work.
export default function PaperCheckbox({
  id, checked, onChange, type = 'checkbox', name, invalid = false, children,
}) {
  return (
    <label htmlFor={id} className="relative flex items-start gap-3 py-1.5 cursor-pointer">
      <input
        id={id}
        type={type}
        name={name}
        checked={checked}
        onChange={e => onChange(e.target.checked)}
        aria-invalid={invalid || undefined}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={`relative flex-shrink-0 w-6 h-6 mt-0.5 border-2 bg-paper
                    peer-focus-visible:ring-2 peer-focus-visible:ring-ink peer-focus-visible:ring-offset-2
                    peer-focus-visible:ring-offset-paper ${invalid ? 'border-red-600' : 'border-print'}`}
      >
        {checked && (
          <svg viewBox="0 0 24 24" className="absolute -left-1 -top-2 w-8 h-8 text-ink overflow-visible">
            <path
              d="M3 13 C 6 15, 8 18, 10 21 C 13 13, 17 7, 23 1"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </span>
      <span className="text-print text-sm sm:text-base leading-snug">{children}</span>
    </label>
  )
}
