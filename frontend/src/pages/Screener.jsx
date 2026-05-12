import React, { useState, useEffect, useRef } from 'react'
import { API_BASE } from '../config'

const CONDITIONS = ['c1','c2','c3','c4','c5','c6','c7','c8']
const COND_LABEL = {
  c1:'股價>MA150', c2:'股價>MA200', c3:'MA150>MA200',
  c4:'MA200上升',  c5:'MA50>MA150&200', c6:'股價>MA50',
  c7:'距52低≥+30%', c8:'距52高≤25%',
}

const METHOD_PILLS = [
  { label:'Trend Template',  desc:'8大條件全通過才算合格',          color:'#5a8058' },
  { label:'RS 評分 0–99',    desc:'12個月加權報酬率百分位排名',     color:'#5a7a8a' },
  { label:'VCP 波動收縮',    desc:'5項波動/量能收縮指標',           color:'#8a6a8a' },
  { label:'Pocket Pivot',    desc:'今日紅K量>過去10日黑K最大量',    color:'#b86e2a' },
  { label:'選股建議引擎',    desc:'綜合訊號→進場點/停損/目標/RR',  color:'#c85a50' },
]

// 建議優先度色
const URGENCY_STYLE = {
  high:   { bg:'rgba(74,148,96,0.15)',  border:'rgba(74,148,96,0.45)',  text:'#3a8a5a' },
  medium: { bg:'rgba(184,158,42,0.12)', border:'rgba(184,158,42,0.45)', text:'#a09020' },
  low:    { bg:'rgba(140,100,60,0.10)', border:'rgba(140,100,60,0.25)', text:'#8a6840' },
  none:   { bg:'rgba(120,90,60,0.06)',  border:'rgba(120,90,60,0.15)',  text:'#9a8060' },
}

function rsColor(rs) {
  if (rs >= 90) return '#3a8a5a'
  if (rs >= 80) return '#6a9a50'
  if (rs >= 70) return '#a09020'
  if (rs >= 50) return '#b87030'
  return '#c85a50'
}
function passedColor(n) {
  if (n === 8) return '#3a8a5a'
  if (n >= 6)  return '#a09020'
  return '#9a8060'
}
function vcpColor(score) {
  if (score >= 4) return { bg:'rgba(74,148,96,0.18)',  color:'#3a8a5a' }
  if (score >= 3) return { bg:'rgba(90,128,136,0.18)', color:'#4a7a8a' }
  if (score >= 2) return { bg:'rgba(138,106,138,0.18)',color:'#7a508a' }
  return null
}

export default function Screener({ onSelectStock, watchlist = { groups:[] }, onToggleInGroup }) {
  const [status,    setStatus]    = useState(null)
  const [results,   setResults]   = useState([])
  const [progress,  setProgress]  = useState(0)
  const [total,     setTotal]     = useState(0)
  const [universe,  setUniverse]  = useState(null)   // { count, source }
  const [minRS,     setMinRS]     = useState(70)
  const [minPassed, setMinPassed] = useState(6)
  const [vcpOnly,   setVcpOnly]   = useState(false)
  const [minVcp,    setMinVcp]    = useState(3)
  const [ppOnly,    setPpOnly]    = useState(false)
  const [favOnly,   setFavOnly]   = useState(false)
  const [urgencyFilter, setUrgencyFilter] = useState('all')  // all / high / medium
  const [sortKey,   setSortKey]   = useState('rs_rating')
  const [sortAsc,   setSortAsc]   = useState(false)
  const [market,    setMarket]    = useState(null)
  const [detail,    setDetail]    = useState(null)
  const [showMethod, setShowMethod] = useState(false)
  const pollRef = useRef(null)

  const allFavSymbols = (watchlist.groups || []).flatMap(g => g.stocks)

  useEffect(() => {
    fetch(`${API_BASE}/api/market/status`)
      .then(r => r.json()).then(d => !d.error && setMarket(d)).catch(() => {})
    fetch(`${API_BASE}/api/screener/universe`)
      .then(r => r.json()).then(d => setUniverse(d)).catch(() => {})
  }, [])

  function startPoll() {
    clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      const d = await fetch(`${API_BASE}/api/screener/status`).then(r => r.json())
      setStatus(d.status); setProgress(d.progress); setTotal(d.total)
      if (d.status === 'done' || d.status === 'error') {
        clearInterval(pollRef.current)
        setResults(d.results || [])
      }
    }, 1500)
  }
  useEffect(() => () => clearInterval(pollRef.current), [])

  async function handleScan() {
    setResults([]); setDetail(null)
    await fetch(`${API_BASE}/api/screener/start`, { method:'POST' })
    setStatus('running'); startPoll()
  }

  function handleSort(key) {
    if (sortKey === key) setSortAsc(p => !p)
    else { setSortKey(key); setSortAsc(false) }
  }

  // 基礎過濾（不含 urgencyFilter，面板與表格共用同一母集）
  const baseFiltered = results.filter(r => {
    if (r.rs_rating < minRS)  return false
    if (r.passed < minPassed) return false
    if (vcpOnly && (r.vcp?.score ?? 0) < minVcp) return false
    if (ppOnly  && !r.pocket_pivot) return false
    if (favOnly && !allFavSymbols.includes(r.symbol)) return false
    return true
  })

  // 高優先面板：從 baseFiltered 取 urgency=high，確保與表格同一母集
  const highPriority = baseFiltered.filter(r => r.recommendation?.urgency === 'high')

  // 表格：在 baseFiltered 基礎上再套 urgencyFilter
  const filtered = baseFiltered.filter(r => {
    if (urgencyFilter !== 'all' && r.recommendation?.urgency !== urgencyFilter) return false
    return true
  }).sort((a, b) => {
    const urgOrder = { high:3, medium:2, low:1, none:0 }
    if (sortKey === 'urgency') {
      const va = urgOrder[a.recommendation?.urgency] ?? 0
      const vb = urgOrder[b.recommendation?.urgency] ?? 0
      return sortAsc ? va - vb : vb - va
    }
    const va = sortKey === 'vcp' ? (a.vcp?.score ?? 0) : (a[sortKey] ?? 0)
    const vb = sortKey === 'vcp' ? (b.vcp?.score ?? 0) : (b[sortKey] ?? 0)
    return sortAsc ? va - vb : vb - va
  })

  function SortTh({ k, label }) {
    return (
      <th className="sortable" onClick={() => handleSort(k)}>
        {label}{sortKey === k ? (sortAsc ? ' ↑' : ' ↓') : ''}
      </th>
    )
  }

  return (
    <div className="screener-page">

      {/* ── 說明卡片 ── */}
      <div className="method-card">
        <div className="method-header" onClick={() => setShowMethod(p => !p)}>
          <span className="method-title">📋 篩選方式說明</span>
          <span className="method-toggle">{showMethod ? '▲ 收起' : '▼ 展開'}</span>
        </div>
        {showMethod && (
          <>
            <div className="method-pills">
              {METHOD_PILLS.map(p => (
                <div key={p.label} className="method-pill" style={{ borderColor: p.color }}>
                  <span className="method-pill-label" style={{ color: p.color }}>{p.label}</span>
                  <span className="method-pill-desc">{p.desc}</span>
                </div>
              ))}
            </div>
            <div className="method-note">
              ℹ️ Minervini SEPA：先用 Trend Template 確認 Stage 2，RS 篩強勢股，VCP / PP 找進場點。
              選股建議引擎整合所有訊號，自動計算進場價、停損、目標與損益比。
            </div>
          </>
        )}
      </div>

      {/* ── 大盤看板 ── */}
      <div className="market-board">
        <span className="board-title">大盤（加權指數）</span>
        {market ? (
          <>
            <span className={`board-val ${market.above_ma50 ? 'up' : 'down'}`}>
              {market.index?.toLocaleString()}
            </span>
            <span className="board-item">MA50 {market.ma50?.toLocaleString()}</span>
            <span className="board-item">MA200 {market.ma200?.toLocaleString()}</span>
            <span className="board-item">散佈日 <strong style={{
              color: market.distribution_days >= 6 ? 'var(--up)' :
                     market.distribution_days >= 4 ? 'var(--warn)' : 'var(--down)'
            }}>{market.distribution_days}</strong>/25</span>
            <span className={`board-badge ${
              market.trend === '多頭' ? 'badge-green' :
              market.trend === '空頭' ? 'badge-red' : 'badge-yellow'
            }`}>{market.trend}</span>
            {/* FTD 偵測結果 */}
            {market.ftd && (
              <span className={`board-badge ${market.ftd.has_ftd ? 'badge-green' : 'badge-yellow'}`}
                title={market.ftd.status}>
                {market.ftd.has_ftd
                  ? `✅ FTD +${market.ftd.ftd_gain_pct}%`
                  : `FTD: ${market.ftd.status}`}
              </span>
            )}
            <span className="board-item">
              建議倉位：<strong style={{ color:'var(--text-1)' }}>{market.suggestion}</strong>
            </span>
          </>
        ) : <span style={{ color:'var(--text-3)' }}>載入中…</span>}
      </div>

      {/* ── 控制列 ── */}
      <div className="screener-controls">
        <button
          className={`scan-btn ${status === 'running' ? 'scanning' : ''}`}
          onClick={handleScan} disabled={status === 'running'}
        >
          {status === 'running' ? `掃描中… ${progress}/${total}`
            : status === 'done' ? '重新掃描' : '開始掃描'}
        </button>
        {universe && (
          <span className="universe-badge" title={`資料來源：${universe.source}`}>
            📊 {universe.source === 'TWSE+TPEX' ? '全市場' : '內建清單'} {universe.count} 檔
          </span>
        )}

        {status === 'running' && (
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: total ? `${progress/total*100}%` : '0%' }} />
          </div>
        )}

        <label className="filter-label">RS ≥
          <select value={minRS} onChange={e => setMinRS(+e.target.value)}>
            {[50,60,70,80,90].map(v => <option key={v}>{v}</option>)}
          </select>
        </label>
        <label className="filter-label">條件 ≥
          <select value={minPassed} onChange={e => setMinPassed(+e.target.value)}>
            {[4,5,6,7,8].map(v => <option key={v}>{v}</option>)}
          </select>
        </label>
        <label className="filter-label vcp-toggle">
          <input type="checkbox" checked={vcpOnly} onChange={e => setVcpOnly(e.target.checked)} />
          VCP ≥
          <select value={minVcp} onChange={e => setMinVcp(+e.target.value)} disabled={!vcpOnly}>
            <option value={2}>弱(2)</option>
            <option value={3}>中(3)</option>
            <option value={4}>強(4)</option>
          </select>
        </label>
        <label className="filter-label vcp-toggle">
          <input type="checkbox" checked={ppOnly} onChange={e => setPpOnly(e.target.checked)} />
          Pocket Pivot
        </label>

        {/* 建議優先度篩選 */}
        <div className="urgency-filter">
          {[
            { v:'all',    l:'全部'     },
            { v:'high',   l:'🚀 高優先' },
            { v:'medium', l:'⏰ 設提醒' },
          ].map(({ v, l }) => (
            <button
              key={v}
              className={`urgency-btn ${urgencyFilter === v ? 'active' : ''}`}
              onClick={() => setUrgencyFilter(v)}
            >{l}</button>
          ))}
        </div>

        {allFavSymbols.length > 0 && (
          <button
            className={`fav-filter-btn ${favOnly ? 'active' : ''}`}
            onClick={() => setFavOnly(p => !p)}
          >★ 自選股</button>
        )}

        {status === 'done' && <span className="result-count">符合：{filtered.length} 檔</span>}
      </div>

      {/* ── 高優先候選面板 ── */}
      {highPriority.length > 0 && (
        <div className="priority-panel">
          <div className="priority-title">
            🎯 高優先候選
            <span className="priority-count">{highPriority.length} 檔</span>
            <span className="priority-sub">— 可考慮進場 / 即將突破</span>
          </div>
          <div className="priority-cards">
            {highPriority.map(r => {
              const rec = r.recommendation
              const sty = URGENCY_STYLE[rec?.urgency] || URGENCY_STYLE.low
              return (
                <div
                  key={r.symbol}
                  className="priority-card"
                  style={{ borderColor: sty.border, background: sty.bg }}
                >
                  <div className="pc-header">
                    <div>
                      <span className="pc-sym" onClick={() => onSelectStock(r.symbol)}>{r.symbol}</span>
                      <span className="pc-name">{r.name}</span>
                    </div>
                    <span className="pc-action" style={{ color: sty.text }}>{rec?.action_label}</span>
                  </div>

                  {rec?.entry && (
                    <div className="pc-levels">
                      <div className="pc-level">
                        <span className="pc-lk">進場</span>
                        <span className="pc-lv" style={{ color:'var(--text-1)' }}>{rec.entry}</span>
                      </div>
                      <div className="pc-level">
                        <span className="pc-lk">停損</span>
                        <span className="pc-lv" style={{ color:'var(--up)' }}>{rec.stop}</span>
                      </div>
                      <div className="pc-level">
                        <span className="pc-lk">目標</span>
                        <span className="pc-lv" style={{ color:'var(--down)' }}>{rec.target}</span>
                      </div>
                      {rec.rr && (
                        <div className="pc-level">
                          <span className="pc-lk">RR</span>
                          <span className="pc-lv" style={{ color: rec.rr >= 2 ? 'var(--down)' : 'var(--warn)' }}>
                            1:{rec.rr}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="pc-reason">{rec?.reason}</div>

                  <div className="pc-footer">
                    <span className="pc-meta">RS {r.rs_rating} · {r.passed}/8 · {rec?.setup_type}</span>
                    <div style={{ display:'flex', gap:6 }}>
                      {r.pocket_pivot && <span className="pp-badge">🚀 PP</span>}
                      <button className="chart-link-btn" onClick={() => onSelectStock(r.symbol)}>看圖 →</button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!status && (
        <div className="screener-hint">
          點擊「開始掃描」，系統將對台股約 60 檔進行 Minervini SEPA 篩選，
          並自動生成進場建議（約需 1–2 分鐘）。
        </div>
      )}

      {/* ── 篩選後空白提示 ── */}
      {results.length > 0 && filtered.length === 0 && (
        <div className="screener-hint" style={{ color:'var(--text-2)' }}>
          目前篩選條件下沒有符合的股票。
          試著降低「RS ≥」或「條件 ≥」門檻，或切換建議篩選為「全部」。
        </div>
      )}

      {/* ── 結果表格 ── */}
      {filtered.length > 0 && (
        <div className="table-wrap">
          <table className="screener-table">
            <thead>
              <tr>
                <th>★</th>
                <th>代碼</th><th>名稱</th>
                <SortTh k="close"     label="收盤" />
                <SortTh k="rs_rating" label="RS" />
                <SortTh k="passed"    label="條件" />
                <SortTh k="vcp"       label="VCP" />
                <th>樞紐點</th>
                <th>PP</th>
                <SortTh k="from_high" label="距高%" />
                <SortTh k="from_ma50" label="距MA50%" />
                <SortTh k="urgency"   label="建議" />
                <th>詳情</th><th>看圖</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(row => {
                const vcp = row.vcp ?? {}
                const vc  = vcpColor(vcp.score ?? 0)
                const rec = row.recommendation
                const us  = URGENCY_STYLE[rec?.urgency] || URGENCY_STYLE.none
                const isFav = allFavSymbols.includes(row.symbol)

                return (
                  <React.Fragment key={row.symbol}>
                    <tr className="data-row">
                      {/* ★ */}
                      <td>
                        <button
                          className={`star-btn ${isFav ? 'active' : ''}`}
                          onClick={() => {
                            const defaultGroup = watchlist.groups[0]
                            if (defaultGroup) onToggleInGroup(row.symbol, defaultGroup.id)
                          }}
                          title={isFav ? '移除自選' : '加入自選'}
                        >{isFav ? '★' : '☆'}</button>
                      </td>
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
                      <td>
                        {vc
                          ? <span className="vcp-badge" style={{ background:vc.bg, color:vc.color }}
                              title={vcp.details?.join(' · ')}>
                              {vcp.score >= 4 ? 'VCP強' : vcp.score >= 3 ? 'VCP中' : 'VCP弱'} {vcp.score}/5
                              {/* 只在仍在整理區（dist_pivot > -8%）才顯示收縮次數
                                  已大幅突破高點的股票，舊序列數字沒有意義 */}
                              {vcp.contractions >= 2 && (vcp.dist_pivot == null || vcp.dist_pivot > -8)
                                ? <span style={{ fontSize:10, marginLeft:4, opacity:0.85 }}>
                                    {vcp.contractions}收縮{vcp.vol_contracting ? '📉' : ''}
                                  </span>
                                : null}
                            </span>
                          : <span style={{ color:'var(--text-3)' }}>—</span>}
                      </td>
                      <td style={{ fontSize:12 }}>
                        {vcp.pivot
                          ? <>{vcp.pivot} <span style={{
                              color: vcp.dist_pivot <= 2 ? 'var(--down)' :
                                     vcp.dist_pivot <= 5 ? 'var(--warn)' : 'var(--text-3)'
                            }}>{vcp.dist_pivot <= 0 ? '▲突破' : `距${vcp.dist_pivot}%`}</span>
                            </>
                          : '—'}
                      </td>
                      <td>
                        {row.pocket_pivot
                          ? <span className="pp-badge">🚀 PP</span>
                          : <span style={{ color:'var(--text-3)' }}>—</span>}
                      </td>
                      <td className={row.from_high >= -10 ? 'up' : ''}>{row.from_high}%</td>
                      <td>
                        <span style={{
                          fontSize: 11, fontWeight: 600,
                          color: row.from_ma50 > 20 ? 'var(--up)'
                               : row.from_ma50 > 10 ? 'var(--warn)'
                               : 'var(--down)',
                        }}>
                          {row.from_ma50 != null ? `+${row.from_ma50}%` : '—'}
                        </span>
                      </td>

                      {/* 建議欄 */}
                      <td>
                        {rec
                          ? <span
                              className="rec-badge"
                              style={{ background: us.bg, color: us.text, borderColor: us.border }}
                            >
                              {rec.action_label}
                            </span>
                          : '—'}
                      </td>

                      <td>
                        <button className="detail-btn"
                          onClick={() => setDetail(detail === row.symbol ? null : row.symbol)}>
                          {detail === row.symbol ? '收起' : '展開'}
                        </button>
                      </td>
                      <td>
                        <button className="chart-link-btn" onClick={() => onSelectStock(row.symbol)}>
                          看圖 →
                        </button>
                      </td>
                    </tr>

                    {/* ── 展開詳情 ── */}
                    {detail === row.symbol && (
                      <tr className="detail-row">
                        <td colSpan={14}>
                          <div style={{ display:'flex', gap:20, flexWrap:'wrap' }}>

                            {/* 選股建議卡 */}
                            {rec && (
                              <div className="rec-detail-card"
                                style={{ borderColor: us.border, background: us.bg }}>
                                <div className="rec-detail-title" style={{ color: us.text }}>
                                  {rec.action_label} · {rec.setup_type}
                                </div>
                                <div className="rec-detail-reason">{rec.reason}</div>
                                {rec.entry && (
                                  <div className="rec-detail-levels">
                                    <div className="rdl-item">
                                      <span className="rdl-k">建議進場</span>
                                      <span className="rdl-v" style={{ color:'var(--text-1)', fontWeight:700 }}>{rec.entry}</span>
                                    </div>
                                    <div className="rdl-item">
                                      <span className="rdl-k">停損</span>
                                      <span className="rdl-v" style={{ color:'var(--up)' }}>{rec.stop}
                                        {rec.entry && rec.stop
                                          ? ` (${((rec.entry-rec.stop)/rec.entry*100).toFixed(1)}%)`
                                          : ''}</span>
                                    </div>
                                    <div className="rdl-item">
                                      <span className="rdl-k">目標</span>
                                      <span className="rdl-v" style={{ color:'var(--down)' }}>{rec.target}</span>
                                    </div>
                                    {rec.rr && (
                                      <div className="rdl-item">
                                        <span className="rdl-k">損益比</span>
                                        <span className="rdl-v" style={{ color: rec.rr >= 2 ? 'var(--down)' : 'var(--warn)', fontWeight:700 }}>
                                          1:{rec.rr} {rec.rr >= 2 ? '✓' : '⚠️'}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Trend Template 條件 */}
                            <div className="detail-grid" style={{ flex:1 }}>
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
                              {(vcp.score > 0) && (
                                <div className="vcp-detail-block">
                                  <div className="vcp-detail-title">VCP 分析</div>
                                  <div className="vcp-detail-items">
                                    {(vcp.details || []).map((d, i) =>
                                      <div key={i} className="cond-item pass">✓ {d}</div>)}
                                    {vcp.atr_ratio != null &&
                                      <div className="cond-item info">ATR比值: {vcp.atr_ratio}（&lt;0.8=收縮）</div>}
                                    <div className="cond-item info">樞紐點: {vcp.pivot}（距 {vcp.dist_pivot}%）</div>
                                  </div>
                                </div>
                              )}
                              {row.pocket_pivot && (
                                <div className="cond-item pass" style={{ width:'100%' }}>
                                  🚀 Pocket Pivot：今日紅K量超過過去10日所有黑K最大量
                                </div>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
