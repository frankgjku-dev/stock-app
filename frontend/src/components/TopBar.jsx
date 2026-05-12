import { useState, useCallback, useRef } from 'react'
import { API_BASE } from '../config'

const INTERVALS = [
  { label: '1分', interval: '1m',  period: '7d'  },
  { label: '5分', interval: '5m',  period: '60d' },
  { label: '15分', interval: '15m', period: '60d' },
  { label: '60分', interval: '60m', period: '60d' },
  { label: '日',   interval: '1d',  period: '1y'  },
  { label: '週',   interval: '1wk', period: '5y'  },
  { label: '月',   interval: '1mo', period: 'max' },
]

export default function TopBar({ symbol, quote, interval, onSymbolChange, onIntervalChange }) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState([])
  const [open, setOpen] = useState(false)
  const timerRef = useRef(null)

  const search = useCallback(async (q) => {
    if (!q.trim()) { setResults([]); setOpen(false); return }
    const r = await fetch(`${API_BASE}/api/stocks/search?q=${encodeURIComponent(q)}`)
    const data = await r.json()
    setResults(data)
    setOpen(data.length > 0)
  }, [])

  function handleChange(e) {
    const q = e.target.value
    setQuery(q)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => search(q), 200)
  }

  function pick(s) {
    onSymbolChange(s.symbol)
    setQuery('')
    setOpen(false)
  }

  const change = quote?.change ?? 0
  const changePct = quote?.change_pct ?? 0
  const colorClass = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'

  return (
    <div className="topbar">
      <div className="logo">台股分析</div>

      {/* Search */}
      <div className="search-wrapper">
        <input
          className="search-input"
          placeholder="輸入股票代碼 / 名稱"
          value={query}
          onChange={handleChange}
          onFocus={() => query && setOpen(results.length > 0)}
          onBlur={() => setTimeout(() => setOpen(false), 180)}
        />
        {open && (
          <div className="search-dropdown">
            {results.map(r => (
              <div key={r.symbol} className="search-item" onMouseDown={() => pick(r)}>
                <span className="search-symbol">{r.symbol}</span>
                <span className="search-name">{r.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quote */}
      {quote && (
        <div className="quote-block">
          <span className="quote-name">{quote.name || symbol}</span>
          <span className={`quote-price ${colorClass}`}>
            {quote.price?.toFixed(2) ?? '--'}
          </span>
          <span className={`quote-change ${colorClass}`}>
            {change >= 0 ? '+' : ''}{change.toFixed(2)}
            &nbsp;({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
          </span>
        </div>
      )}

      {/* Interval */}
      <div className="interval-selector">
        {INTERVALS.map(({ label, interval: iv, period }) => (
          <button
            key={label}
            className={`interval-btn ${interval === iv ? 'active' : ''}`}
            onClick={() => onIntervalChange(iv, period)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  )
}
