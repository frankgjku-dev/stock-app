import { useState } from 'react'
import { API_BASE } from '../config'

const PERIODS = [
  { label: '1 年', value: '1y' },
  { label: '2 年', value: '2y' },
  { label: '3 年', value: '3y' },
  { label: '5 年', value: '5y' },
]

export default function Backtest({ symbol: defaultSymbol = '2330' }) {
  const [symbol,    setSymbol]    = useState(defaultSymbol)
  const [period,    setPeriod]    = useState('3y')
  const [stopPct,   setStopPct]   = useState(8)
  const [targetPct, setTargetPct] = useState(20)
  const [holdDays,  setHoldDays]  = useState(60)
  const [loading,   setLoading]   = useState(false)
  const [result,    setResult]    = useState(null)
  const [error,     setError]     = useState(null)

  async function runBacktest() {
    const sym = symbol.trim()
    if (!sym) return
    setLoading(true); setError(null); setResult(null)
    try {
      const params = new URLSearchParams({
        stop_pct: stopPct, target_pct: targetPct,
        hold_days: holdDays, period,
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

  return (
    <div className="backtest-page">

      {/* ── 參數列 ── */}
      <div className="bt-params">
        <div className="bt-param-group">
          <label>股票代碼</label>
          <input
            className="bt-input"
            value={symbol}
            onChange={e => setSymbol(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => e.key === 'Enter' && runBacktest()}
            maxLength={6}
            placeholder="例：2330"
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
            value={stopPct} onChange={e => setStopPct(+e.target.value)}
            min={1} max={30} step={0.5} />
        </div>

        <div className="bt-param-group">
          <label>停利 %</label>
          <input className="bt-input bt-num" type="number"
            value={targetPct} onChange={e => setTargetPct(+e.target.value)}
            min={5} max={200} step={1} />
        </div>

        <div className="bt-param-group">
          <label>最大持有天</label>
          <input className="bt-input bt-num" type="number"
            value={holdDays} onChange={e => setHoldDays(+e.target.value)}
            min={10} max={365} step={5} />
        </div>

        <button className="bt-run-btn" onClick={runBacktest} disabled={loading}>
          {loading ? '計算中…' : '▶ 開始回測'}
        </button>
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
          {/* ── 統計卡片 ── */}
          <div className="bt-stats">
            <StatCard label="總交易次數" value={s.total_trades} unit="次" />
            <StatCard label="勝率"
              value={s.win_rate} unit="%"
              color={s.win_rate >= 50 ? '#4caf93' : '#c85a50'} />
            <StatCard label="平均獲利"
              value={(s.avg_gain > 0 ? '+' : '') + s.avg_gain} unit="%"
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
                          <span className={`bt-reason bt-reason-${t.exit_reason === '停利' ? 'win' : t.exit_reason === '停損' ? 'loss' : 'time'}`}>
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
              此期間未偵測到符合條件的 VCP 放量突破買點（需 ≥ 2 次收縮 + 放量突破基準點）
            </div>
          )}
        </>
      )}
    </div>
  )
}

/* ── 統計卡 ── */
function StatCard({ label, value, unit = '', color }) {
  return (
    <div className="bt-stat-card">
      <div className="bt-stat-label">{label}</div>
      <div className="bt-stat-value" style={color ? { color } : {}}>
        {value}{unit}
      </div>
    </div>
  )
}

/* ── 資產曲線（SVG）── */
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

  const linePts  = data.map((d, i) => `${px(i)},${py(d.value)}`).join(' ')
  const fillPts  = `${PL},${PT + iH} ${linePts} ${W - PR},${PT + iH}`
  const baseline = py(100)

  // 在資產曲線上標記買入（▲綠）/ 賣出（▽紅/綠）點
  const markers = []
  trades.forEach(t => {
    const ei = data.findIndex(d => d.date === t.entry_date)
    const xi = data.findIndex(d => d.date === t.exit_date)
    if (ei >= 0) markers.push({ i: ei, type: 'entry' })
    if (xi >= 0) markers.push({ i: xi, type: t.pnl_pct > 0 ? 'exit_win' : 'exit_loss' })
  })

  // Y 軸刻度（4條）
  const yTicks = [minV, minV + range * 0.33, minV + range * 0.67, maxV].map(v => Math.round(v))

  return (
    <div className="bt-chart-wrap">
      <div className="bt-section-title">資產曲線（初始 = 100）</div>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ display: 'block' }}>
        {/* Y 軸刻度線 */}
        {yTicks.map(v => (
          <g key={v}>
            <line x1={PL} y1={py(v)} x2={W - PR} y2={py(v)}
              stroke="#2a2a2a" strokeWidth="1" />
            <text x={PL - 4} y={py(v) + 4} textAnchor="end"
              fill="#666" fontSize="10">{v}</text>
          </g>
        ))}

        {/* 100 基準線（特別標示）*/}
        {baseline >= PT && baseline <= PT + iH && (
          <line x1={PL} y1={baseline} x2={W - PR} y2={baseline}
            stroke="#555" strokeWidth="1" strokeDasharray="4 4" />
        )}

        {/* 面積填色 */}
        <polygon points={fillPts} fill="#4caf9315" />

        {/* 曲線 */}
        <polyline points={linePts} fill="none" stroke="#4caf93" strokeWidth="2" />

        {/* 交易標記 */}
        {markers.map((m, idx) => {
          const cx = px(m.i)
          const cy = py(data[m.i].value)
          if (m.type === 'entry') {
            return <polygon key={idx}
              points={`${cx},${cy - 7} ${cx - 5},${cy + 3} ${cx + 5},${cy + 3}`}
              fill="#4caf93" opacity="0.9" />
          }
          if (m.type === 'exit_win') {
            return <polygon key={idx}
              points={`${cx},${cy + 7} ${cx - 5},${cy - 3} ${cx + 5},${cy - 3}`}
              fill="#4caf93" opacity="0.7" />
          }
          return <polygon key={idx}
            points={`${cx},${cy + 7} ${cx - 5},${cy - 3} ${cx + 5},${cy - 3}`}
            fill="#c85a50" opacity="0.7" />
        })}

        {/* 圖例 */}
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
