import { useState } from 'react'
import { API_BASE } from '../config'

const PERIODS = [
  { label: '1 年', value: '1y' },
  { label: '2 年', value: '2y' },
  { label: '3 年', value: '3y' },
  { label: '5 年', value: '5y' },
]

// Minervini Trend Template 8 個條件
const TREND_CONDITIONS = [
  { id: 1, label: '① 收盤 > MA150',              desc: '股價站上 150 日均線' },
  { id: 2, label: '② 收盤 > MA200',              desc: '股價站上 200 日均線' },
  { id: 3, label: '③ MA150 > MA200',             desc: '中期均線在長期均線上方' },
  { id: 4, label: '④ MA200 向上（近20日）',       desc: '長期趨勢向上' },
  { id: 5, label: '⑤ MA50 > MA150 且 > MA200',  desc: '短中長期均線多頭排列' },
  { id: 6, label: '⑥ 收盤 > MA50',              desc: '股價站上 50 日均線' },
  { id: 7, label: '⑦ 距52週低 +30% 以上',        desc: '從年低大幅回升' },
  { id: 8, label: '⑧ 距52週高 75% 以內',         desc: '接近年高區間' },
]

export default function Backtest({ symbol: defaultSymbol = '2330' }) {
  const [symbol,     setSymbol]     = useState(defaultSymbol)
  const [period,     setPeriod]     = useState('3y')
  const [stopPct,    setStopPct]    = useState(8)
  const [targetPct,  setTargetPct]  = useState(20)
  const [holdDays,   setHoldDays]   = useState(60)
  const [strategy,   setStrategy]   = useState('vcp')       // "vcp" | "hl5ma"
  const [selConds,   setSelConds]   = useState(new Set())   // 選中的條件 id
  const [showConds,  setShowConds]  = useState(false)       // 展開條件面板
  const [loading,    setLoading]    = useState(false)
  const [result,     setResult]     = useState(null)
  const [error,      setError]      = useState(null)

  function toggleCond(id) {
    setSelConds(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function selectAll()   { setSelConds(new Set(TREND_CONDITIONS.map(c => c.id))) }
  function clearAll()    { setSelConds(new Set()) }

  async function runBacktest() {
    const sym = symbol.trim()
    if (!sym) return
    setLoading(true); setError(null); setResult(null)
    try {
      const params = new URLSearchParams({
        stop_pct:   stopPct,
        target_pct: targetPct,
        hold_days:  holdDays,
        period,
        strategy,
        conditions: [...selConds].sort((a, b) => a - b).join(','),
      })
      const r = await fetch(`${API_BASE}/api/stocks/${sym}/backtest?${params}`)
      const data = await r.json()
      if (data.error) throw new Error(data.error)
      setResult(data)
    } catch (e) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const s = result?.stats
  const isHL5MA = strategy === 'hl5ma'
  const condLabel = selConds.size === 0
    ? isHL5MA ? '不限（僅 HL5MA）' : '不限（僅 VCP）'
    : `需同時符合 ${selConds.size} 個條件`

  return (
    <div className="backtest-page">

      {/* ── 策略選擇 ── */}
      <div className="bt-strategy-tabs">
        <button
          className={`bt-strat-btn ${strategy === 'vcp' ? 'active' : ''}`}
          onClick={() => { setStrategy('vcp'); setResult(null) }}
        >
          📊 VCP 突破
        </button>
        <button
          className={`bt-strat-btn ${strategy === 'hl5ma' ? 'active' : ''}`}
          onClick={() => { setStrategy('hl5ma'); setResult(null) }}
        >
          📈 HL 5MA 站回
        </button>
        <span className="bt-strat-desc">
          {isHL5MA
            ? '連續高低點墊高（HL），收盤站回 5MA 時進場'
            : '價量收縮（VCP）型態放量突破樞紐點時進場'}
        </span>
      </div>

      {/* ── 基本參數列 ── */}
      <div className="bt-params">
        <div className="bt-param-group">
          <label>股票代碼</label>
          <input
            className="bt-input"
            value={symbol}
            onChange={e => setSymbol(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => e.key === 'Enter' && runBacktest()}
            maxLength={6} placeholder="例：2330"
          />
        </div>

        <div className="bt-param-group">
          <label>回測期間</label>
          <select className="bt-select" value={period} onChange={e => setPeriod(e.target.value)}>
            {PERIODS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
          </select>
        </div>

        <div className="bt-param-group">
          <label>停損 %</label>
          <input className="bt-input bt-num" type="number"
            value={stopPct}
            onChange={e => { const v = e.target.value; setStopPct(v === '' ? '' : +v) }}
            min={1} max={30} step={0.5} />
        </div>

        <div className="bt-param-group">
          <label>停利 %</label>
          <input className="bt-input bt-num" type="number"
            value={targetPct}
            onChange={e => { const v = e.target.value; setTargetPct(v === '' ? '' : +v) }}
            min={5} max={200} step={1} />
        </div>

        <div className="bt-param-group">
          <label>最大持有天</label>
          <input className="bt-input bt-num" type="number"
            value={holdDays}
            onChange={e => { const v = e.target.value; setHoldDays(v === '' ? '' : +v) }}
            min={10} max={365} step={5} />
        </div>

        <button className="bt-run-btn" onClick={runBacktest} disabled={loading}>
          {loading ? '計算中…' : '▶ 開始回測'}
        </button>
      </div>

      {/* ── Trend Template 條件篩選 ── */}
      <div className="bt-cond-panel">
        <button
          className="bt-cond-toggle"
          onClick={() => setShowConds(p => !p)}
        >
          <span className="bt-cond-icon">{showConds ? '▼' : '▶'}</span>
          Trend Template 條件篩選
          <span className="bt-cond-badge">{condLabel}</span>
        </button>

        {showConds && (
          <div className="bt-cond-body">
            <div className="bt-cond-actions">
              <button className="bt-cond-btn" onClick={selectAll}>全選 8 個</button>
              <button className="bt-cond-btn" onClick={clearAll}>全部清除</button>
              <span className="bt-cond-hint">
                勾選的條件「全部」需在買入當日同時成立，未勾選則不限制
              </span>
            </div>
            <div className="bt-cond-grid">
              {TREND_CONDITIONS.map(c => (
                <label key={c.id} className={`bt-cond-item ${selConds.has(c.id) ? 'selected' : ''}`}>
                  <input
                    type="checkbox"
                    checked={selConds.has(c.id)}
                    onChange={() => toggleCond(c.id)}
                  />
                  <div className="bt-cond-text">
                    <span className="bt-cond-label">{c.label}</span>
                    <span className="bt-cond-desc">{c.desc}</span>
                  </div>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      {loading && (
        <div className="bt-loading">
          <div className="bt-spinner" />
          正在進行 {isHL5MA ? 'HL 5MA' : 'VCP'} 回測，請稍候（約 10–20 秒）…
        </div>
      )}

      {error && <div className="bt-error">⚠️ {error}</div>}

      {result && !loading && (
        <>
          {/* 條件摘要 */}
          {selConds.size > 0 && (
            <div className="bt-cond-summary">
              篩選條件：{[...selConds].sort((a,b)=>a-b).map(id =>
                TREND_CONDITIONS.find(c => c.id === id)?.label
              ).join('　')}
            </div>
          )}

          {/* ── 統計卡片 ── */}
          <div className="bt-stats">
            <StatCard label="總交易次數" value={s.total_trades} unit="次" />
            <StatCard label="勝率"
              value={s.win_rate} unit="%"
              color={s.win_rate >= 50 ? '#4caf93' : '#c85a50'} />
            <StatCard label="平均獲利"
              value={(s.avg_gain >= 0 ? '+' : '') + s.avg_gain} unit="%"
              color="#4caf93" />
            <StatCard label="平均虧損"
              value={s.avg_loss} unit="%"
              color="#c85a50" />
            <StatCard label="總報酬"
              value={(s.total_return >= 0 ? '+' : '') + s.total_return} unit="%"
              color={s.total_return >= 0 ? '#4caf93' : '#c85a50'} />
            <StatCard label="最大回撤"
              value={s.max_drawdown} unit="%"
              color="#c85a50" />
            <StatCard label="獲利因子"
              value={s.profit_factor}
              color={s.profit_factor >= 1.5 ? '#4caf93' : s.profit_factor >= 1 ? '#e0a800' : '#c85a50'} />
          </div>

          {/* ── 資產曲線 ── */}
          {result.equity_curve.length > 0 && (
            <EquityCurve data={result.equity_curve} trades={result.trades} />
          )}

          {/* ── 交易紀錄 ── */}
          {result.trades.length > 0 ? (
            <div className="bt-trades-wrap">
              <div className="bt-section-title">
                交易紀錄
                <span className="bt-trade-count">
                  共 {s.total_trades} 筆｜勝 {s.win_count} 負 {s.loss_count}
                </span>
              </div>
              <div className="bt-table-wrap">
                <table className="bt-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>買入日期</th>
                      <th>賣出日期</th>
                      <th>{isHL5MA ? '前HL停損' : '基準點'}</th>
                      <th>買入價</th>
                      <th>賣出價</th>
                      <th>持有天</th>
                      <th>損益 %</th>
                      <th>結束原因</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.trades.map((t, i) => (
                      <tr key={i} className={t.pnl_pct > 0 ? 'bt-win' : 'bt-loss'}>
                        <td className="bt-idx">{i + 1}</td>
                        <td>{t.entry_date}</td>
                        <td>{t.exit_date}</td>
                        <td>{t.pivot}</td>
                        <td>{t.entry_price}</td>
                        <td>{t.exit_price}</td>
                        <td>{t.days_held}</td>
                        <td className={t.pnl_pct > 0 ? 'up' : 'down'}>
                          {t.pnl_pct > 0 ? '+' : ''}{t.pnl_pct}%
                        </td>
                        <td>
                          <span className={`bt-reason bt-reason-${
                            t.exit_reason === '停利' ? 'win' :
                            t.exit_reason === '停損' ? 'loss' : 'time'
                          }`}>
                            {t.exit_reason}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : (
            <div className="bt-no-trades">
              此期間未偵測到符合條件的 {isHL5MA ? 'HL 5MA 站回' : 'VCP 放量突破'} 買點
              {selConds.size > 0 && `（已加入 ${selConds.size} 個 Trend Template 條件篩選）`}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StatCard({ label, value, unit = '', color }) {
  return (
    <div className="bt-stat-card">
      <div className="bt-stat-label">{label}</div>
      <div className="bt-stat-value" style={color ? { color } : {}}>{value}{unit}</div>
    </div>
  )
}

function EquityCurve({ data, trades }) {
  const W = 900, H = 210, PL = 56, PR = 16, PT = 14, PB = 26
  const iW = W - PL - PR
  const iH = H - PT - PB

  const vals = data.map(d => d.value)
  const rawMin = Math.min(...vals)
  const rawMax = Math.max(...vals)
  const pad    = Math.max((rawMax - rawMin) * 0.06, 1)
  const minV   = rawMin - pad
  const maxV   = rawMax + pad
  const range  = maxV - minV || 1

  const px = i  => PL + (i / Math.max(data.length - 1, 1)) * iW
  const py = v  => PT + iH - ((v - minV) / range) * iH

  const linePts = data.map((d, i) => `${px(i).toFixed(1)},${py(d.value).toFixed(1)}`).join(' ')
  const fillPts = `${PL},${PT + iH} ${linePts} ${W - PR},${PT + iH}`
  const baseline = py(100)

  // Entry / exit markers (de-duplicate same-pixel x so they don't pile up)
  const markers = []
  trades.forEach(t => {
    const ei = data.findIndex(d => d.date === t.entry_date)
    const xi = data.findIndex(d => d.date === t.exit_date)
    if (ei >= 0) markers.push({ i: ei, type: 'entry',    v: data[ei].value })
    if (xi >= 0) markers.push({ i: xi, type: t.pnl_pct > 0 ? 'win' : 'loss', v: data[xi].value })
  })

  // Y-axis ticks: 5 evenly spaced, rounded nicely
  const rawStep = (rawMax - rawMin) / 4 || 1
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)))
  const niceStep  = Math.ceil(rawStep / magnitude) * magnitude
  const tickStart = Math.floor(rawMin / niceStep) * niceStep
  const yTicks = []
  for (let v = tickStart; v <= rawMax + niceStep; v += niceStep) {
    if (v >= rawMin - pad && v <= rawMax + pad) yTicks.push(Math.round(v * 10) / 10)
  }

  return (
    <div className="bt-chart-wrap">
      {/* ── 標題 + 圖例（HTML，不在 SVG 內） ── */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:8 }}>
        <div className="bt-section-title" style={{ marginBottom:0 }}>資產曲線（初始 = 100）</div>
        <div style={{ display:'flex', gap:16, fontSize:11, color:'var(--text-3)' }}>
          <span><span style={{ color:'#4caf93', marginRight:3 }}>▲</span>買入</span>
          <span><span style={{ color:'#4caf93', marginRight:3 }}>▼</span>獲利出場</span>
          <span><span style={{ color:'#c85a50', marginRight:3 }}>▼</span>虧損出場</span>
        </div>
      </div>

      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display:'block' }}>
        <defs>
          <linearGradient id="eq-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="#4caf93" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#4caf93" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* ── Y 軸格線 + 標籤 ── */}
        {yTicks.map(v => (
          <g key={v}>
            <line
              x1={PL} y1={py(v)} x2={W - PR} y2={py(v)}
              stroke="var(--border)" strokeWidth="1" opacity="0.45"
            />
            <text
              x={PL - 6} y={py(v) + 4}
              textAnchor="end" fill="var(--text-3)" fontSize="10"
            >{v}</text>
          </g>
        ))}

        {/* ── 100 基準線 ── */}
        {baseline >= PT && baseline <= PT + iH && (
          <line
            x1={PL} y1={baseline} x2={W - PR} y2={baseline}
            stroke="#888" strokeWidth="1" strokeDasharray="5 4" opacity="0.5"
          />
        )}

        {/* ── 填色 + 曲線 ── */}
        <polygon points={fillPts} fill="url(#eq-fill)" />
        <polyline points={linePts} fill="none" stroke="#4caf93" strokeWidth="1.8" strokeLinejoin="round" />

        {/* ── 交易標記 ── */}
        {markers.map((m, idx) => {
          const cx = px(m.i), cy = py(m.v)
          if (m.type === 'entry')
            return <polygon key={idx}
              points={`${cx},${cy - 7} ${cx - 5},${cy + 3} ${cx + 5},${cy + 3}`}
              fill="#4caf93" opacity="0.9" />
          if (m.type === 'win')
            return <polygon key={idx}
              points={`${cx},${cy + 7} ${cx - 5},${cy - 3} ${cx + 5},${cy - 3}`}
              fill="#4caf93" opacity="0.75" />
          return <polygon key={idx}
            points={`${cx},${cy + 7} ${cx - 5},${cy - 3} ${cx + 5},${cy - 3}`}
            fill="#c85a50" opacity="0.85" />
        })}
      </svg>
    </div>
  )
}
