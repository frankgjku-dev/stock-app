import { useState, useCallback, useRef, useEffect } from 'react'
import { API_BASE, APP_VERSION } from '../config'

const INTERVALS = [
  { label: '1分',  interval: '1m',  period: '7d'  },
  { label: '5分',  interval: '5m',  period: '60d' },
  { label: '15分', interval: '15m', period: '60d' },
  { label: '60分', interval: '60m', period: '60d' },
  { label: '日',   interval: '1d',  period: '1y'  },
  { label: '週',   interval: '1wk', period: '5y'  },
  { label: '月',   interval: '1mo', period: 'max' },
]

const DAY_PERIODS = ['1y', '2y', '3y', '5y']

export default function TopBar({
  symbol, quote, interval, period,
  onSymbolChange, onIntervalChange,
  watchlist, onToggleInGroup, onAddGroup,
  isMobile = false,
}) {
  const [query,      setQuery]      = useState('')
  const [results,    setResults]    = useState([])
  const [open,       setOpen]       = useState(false)
  const [favOpen,    setFavOpen]    = useState(false)
  const [newGroup,   setNewGroup]   = useState('')
  const [adding,     setAdding]     = useState(false)
  const [stockPool,  setStockPool]  = useState([])   // 本地股票清單
  const timerRef = useRef(null)

  // 只在初次掛載時拉一次完整清單，之後搜尋全在前端完成
  useEffect(() => {
    fetch(`${API_BASE}/api/stocks/list`)
      .then(r => r.json())
      .then(data => setStockPool(data))
      .catch(() => {})
  }, [])

  function handleChange(e) {
    const q = e.target.value
    setQuery(q)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const trimmed = q.trim().toLowerCase()
      if (!trimmed) { setResults([]); setOpen(false); return }
      const hits = stockPool.filter(
        s => s.symbol.includes(trimmed) || s.name.toLowerCase().includes(trimmed)
      ).slice(0, 20)
      setResults(hits)
      setOpen(hits.length > 0)
    }, 80)   // 80ms 足夠防抖，本地過濾不需要 200ms
  }

  function pick(s) { onSymbolChange(s.symbol); setQuery(''); setOpen(false) }

  const change    = quote?.change     ?? 0
  const changePct = quote?.change_pct ?? 0
  const cls       = change > 0 ? 'up' : change < 0 ? 'down' : 'flat'

  const isFav = watchlist?.groups?.some(g => g.stocks.includes(symbol)) ?? false

  function submitNewGroup() {
    const n = newGroup.trim()
    if (n) { onAddGroup(n); setNewGroup(''); setAdding(false) }
  }

  /* ── 自選股 popup 內容（電腦/手機共用） ── */
  const favPopupContent = (
    <>
      <div className="fav-popup-title">加入自選股分類</div>
      {watchlist?.groups?.length === 0 && (
        <div className="fav-popup-hint">尚無分類，請先新增</div>
      )}
      {watchlist?.groups?.map(g => {
        const has = g.stocks.includes(symbol)
        return (
          <label key={g.id} className="fav-popup-row">
            <input type="checkbox" checked={has} onChange={() => onToggleInGroup(symbol, g.id)} />
            <span>{g.name}</span>
            {has && <span className="fav-check">✓</span>}
          </label>
        )
      })}
      <div className="fav-popup-sep" />
      {adding ? (
        <div className="fav-popup-add">
          <input
            className="wl-input" value={newGroup} onChange={e => setNewGroup(e.target.value)}
            placeholder="新分類名稱…" autoFocus
            onKeyDown={e => { if (e.key === 'Enter') submitNewGroup(); if (e.key === 'Escape') setAdding(false) }}
          />
          <button className="wl-ok" onClick={submitNewGroup}>✓</button>
        </div>
      ) : (
        <button className="fav-new-group" onClick={() => setAdding(true)}>＋ 新增分類</button>
      )}
    </>
  )

  /* ── 時間軸按鈕列（電腦/手機共用） ── */
  const intervalButtons = (
    <div className={isMobile ? 'interval-selector interval-selector-mobile' : 'interval-selector'}>
      {INTERVALS.map(({ label, interval: iv, period: defaultPeriod }) => (
        <button
          key={label}
          className={`interval-btn ${interval === iv ? 'active' : ''}`}
          onClick={() => onIntervalChange(iv, defaultPeriod)}
        >
          {label}
        </button>
      ))}
      {interval === '1d' && (
        <>
          <span style={{ color: 'var(--text-3)', margin: '0 4px', fontSize: 12 }}>|</span>
          {DAY_PERIODS.map(p => (
            <button
              key={p}
              className={`interval-btn ${interval === '1d' && period === p ? 'active' : ''}`}
              onClick={() => onIntervalChange('1d', p)}
            >
              {p}
            </button>
          ))}
        </>
      )}
    </div>
  )

  /* ══════════════════ 手機版 TopBar ══════════════════ */
  if (isMobile) {
    return (
      <div className="topbar topbar-mobile">
        {/* 第一排：搜尋 + ★ */}
        <div className="topbar-mobile-row1">
          <div className="search-wrapper" style={{ flex: 1 }}>
            <input
              className="search-input search-input-mobile"
              placeholder="搜尋股票代碼 / 名稱"
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
          {/* ★ 加入自選股 */}
          <div style={{ position: 'relative' }}>
            <button
              className={`fav-star-btn fav-star-btn-mobile ${isFav ? 'active' : ''}`}
              onClick={() => { setFavOpen(p => !p); setAdding(false) }}
              title="加入 / 管理自選股"
            >
              {isFav ? '★' : '☆'}
            </button>
            {favOpen && (
              <div className="fav-popup fav-popup-mobile" onMouseLeave={() => { setFavOpen(false); setAdding(false) }}>
                {favPopupContent}
              </div>
            )}
          </div>
        </div>

        {/* 第二排：報價 */}
        {quote && (
          <div className="topbar-mobile-row2">
            <span className="quote-symbol-mobile">{symbol}</span>
            <span className="quote-name-mobile">{quote.name || ''}</span>
            <span className={`quote-price-mobile ${cls}`}>{quote.price?.toFixed(2) ?? '--'}</span>
            <span className={`quote-change-mobile ${cls}`}>
              {change >= 0 ? '+' : ''}{change.toFixed(2)} ({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
            </span>
          </div>
        )}

        {/* 第三排：時間軸 */}
        {intervalButtons}
      </div>
    )
  }

  /* ══════════════════ 電腦版 TopBar（原版不動）══════════════════ */
  return (
    <div className="topbar">
      <div className="logo">
        台股分析
        <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-3)', marginLeft: 6, letterSpacing: 0 }}>
          {APP_VERSION}
        </span>
      </div>

      {/* Search */}
      <div className="search-wrapper">
        <input
          className="search-input"
          placeholder="搜尋股票代碼 / 名稱"
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
        <div className="quote-block" style={{ position:'relative' }}>
          <span className="quote-name">
            <span style={{ fontSize: 12, color: 'var(--text-3)', marginRight: 5 }}>{symbol}</span>
            {quote.name || ''}
          </span>
          <span className={`quote-price ${cls}`}>{quote.price?.toFixed(2) ?? '--'}</span>
          <span className={`quote-change ${cls}`}>
            {change >= 0 ? '+' : ''}{change.toFixed(2)}
            &nbsp;({changePct >= 0 ? '+' : ''}{changePct.toFixed(2)}%)
          </span>

          {/* ★ 加入自選股 */}
          <button
            className={`fav-star-btn ${isFav ? 'active' : ''}`}
            onClick={() => { setFavOpen(p => !p); setAdding(false) }}
            title="加入 / 管理自選股"
          >
            {isFav ? '★' : '☆'}
          </button>

          {favOpen && (
            <div className="fav-popup" onMouseLeave={() => { setFavOpen(false); setAdding(false) }}>
              {favPopupContent}
            </div>
          )}
        </div>
      )}

      {intervalButtons}
    </div>
  )
}
