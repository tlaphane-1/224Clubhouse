const categories = [
  { value: 'all', label: 'All' },
  { value: 'flower', label: 'Flower' },
  { value: 'edibles', label: 'Edibles' },
  { value: 'accessories', label: 'Accessories' },
  { value: 'merchandise', label: 'Merchandise' },
]

export default function CategoryFilter({ active = 'all', onChange }) {
  return (
    <div className="flex gap-1 overflow-x-auto pb-2 scrollbar-hide">
      {categories.map(({ value, label }) => {
        const isActive = active === value
        return (
          <button
            key={value}
            onClick={() => onChange(value)}
            className={`flex-shrink-0 px-5 py-2.5 text-sm font-medium uppercase tracking-widest
                        border-b-2 transition-all duration-200 whitespace-nowrap
                        ${isActive
                          ? 'border-gold text-white'
                          : 'border-transparent text-muted hover:text-white hover:border-border'
                        }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
