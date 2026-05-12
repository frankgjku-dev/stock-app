const MA_LABELS = [
  { key: 'ma5',   label: 'MA5',   color: '#f5c842' },
  { key: 'ma10',  label: 'MA10',  color: '#42a5f5' },
  { key: 'ma20',  label: 'MA20',  color: '#ef5350' },
  { key: 'ma60',  label: 'MA60',  color: '#ab47bc' },
  { key: 'ma120', label: 'MA120', color: '#26a69a' },
  { key: 'ma240', label: 'MA240', color: '#ff7043' },
]

export default function IndicatorBar({ indicators, onToggle }) {
  return (
    <div className="indicator-bar">
      <span className="ind-label">均線</span>
      {MA_LABELS.map(({ key, label, color }) => (
        <span
          key={key}
          className={`ma-badge ${indicators[key] ? 'active' : ''}`}
          style={{ color }}
          onClick={() => onToggle(key)}
          title={indicators[key] ? `隱藏 ${label}` : `顯示 ${label}`}
        >
          {label}
        </span>
      ))}
    </div>
  )
}
