export default function StatsCard({ title, value, icon: Icon, trend }) {
  return (
    <div className="bg-surface border border-border rounded-xl p-6">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-muted text-xs uppercase tracking-widest mb-2">{title}</p>
          <p className="text-white font-heading text-2xl font-bold">{value}</p>
          {trend && <p className="text-muted text-xs mt-1">{trend}</p>}
        </div>
        {Icon && (
          <div className="bg-gold/10 p-3 rounded-lg">
            <Icon size={20} className="text-gold" />
          </div>
        )}
      </div>
    </div>
  )
}
