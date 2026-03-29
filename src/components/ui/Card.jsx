export default function Card({ children, className = '', hover = false }) {
  return (
    <div
      className={`bg-surface border border-border rounded-xl ${
        hover ? 'card-hover cursor-pointer' : ''
      } ${className}`}
    >
      {children}
    </div>
  )
}
