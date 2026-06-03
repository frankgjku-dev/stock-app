const MA_LABELS = [
  { key: 'ma5',   label: 'MA5',   color: '#b86e2a' },
  { key: 'ma10',  label: 'MA10',  color: '#5a8ec8' },
  { key: 'ma20',  label: 'MA20',  color: '#c85a50' },
  { key: 'ma60',  label: 'MA60',  color: '#9068b8' },
  { key: 'ma120', label: 'MA120', color: '#4a9468' },
  { key: 'ma240', label: 'MA240', color: '#c89050' },
]

const EXTRA_LABELS = [
  { key: 'bb',    label: 'BB',    color: '#5a8ec8', title: '布林通道 (20,2)' },
  { key: 'volMA', label: '量MA',  color: '#c89050', title: '成交量 MA5' },
  { key: 'rsi',   label: 'RSI',   color: '#9068b8', title: 'RSI (14)' },
  { key: 'macd',  label: 'MACD',  color: '#4a9468', title: 'MACD (12,26,9)' },
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

      <span className="ind-sep" />

      <span className="ind-label">指標</span>
      {EXTRA_LABELS.map(({ key, label, color, title }) => (
        <span
          key={key}
          className={`ma-badge ${indicators[key] ? 'active' : ''}`}
          style={{ color }}
          onClick={() => onToggle(key)}
          title={indicators[key] ? `隱藏 ${title}` : `顯示 ${title}`}
        >
          {label}
        </span>
      ))}
    </div>
  )
}
