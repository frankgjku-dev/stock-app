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
function vcpColor(score) {
  if (score >= 4) return { bg: '#1b5e20', color: '#69f0ae', text: 'VCP強' }
  if (score >= 3) return { bg: '#33691e', color: '#ccff90', text: 'VCP中' }
  if (score >= 2) return { bg: '#1a237e', color: '#82b1ff', text: 'VCP弱' }
  return null
}

export default function Screener({ onSelectStock }) {
  const [status,    setStatus]    = useState(null)
  const [results,   setResults]   = useState([])
  const [progress,  setProgress]  = useState(0)
  const [total,     setTotal]     = useState(0)
  const [minRS,     setMinRS]     = useState(70)
  const [minPassed, setMinPassed] = useState(6)
  const [vcpOnly,   setVcpOnly]   = useState(false)
  const [minVcp,    setMinVcp]    = useState(3)
  const [sortKey,   setSortKey]   = useState('rs_rating')
  const [sortAsc,   setSortAsc]   = useState(false)
  const [market,    setMarket]    = useState(null)
  const [detail,    setDetail]    = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    fetch(`${API_BASE}/api/market/status`)
      .then(r => r.json())
      .then(d => !d.error && setMarket(d))
      .catch(() => {})
  }, [])

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
    await fetch(`${API_BASE}/api/screener/start`, { method: 'POST' })
    setStatus('running')
    startPoll()
  }

  function handleSort(key) {
    if (sortKey === key) setSortAsc(p => !p)
    else { setSortKey(key); setSortAsc(false) }
  }

  const filtered = results
    .filter(r => {
      if (r.rs_rating < minRS)   return false
      if (r.passed < minPassed)  return false
      if (vcpOnly && (r.vcp?.score ?? 0) < minVcp) return false
      return true
    })
    .sort((a, b) => {
      let va, vb
      if (sortKey === 'vcp') {
        va = a.vcp?.score ?? 0; vb = b.vcp?.score ?? 0
      } else {
        va = a[sortKey] ?? 0; vb = b[sortKey] ?? 0
      }
      return sortAsc ? va - vb : vb - va
    })

  function SortTh({ k, label }) {
    const active = sortKey === k
    return (
      <th className="sortable" onClick={() => handleSort(k)}>
        {label}{active ? (sortAsc ? ' ↑' : ' ↓') : ''}
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
            <span className="board-item">
              建議：<strong style={{ color: '#e0e3eb' }}>{market.suggestion}</strong>
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
            : status === 'done' ? '重新掃描' : '開始掃描'}
        </button>

        {status === 'running' && (
          <div className="progress-bar">
            <div className="progress-fill"
              style={{ width: total ? `${progress / total * 100}%` : '0%' }} />
          </div>
        )}

        <label className="filter-label">
          RS ≥
          <select value={minRS} onChange={e => setMinRS(+e.target.value)}>
            {[50,60,70,80,90].map(v => <option key={v}>{v}</option>)}
          </select>
        </label>

        <label className="filter-label">
          條件 ≥
          <select value={minPassed} onChange={e => setMinPassed(+e.target.value)}>
            {[4,5,6,7,8].map(v => <option key={v}>{v}</option>)}
          </select>
        </label>

        {/* VCP 篩選 */}
        <label className="filter-label vcp-toggle">
          <input
            type="checkbox"
            checked={vcpOnly}
            onChange={e => setVcpOnly(e.target.checked)}
          />
          只顯示 VCP ≥
          <select
            value={minVcp}
            onChange={e => setMinVcp(+e.target.value)}
            disabled={!vcpOnly}
          >
            <option value={2}>弱(2)</option>
            <option value={3}>中(3)</option>
            <option value={4}>強(4)</option>
          </select>
        </label>

        {status === 'done' && (
          <span className="result-count">符合：{filtered.length} 檔</span>
        )}
      </div>

      {/* ── 說明 ── */}
      {!status && (
        <div className="screener-hint">
          點擊「開始掃描」，系統將依 Minervini SEPA Trend Template + VCP
          對台股約 60 檔進行篩選（約需 1–2 分鐘）。
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
                <SortTh k="rs_rating" label="RS" />
                <SortTh k="passed"    label="條件" />
                <SortTh k="vcp"       label="VCP" />
                <th>樞紐點</th>
                <SortTh k="from_high" label="距高%" />
                <th>詳情</th>
                <th>看圖</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => {
                const vcp  = row.vcp ?? {}
                const vcpC = vcpColor(vcp.score ?? 0)
                return (
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

                      {/* VCP 評分 */}
                      <td>
                        {vcpC ? (
                          <span className="vcp-badge"
                            style={{ background: vcpC.bg, color: vcpC.color }}>
                            {vcpC.text} {vcp.score}/5
                          </span>
                        ) : (
                          <span style={{ color: '#5d6673' }}>—</span>
                        )}
                      </td>

                      {/* 樞紐點 & 距離 */}
                      <td>
                        {vcp.pivot ? (
                          <span style={{ fontSize: 12 }}>
                            {vcp.pivot}
                            <span style={{
                              color: vcp.dist_pivot <= 2 ? '#69f0ae' :
                                     vcp.dist_pivot <= 5 ? '#ffeb3b' : '#787b86',
                              marginLeft: 4,
                            }}>
                              {vcp.dist_pivot <= 0
                                ? '▲突破'
                                : `距${vcp.dist_pivot}%`}
                            </span>
                          </span>
                        ) : '—'}
                      </td>

                      <td className={row.from_high >= -10 ? 'up' : ''}>
                        {row.from_high}%
                      </td>

                      <td>
                        <button className="detail-btn"
                          onClick={() => setDetail(detail === row.symbol ? null : row.symbol)}>
                          {detail === row.symbol ? '收起' : '展開'}
                        </button>
                      </td>
                      <td>
                        <button className="chart-link-btn"
                          onClick={() => onSelectStock(row.symbol)}>
                          看圖 →
                        </button>
                      </td>
                    </tr>

                    {detail === row.symbol && (
                      <tr key={`${row.symbol}-det`} className="detail-row">
                        <td colSpan={10}>
                          <div className="detail-grid">
                            {/* Trend Template 條件 */}
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

                            {/* VCP 詳情 */}
                            {vcp.score > 0 && (
                              <div className="vcp-detail-block">
                                <div className="vcp-detail-title">VCP 分析</div>
                                <div className="vcp-detail-items">
                                  {(vcp.details || []).map((d, i) => (
                                    <div key={i} className="cond-item pass">✓ {d}</div>
                                  ))}
                                  {vcp.atr_ratio != null && (
                                    <div className="cond-item info">
                                      ATR比值: {vcp.atr_ratio}（&lt;0.8 = 波動收縮）
                                    </div>
                                  )}
                                  <div className="cond-item info">
                                    樞紐點: {vcp.pivot}（距 {vcp.dist_pivot}%）
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
