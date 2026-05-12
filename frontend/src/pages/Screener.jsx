import { useState, useEffect, useRef } from 'react'
import { API_BASE } from '../config'

const CONDITIONS = ['c1','c2','c3','c4','c5','c6','c7','c8']
const COND_LABEL = {
  c1: '股價>MA150', c2: '股價>MA200', c3: 'MA150>MA200',
  c4: 'MA200向上',  c5: 'MA50>MA150,200', c6: '股價>MA50',
  c7: '距低點+30%', c8: '距高點75%內',
}

function rsColor(rs) {
  if (rs >= 90) return '#4caf50'
  if (rs >= 80) return '#8bc34a'
  if (rs >= 70) return '#ffeb3b'
  if (rs >= 50) return '#ff9800'
  return '#ef5350'
}

function passedColor(n) {
  if (n === 8) return '#4caf50'
  if (n >= 6)  return '#ffeb3b'
  return '#787b86'
}

export default function Screener({ onSelectStock }) {
  const [status,    setStatus]    = useState(null)   // null | 'idle' | 'running' | 'done'
  const [results,   setResults]   = useState([])
  const [progress,  setProgress]  = useState(0)
  const [total,     setTotal]     = useState(0)
  const [minRS,     setMinRS]     = useState(70)
  const [minPassed, setMinPassed] = useState(6)
  const [sortKey,   setSortKey]   = useState('rs_rating')
  const [sortAsc,   setSortAsc]   = useState(false)
  const [market,    setMarket]    = useState(null)
  const [detail,    setDetail]    = useState(null)   // expanded row
  const pollRef = useRef(null)

  // 載入大盤狀態
  useEffect(() => {
    fetch(`${API_BASE}/api/market/status`)
      .then(r => r.json())
      .then(d => !d.error && setMarket(d))
      .catch(() => {})
  }, [])

  // 輪詢掃描進度
  function startPoll() {
    clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const r = await fetch(`${API_BASE}/api/screener/status`)
      const d = await r.json()
      setStatus(d.status)
      setProgress(d.progress)
      setTotal(d.total)
      if (d.status === 'done' || d.status === 'error') {
        clearInterval(pollRef.current)
        setResults(d.results || [])
      }
    }, 1500)
  }

  useEffect(() => () => clearInterval(pollRef.current), [])

  async function handleScan() {
    setResults([])
    setDetail(null)
    const r = await fetch(`${API_BASE}/api/screener/start`, { method: 'POST' })
    const d = await r.json()
    setStatus('running')
    startPoll()
  }

  function handleSort(key) {
    if (sortKey === key) setSortAsc(p => !p)
    else { setSortKey(key); setSortAsc(false) }
  }

  const filtered = results
    .filter(r => r.rs_rating >= minRS && r.passed >= minPassed)
    .sort((a, b) => {
      const va = a[sortKey] ?? 0, vb = b[sortKey] ?? 0
      return sortAsc ? va - vb : vb - va
    })

  function SortTh({ k, label }) {
    const active = sortKey === k
    return (
      <th className="sortable" onClick={() => handleSort(k)}>
        {label} {active ? (sortAsc ? '↑' : '↓') : ''}
      </th>
    )
  }

  return (
    <div className="screener-page">

      {/* ── 大盤看板 ── */}
      <div className="market-board">
        <span className="board-title">大盤狀態（加權指數）</span>
        {market ? (
          <>
            <span className={`board-val ${market.above_ma50 ? 'up' : 'down'}`}>
              {market.index?.toLocaleString()}
            </span>
            <span className="board-item">MA50 {market.ma50?.toLocaleString()}</span>
            <span className="board-item">MA200 {market.ma200?.toLocaleString()}</span>
            <span className="board-item">散佈日 {market.distribution_days}</span>
            <span className={`board-badge ${
              market.trend === '多頭' ? 'badge-green' :
              market.trend === '空頭' ? 'badge-red' : 'badge-yellow'
            }`}>{market.trend}</span>
            <span className="board-item" style={{ color: '#b2b5be' }}>
              建議倉位：<strong style={{ color: '#e0e3eb' }}>{market.suggestion}</strong>
            </span>
          </>
        ) : (
          <span className="board-item" style={{ color: '#787b86' }}>載入中…</span>
        )}
      </div>

      {/* ── 控制列 ── */}
      <div className="screener-controls">
        <button
          className={`scan-btn ${status === 'running' ? 'scanning' : ''}`}
          onClick={handleScan}
          disabled={status === 'running'}
        >
          {status === 'running'
            ? `掃描中… ${progress}/${total}`
            : status === 'done'
            ? '重新掃描'
            : '開始掃描'}
        </button>

        {status === 'running' && (
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{ width: total ? `${progress / total * 100}%` : '0%' }}
            />
          </div>
        )}

        <label className="filter-label">
          RS &ge;
          <select value={minRS} onChange={e => setMinRS(+e.target.value)}>
            {[50, 60, 70, 80, 90].map(v => <option key={v}>{v}</option>)}
          </select>
        </label>
        <label className="filter-label">
          條件 &ge;
          <select value={minPassed} onChange={e => setMinPassed(+e.target.value)}>
            {[4,5,6,7,8].map(v => <option key={v}>{v}</option>)}
          </select>
        </label>
        {status === 'done' && (
          <span className="result-count">符合：{filtered.length} 檔</span>
        )}
      </div>

      {/* ── 說明 ── */}
      {!status && (
        <div className="screener-hint">
          點擊「開始掃描」，系統將依 Mark Minervini SEPA Trend Template
          對台股約 {Object.keys([]).length || 60} 檔股票進行篩選（約需 1–2 分鐘）。
        </div>
      )}

      {/* ── 結果表格 ── */}
      {results.length > 0 && (
        <div className="table-wrap">
          <table className="screener-table">
            <thead>
              <tr>
                <th>代碼</th>
                <th>名稱</th>
                <SortTh k="close"     label="收盤" />
                <SortTh k="rs_rating" label="RS評分" />
                <SortTh k="passed"    label="條件" />
                <SortTh k="from_high" label="距高點%" />
                <SortTh k="from_low"  label="距低點%" />
                <th>詳情</th>
                <th>看圖</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => (
                <>
                  <tr key={row.symbol} className="data-row">
                    <td className="sym">{row.symbol}</td>
                    <td>{row.name}</td>
                    <td>{row.close}</td>
                    <td>
                      <span className="rs-badge" style={{ background: rsColor(row.rs_rating) }}>
                        {row.rs_rating}
                      </span>
                    </td>
                    <td>
                      <span className="pass-badge" style={{ color: passedColor(row.passed) }}>
                        {row.passed}/8
                      </span>
                    </td>
                    <td className={row.from_high >= -10 ? 'up' : ''}>{row.from_high}%</td>
                    <td className="up">{row.from_low > 30 ? `+${row.from_low}` : row.from_low}%</td>
                    <td>
                      <button
                        className="detail-btn"
                        onClick={() => setDetail(detail === row.symbol ? null : row.symbol)}
                      >
                        {detail === row.symbol ? '收起' : '展開'}
                      </button>
                    </td>
                    <td>
                      <button className="chart-link-btn" onClick={() => onSelectStock(row.symbol)}>
                        看圖 →
                      </button>
                    </td>
                  </tr>
                  {detail === row.symbol && (
                    <tr key={`${row.symbol}-detail`} className="detail-row">
                      <td colSpan={9}>
                        <div className="detail-grid">
                          {CONDITIONS.map(k => (
                            <div key={k} className={`cond-item ${row.conditions[k] ? 'pass' : 'fail'}`}>
                              <span className="cond-icon">{row.conditions[k] ? '✓' : '✗'}</span>
                              {COND_LABEL[k]}
                            </div>
                          ))}
                          <div className="cond-item info">MA50: {row.ma50}</div>
                          <div className="cond-item info">MA150: {row.ma150}</div>
                          <div className="cond-item info">MA200: {row.ma200}</div>
                          <div className="cond-item info">52w高: {row.high52}</div>
                          <div className="cond-item info">52w低: {row.low52}</div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
