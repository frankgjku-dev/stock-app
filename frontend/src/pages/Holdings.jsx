import { useState, useEffect, useCallback } from 'react'
import { API_BASE } from '../config'

export default function Holdings({ holdings, onRemove, onUpdate, onSelectStock }) {
  const [prices,        setPrices]       = useState({})
  const [loading,       setLoading]      = useState(false)
  const [added,         setAdded]        = useState(null)      // flash message
  const [editTarget,    setEditTarget]   = useState(null)      // id of row being edited
  const [editTargetVal, setEditTargetVal] = useState('')       // input value

  const fetchPrices = useCallback(async () => {
    if (!holdings.length) return
    setLoading(true)
    const results = {}
    await Promise.all(holdings.map(async h => {
      try {
        const r    = await fetch(`${API_BASE}/api/stocks/${h.symbol}/quote`)
        const data = await r.json()
        if (data.price != null && !data.error) results[h.symbol] = data
      } catch {}
    }))
    // 用 merge 而非覆蓋：某支股票抓取失敗時保留舊資料
    setPrices(prev => ({ ...prev, ...results }))
    setLoading(false)
  }, [holdings])

  useEffect(() => {
    fetchPrices()
    const id = setInterval(fetchPrices, 30000)
    return () => clearInterval(id)
  }, [fetchPrices])

  const rows = holdings.map(h => {
    const q           = prices[h.symbol]
    const curPrice    = q?.price      ?? null
    const changePct   = q?.change_pct ?? null
    const change      = q?.change     ?? null
    const prevClose   = q?.prev_close ?? null
    const source      = q?.source     ?? null   // 'twse_live' | 'twse_prev_close' | 'yfinance'
    const pnlPct      = curPrice != null ? (curPrice - h.entryPrice) / h.entryPrice * 100 : null
    const pnlAmt      = curPrice != null ? (curPrice - h.entryPrice) * h.shares : null
    const distToStop  = curPrice != null ? (curPrice - h.stopPrice)  / curPrice * 100 : null
    const distToTarget = (curPrice != null && h.targetPrice)
      ? (h.targetPrice - curPrice) / curPrice * 100
      : null
    return { ...h, curPrice, changePct, change, prevClose, source, pnlPct, pnlAmt, distToStop, distToTarget }
  })

  const totalPnl  = rows.reduce((s, r) => s + (r.pnlAmt ?? 0), 0)
  const hasPrice  = rows.some(r => r.curPrice != null)

  const fmt  = n => n >= 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%`
  const fmtN = n => `${n >= 0 ? '+' : ''}NT$${Math.round(Math.abs(n)).toLocaleString()}`

  function startEditTarget(r) {
    setEditTarget(r.id)
    setEditTargetVal(r.targetPrice ? String(r.targetPrice) : '')
  }
  function commitEditTarget(id) {
    const val = parseFloat(editTargetVal)
    if (!isNaN(val) && val > 0) {
      onUpdate(id, { targetPrice: val, targetR: null })  // 手動設定時清除 R 標籤
    } else if (editTargetVal === '') {
      onUpdate(id, { targetPrice: null, targetR: null }) // 清空
    }
    setEditTarget(null)
  }

  if (!holdings.length) {
    return (
      <div className="holdings-page">
        <div className="holdings-empty">
          <span style={{ fontSize: 40 }}>📭</span>
          <div>尚無持倉紀錄</div>
          <div style={{ fontSize: 13, color: 'var(--text-3)', marginTop: 4 }}>
            在「部位計算機」計算完成後，點擊「📌 加入持倉」即可新增
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="holdings-page">
      {/* 摘要列 */}
      <div className="hd-summary">
        <div className="hd-sum-item">
          <span className="hd-sum-label">持倉</span>
          <span className="hd-sum-val">{holdings.length} 檔</span>
        </div>
        {hasPrice && (
          <div className="hd-sum-item">
            <span className="hd-sum-label">未實現損益</span>
            <span className={`hd-sum-val ${totalPnl >= 0 ? 'up' : 'down'}`}>
              {totalPnl >= 0 ? '+' : ''}NT${Math.round(Math.abs(totalPnl)).toLocaleString()}
            </span>
          </div>
        )}
        <button className="hd-refresh" onClick={fetchPrices} disabled={loading}>
          {loading ? '更新中…' : '🔄 更新報價'}
        </button>
      </div>

      {/* 持倉表格 */}
      <div className="hd-table-wrap">
        <table className="hd-table">
          <thead>
            <tr>
              <th>代碼 / 名稱</th>
              <th>進場日</th>
              <th>進場價</th>
              <th>張數</th>
              <th>現價</th>
              <th>損益 %</th>
              <th>損益金額</th>
              <th>停損價</th>
              <th>距停損</th>
              <th>止盈價</th>
              <th>距止盈</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const stopWarn = r.distToStop != null && r.distToStop < 5
              const stopDanger = r.distToStop != null && r.distToStop < 2
              return (
                <tr key={r.id} className={stopDanger ? 'hd-danger' : stopWarn ? 'hd-warn' : ''}>
                  <td>
                    <div className="hd-sym">{r.symbol}</div>
                    <div className="hd-name">{r.name || '—'}</div>
                  </td>
                  <td>{r.entryDate}</td>
                  <td>${r.entryPrice.toFixed(1)}</td>
                  <td>{r.lots} 張</td>
                  <td className="hd-cur">
                    {r.curPrice != null ? (
                      <div style={{ lineHeight: 1.4 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                          <span>${Number(r.curPrice).toFixed(2)}</span>
                          {r.source === 'twse_prev_close' && (
                            <span style={{
                              fontSize: 10, color: '#787b86',
                              background: '#2a2e39', borderRadius: 3,
                              padding: '1px 4px',
                            }} title="市場收盤，顯示最近收盤價">收盤</span>
                          )}
                        </div>
                        {r.changePct != null && (
                          <div style={{
                            fontSize: 11,
                            color: r.changePct > 0 ? '#4caf50' : r.changePct < 0 ? '#ef5350' : '#787b86',
                          }}>
                            {r.changePct > 0 ? '+' : ''}{Number(r.change).toFixed(2)}
                            {' '}({r.changePct > 0 ? '+' : ''}{Number(r.changePct).toFixed(2)}%)
                          </div>
                        )}
                      </div>
                    ) : <span style={{color:'var(--text-3)'}}>—</span>}
                  </td>
                  <td className={r.pnlPct != null ? (r.pnlPct >= 0 ? 'up' : 'down') : ''}>
                    {r.pnlPct != null ? fmt(r.pnlPct) : '—'}
                  </td>
                  <td className={r.pnlAmt != null ? (r.pnlAmt >= 0 ? 'up' : 'down') : ''}>
                    {r.pnlAmt != null ? fmtN(r.pnlAmt) : '—'}
                  </td>
                  <td style={{ color: '#c85a50' }}>${r.stopPrice.toFixed(1)}</td>
                  <td className={
                    r.distToStop == null ? '' :
                    r.distToStop < 2  ? 'down' :
                    r.distToStop < 5  ? 'hd-orange' : ''
                  }>
                    {r.distToStop != null
                      ? (r.distToStop < 0
                          ? <span style={{color:'#c85a50',fontWeight:700}}>⚠️ 已跌破停損</span>
                          : `${r.distToStop.toFixed(1)}%`)
                      : '—'}
                  </td>

                  {/* 止盈價（可點擊編輯）*/}
                  <td style={{ color: '#26a69a', minWidth: 90 }}>
                    {editTarget === r.id ? (
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <input
                          autoFocus
                          type="number" step="0.5"
                          value={editTargetVal}
                          onChange={e => setEditTargetVal(e.target.value)}
                          onKeyDown={e => {
                            if (e.key === 'Enter') commitEditTarget(r.id)
                            if (e.key === 'Escape') setEditTarget(null)
                          }}
                          style={{
                            width: 72, padding: '2px 5px',
                            background: '#1e222d', color: '#26a69a',
                            border: '1px solid #26a69a', borderRadius: 4,
                            fontSize: 13,
                          }}
                        />
                        <button onClick={() => commitEditTarget(r.id)}
                          style={{ background:'#26a69a', color:'#fff', border:'none',
                            borderRadius:4, padding:'2px 6px', cursor:'pointer', fontSize:12 }}>✓</button>
                        <button onClick={() => setEditTarget(null)}
                          style={{ background:'transparent', color:'#787b86', border:'none',
                            cursor:'pointer', fontSize:13 }}>✕</button>
                      </div>
                    ) : (
                      <div
                        onClick={() => startEditTarget(r)}
                        title="點擊編輯止盈價"
                        style={{ cursor: 'pointer' }}
                      >
                        {r.targetPrice
                          ? <>
                              <div>${Number(r.targetPrice).toFixed(2)}</div>
                              {r.targetR && <div style={{ fontSize: 11, color: '#787b86' }}>{r.targetR}R</div>}
                            </>
                          : <span style={{ color:'var(--text-3)', fontSize:12 }}>點擊設定</span>}
                      </div>
                    )}
                  </td>

                  {/* 距止盈 */}
                  <td className={
                    r.distToTarget == null ? '' :
                    r.distToTarget <= 0   ? 'up' :          // 已達目標（漲過止盈）
                    r.distToTarget < 5    ? 'hd-target-near' : '' // 接近目標
                  }>
                    {r.distToTarget != null
                      ? (r.distToTarget <= 0
                          ? <span style={{color:'#4caf50',fontWeight:700}}>🎯 已達目標</span>
                          : `${r.distToTarget.toFixed(1)}%`)
                      : '—'}
                  </td>

                  <td>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button className="hd-btn hd-chart"
                        onClick={() => onSelectStock(r.symbol)} title="查K線">
                        📈
                      </button>
                      <button className="hd-btn hd-del"
                        onClick={() => { if (confirm(`確認移除 ${r.symbol}？`)) onRemove(r.id) }}
                        title="移除">
                        ✕
                      </button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
