import { useState, useEffect, useRef } from 'react'
import { API_BASE } from '../config'

const REC_STYLES = {
  success: { bg: '#26a69a22', color: '#26a69a', border: '#26a69a55' },
  warning: { bg: '#e0a80022', color: '#e0a800', border: '#e0a80055' },
  info:    { bg: '#4a7a8a22', color: '#4a7a8a', border: '#4a7a8a55' },
  neutral: { bg: 'var(--surface-2)', color: 'var(--text-2)', border: 'var(--border)' },
  danger:  { bg: '#c85a5022', color: '#c85a50', border: '#c85a5055' },
}

function ScoreBar({ score, total = 8 }) {
  return (
    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
      {Array.from({ length: total }).map((_, i) => (
        <div key={i} style={{
          width: 20, height: 8, borderRadius: 3,
          background: i < score ? 'var(--accent)' : 'var(--surface-2)',
          border: '1px solid var(--border)',
        }} />
      ))}
      <span style={{ fontSize: 12, color: 'var(--text-2)', marginLeft: 4 }}>{score}/{total}</span>
    </div>
  )
}

export default function StockAnalysis({ currentSymbol, onSelectStock }) {
  const [sym,        setSym]        = useState(currentSymbol || '')
  const [data,       setData]       = useState(null)
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState(null)

  // ── Autocomplete state ──
  const [stockList,  setStockList]  = useState({})   // { symbol: name }
  const [suggestions, setSuggestions] = useState([]) // filtered list
  const [showDrop,   setShowDrop]   = useState(false)
  const dropRef = useRef(null)

  // Load stock list once
  useEffect(() => {
    fetch(`${API_BASE}/api/stocks/list`)
      .then(r => r.json())
      .then(d => {
        // backend returns [{symbol, name}] array
        if (Array.isArray(d)) {
          const map = {}
          d.forEach(item => { map[item.symbol] = item.name })
          setStockList(map)
        } else {
          setStockList(d)
        }
      })
      .catch(() => {})
  }, [])

  // Close dropdown on outside click
  useEffect(() => {
    function handler(e) {
      if (dropRef.current && !dropRef.current.contains(e.target)) {
        setShowDrop(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function handleInput(val) {
    setSym(val)
    if (val.trim().length === 0) {
      setSuggestions([])
      setShowDrop(false)
      return
    }
    const q = val.trim().toLowerCase()
    const filtered = Object.entries(stockList)
      .filter(([sym, name]) =>
        sym.toLowerCase().startsWith(q) ||
        (name && name.toLowerCase().includes(q))
      )
      .slice(0, 8)
    setSuggestions(filtered)
    setShowDrop(filtered.length > 0)
  }

  function selectSuggestion(symbol) {
    setSym(symbol)
    setShowDrop(false)
    setSuggestions([])
  }

  async function analyze(overrideSym) {
    const s = (overrideSym || sym).trim()
    if (!s) return
    setLoading(true); setError(null); setData(null)
    setShowDrop(false)
    try {
      const res  = await fetch(`${API_BASE}/api/stocks/${s}/analyze`)
      const json = await res.json()
      if (json.error) { setError(json.error); return }
      setData(json)
    } catch (e) {
      setError('無法取得分析資料，請稍後再試')
    } finally {
      setLoading(false)
    }
  }

  const rs = data ? REC_STYLES[data.rec_color] || REC_STYLES.neutral : null

  return (
    <div className="analysis-page">
      {/* ── 搜尋列 ── */}
      <div className="analysis-search-bar">
        <div className="analysis-title">🔍 個股智能分析</div>
        <div className="analysis-search-row" ref={dropRef} style={{ position: 'relative' }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              className="analysis-input"
              placeholder="輸入股票代碼或名稱，如 2330 / 台積電"
              value={sym}
              onChange={e => handleInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') { analyze(); setShowDrop(false) }
                if (e.key === 'Escape') setShowDrop(false)
              }}
              onFocus={() => suggestions.length > 0 && setShowDrop(true)}
              autoComplete="off"
            />
            {/* 股票名稱提示 */}
            {sym && stockList[sym.trim()] && (
              <span style={{
                position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                fontSize: 12, color: 'var(--text-3)', pointerEvents: 'none',
              }}>
                {stockList[sym.trim()]}
              </span>
            )}
            {/* Dropdown */}
            {showDrop && (
              <div className="analysis-dropdown">
                {suggestions.map(([s, name]) => (
                  <div
                    key={s}
                    className="analysis-dropdown-item"
                    onMouseDown={() => selectSuggestion(s)}
                  >
                    <span className="adrop-sym">{s}</span>
                    <span className="adrop-name">{name}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button
            className="analysis-btn"
            onClick={() => analyze()}
            disabled={loading || !sym.trim()}
          >
            {loading ? '分析中…' : '開始分析'}
          </button>
        </div>
        <div className="analysis-desc">
          基於 Minervini SEPA 準則自動評估趨勢、VCP型態、相對強度，產生進場建議
        </div>
      </div>

      {/* ── Loading ── */}
      {loading && (
        <div className="analysis-loading">
          <div className="analysis-spinner">⏳</div>
          <div>正在抓取資料並分析，約需 5–10 秒…</div>
        </div>
      )}

      {/* ── Error ── */}
      {error && !loading && (
        <div className="analysis-error">⚠️ {error}</div>
      )}

      {/* ── Report ── */}
      {data && !loading && (
        <div className="analysis-report">

          {/* 股票標題 */}
          <div className="ar-hero">
            <div>
              <div className="ar-name">{data.name} <span className="ar-sym">{data.symbol}</span></div>
              <div className="ar-price">現價 ${data.price}</div>
            </div>
            <button className="ar-chart-btn" onClick={() => onSelectStock(data.symbol)}>
              📈 看K線
            </button>
          </div>

          {/* 綜合建議 */}
          <div className="ar-rec" style={{
            background: rs.bg, border: `1px solid ${rs.border}`, borderRadius: 10, padding: '14px 18px',
          }}>
            <div className="ar-rec-label" style={{ color: rs.color }}>
              🎯 綜合建議：{data.recommendation}
            </div>
            <div className="ar-rec-detail">{data.rec_detail}</div>
          </div>

          {/* 兩欄：趨勢 + 關鍵價位 */}
          <div className="ar-grid">

            {/* 趨勢模板 */}
            <div className="ar-card">
              <div className="ar-card-title">📊 趨勢模板評分</div>
              <ScoreBar score={data.trend_score} />
              <div className="ar-conds">
                {data.trend_conditions.map((c, i) => (
                  <div key={i} className={`ar-cond ${c.pass ? 'pass' : 'fail'}`}>
                    <span className="ar-cond-icon">{c.pass ? '✅' : '❌'}</span>
                    <span className="ar-cond-label">{c.label}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* 關鍵價位 */}
            <div className="ar-card">
              <div className="ar-card-title">📍 關鍵價位</div>
              <div className="ar-levels">
                {[
                  { label: 'MA20',   val: data.ma20,   cls: '' },
                  { label: 'MA50',   val: data.ma50,   cls: '' },
                  { label: 'MA150',  val: data.ma150,  cls: '' },
                  { label: 'MA200',  val: data.ma200,  cls: '' },
                  { label: '52週高', val: data.h52,    cls: 'up' },
                  { label: '52週低', val: data.l52,    cls: 'down' },
                  data.pivot_price ? { label: '樞紐價', val: data.pivot_price, cls: 'accent' } : null,
                ].filter(Boolean).map(row => (
                  <div key={row.label} className="ar-level-row">
                    <span className="ar-level-label">{row.label}</span>
                    <span className={`ar-level-val ${row.cls}`}>{row.val ? `$${row.val}` : '--'}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* VCP 型態 */}
            <div className="ar-card">
              <div className="ar-card-title">
                🔁 VCP 型態
                <span className="ar-vcp-badge">{data.vcp_count} 段收縮</span>
              </div>
              {data.vcp_pullbacks.length === 0 ? (
                <div className="ar-empty">未偵測到明顯 VCP 型態</div>
              ) : (
                <div className="ar-vcps">
                  {data.vcp_pullbacks.map((p, i) => (
                    <div key={i} className="ar-vcp-row">
                      <span className="ar-vcp-idx">第 {i+1} 段</span>
                      <span>高點 ${p.peak}</span>
                      <span className="down">↓ {p.depth_pct}%</span>
                      <span>低點 ${p.trough}</span>
                    </div>
                  ))}
                  {data.pivot_price && (
                    <div className="ar-pivot-line">
                      📌 樞紐價：<strong>${data.pivot_price}</strong>
                      {data.dist_to_pivot !== null && (
                        <span className={data.dist_to_pivot <= 3 ? 'up' : 'flat'}>
                          　距離 {data.dist_to_pivot > 0 ? '+' : ''}{data.dist_to_pivot}%
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 風險報酬 */}
            <div className="ar-card">
              <div className="ar-card-title">⚖️ 風險報酬</div>
              <div className="ar-levels">
                <div className="ar-level-row">
                  <span className="ar-level-label">建議停損</span>
                  <span className="ar-level-val down">${data.stop_loss} (-{data.risk_pct}%)</span>
                </div>
                <div className="ar-level-row">
                  <span className="ar-level-label">20% 目標</span>
                  <span className="ar-level-val up">${data.target_price}</span>
                </div>
                <div className="ar-level-row">
                  <span className="ar-level-label">損益比</span>
                  <span className={`ar-level-val ${data.rr_ratio >= 2 ? 'up' : data.rr_ratio >= 1 ? 'flat' : 'down'}`}>
                    1 : {data.rr_ratio}
                  </span>
                </div>
                <div className="ar-level-row">
                  <span className="ar-level-label">RS 分數</span>
                  <span className={`ar-level-val ${data.rs_score > 0 ? 'up' : data.rs_score < 0 ? 'down' : 'flat'}`}>
                    {data.rs_score !== null ? (data.rs_score > 0 ? '+' : '') + data.rs_score : '計算中'}
                  </span>
                </div>
                <div className="ar-level-row">
                  <span className="ar-level-label">今日量比</span>
                  <span className={`ar-level-val ${data.vol_ratio >= 1.5 ? 'up' : 'flat'}`}>
                    {data.vol_ratio}x
                  </span>
                </div>
              </div>
            </div>

          </div>

          <div className="ar-disclaimer">
            ⚠️ 以上分析基於技術面規則（Minervini SEPA），僅供參考，不構成投資建議。投資有風險，請自行評估。
          </div>
        </div>
      )}
    </div>
  )
}
