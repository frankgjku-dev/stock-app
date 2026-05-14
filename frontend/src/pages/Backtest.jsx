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
  const condLabel = selConds.size === 0
    ? '不限（僅 VCP）'
    : `需同時符合 ${selConds.size} 個條件`

  return (
    <div className="backtest-page">

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
          正在進行 VCP 回測，請稍候（約 10–20 秒）…
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
                      <th>基準點</th>
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
              此期間未偵測到符合條件的 VCP 放量突破買點
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
  const W = 900, H = 240, PL = 52, PR = 20, PT = 16, PB = 28
  const iW = W - PL - PR
  const iH = H - PT - PB

  const vals = data.map(d => d.value)
  const minV = Math.min(...vals) * 0.995
  const maxV = Math.max(...vals) * 1.005
  const range = maxV - minV || 1

  const px = i => PL + (i / (data.length - 1)) * iW
  const py = v => PT + iH - ((v - minV) / range) * iH

  const linePts = data.map((d, i) => `${px(i)},${py(d.value)}`).join(' ')
  const fillPts = `${PL},${PT + iH} ${linePts} ${W - PR},${PT + iH}`
  const baseline = py(100)

  const markers = []
  trades.forEach(t => {
    const ei = data.findIndex(d => d.date === t.entry_date)
    const xi = data.findIndex(d => d.date === t.exit_date)
    if (ei >= 0) markers.push({ i: ei, type: 'entry' })
    if (xi >= 0) markers.push({ i: xi, type: t.pnl_pct > 0 ? 'exit_win' : 'exit_loss' })
  })

  const yTicks = [minV, minV + range * 0.5, maxV].map(v => Math.round(v))

  return (
    <div className="bt-chart-wrap">
      <div className="bt-section-title">資產曲線（初始 = 100）</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {yTicks.map(v => (
          <g key={v}>
            <line x1={PL} y1={py(v)} x2={W - PR} y2={py(v)} stroke="#2a2a2a" strokeWidth="1" />
            <text x={PL - 4} y={py(v) + 4} textAnchor="end" fill="#666" fontSize="10">{v}</text>
          </g>
        ))}
        {baseline >= PT && baseline <= PT + iH && (
          <line x1={PL} y1={baseline} x2={W - PR} y2={baseline}
            stroke="#555" strokeWidth="1" strokeDasharray="4 4" />
        )}
        <polygon points={fillPts} fill="#4caf9315" />
        <polyline points={linePts} fill="none" stroke="#4caf93" strokeWidth="2" />
        {markers.map((m, idx) => {
          const cx = px(m.i), cy = py(data[m.i].value)
          if (m.type === 'entry')
            return <polygon key={idx} points={`${cx},${cy-7} ${cx-5},${cy+3} ${cx+5},${cy+3}`} fill="#4caf93" opacity="0.9" />
          if (m.type === 'exit_win')
            return <polygon key={idx} points={`${cx},${cy+7} ${cx-5},${cy-3} ${cx+5},${cy-3}`} fill="#4caf93" opacity="0.7" />
          return <polygon key={idx} points={`${cx},${cy+7} ${cx-5},${cy-3} ${cx+5},${cy-3}`} fill="#c85a50" opacity="0.7" />
        })}
        <polygon points="16,12 11,22 21,22" fill="#4caf93" />
        <text x={25} y={21} fill="#aaa" fontSize="11">買入</text>
        <polygon points="70,22 65,12 75,12" fill="#4caf93" />
        <text x={79} y={21} fill="#aaa" fontSize="11">獲利出場</text>
        <polygon points="148,22 143,12 153,12" fill="#c85a50" />
        <text x={157} y={21} fill="#aaa" fontSize="11">虧損出場</text>
      </svg>
    </div>
  )
}
