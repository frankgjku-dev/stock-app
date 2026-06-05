import { useState, useEffect, useCallback } from 'react'
import { API_BASE } from '../config'

export default function Holdings({ holdings, onRemove, onUpdate, onSelectStock }) {
  const [prices,        setPrices]       = useState({})
  const [loading,       setLoading]      = useState(false)
  const [editTarget,    setEditTarget]   = useState(null)
  const [editTargetVal, setEditTargetVal] = useState('')
  const [editNote,      setEditNote]     = useState(null)   // id of row being edited
  const [editNoteVal,   setEditNoteVal]  = useState('')
  const [showSold,      setShowSold]     = useState(true)

  // ── 賣出 Modal 狀態 ──
  const [sellModal,     setSellModal]    = useState(null)   // { id, symbol, entryPrice, shares }
  const [sellPrice,     setSellPrice]    = useState('')
  const [sellDate,      setSellDate]     = useState(() => new Date().toISOString().slice(0, 10))

  const activeHoldings = holdings.filter(h => h.status !== 'sold')
  const soldHoldings   = holdings.filter(h => h.status === 'sold')

  const fetchPrices = useCallback(async () => {
    if (!activeHoldings.length) return
    setLoading(true)
    const results = {}
    await Promise.all(activeHoldings.map(async h => {
      try {
        const r    = await fetch(`${API_BASE}/api/stocks/${h.symbol}/quote`)
        const data = await r.json()
        if (data.price != null && !data.error) results[h.symbol] = data
      } catch {}
    }))
    setPrices(prev => ({ ...prev, ...results }))
    setLoading(false)
  }, [activeHoldings])

  useEffect(() => {
    fetchPrices()
    const id = setInterval(fetchPrices, 30000)
    return () => clearInterval(id)
  }, [fetchPrices])

  const rows = activeHoldings.map(h => {
    const q            = prices[h.symbol]
    const curPrice     = q?.price      ?? null
    const changePct    = q?.change_pct ?? null
    const change       = q?.change     ?? null
    const source       = q?.source     ?? null
    const pnlPct       = curPrice != null ? (curPrice - h.entryPrice) / h.entryPrice * 100 : null
    const pnlAmt       = curPrice != null ? (curPrice - h.entryPrice) * h.shares : null
    const distToStop   = curPrice != null ? (curPrice - h.stopPrice)  / curPrice * 100 : null
    const distToTarget = (curPrice != null && h.targetPrice)
      ? (h.targetPrice - curPrice) / curPrice * 100 : null
    return { ...h, curPrice, changePct, change, source, pnlPct, pnlAmt, distToStop, distToTarget }
  })

  const soldRows = soldHoldings.map(h => {
    const realPnlPct = h.sellPrice != null
      ? (h.sellPrice - h.entryPrice) / h.entryPrice * 100 : null
    const realPnlAmt = h.sellPrice != null
      ? (h.sellPrice - h.entryPrice) * h.shares : null
    const holdDays = (h.entryDate && h.sellDate)
      ? Math.round((new Date(h.sellDate) - new Date(h.entryDate)) / 86400000) : null
    return { ...h, realPnlPct, realPnlAmt, holdDays }
  })

  const totalPnl = rows.reduce((s, r) => s + (r.pnlAmt ?? 0), 0)
  const hasPrice = rows.some(r => r.curPrice != null)

  // 已實現損益統計
  const realizedTotal = soldRows.reduce((s, r) => s + (r.realPnlAmt ?? 0), 0)

  const fmt  = n => n >= 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%`
  const fmtN = n => `${n >= 0 ? '+' : '-'}NT$${Math.round(Math.abs(n)).toLocaleString()}`

  function startEditTarget(r) {
    setEditTarget(r.id)
    setEditTargetVal(r.targetPrice ? String(r.targetPrice) : '')
  }
  function commitEditTarget(id) {
    const val = parseFloat(editTargetVal)
    if (!isNaN(val) && val > 0) {
      onUpdate(id, { targetPrice: val, targetR: null })
    } else if (editTargetVal === '') {
      onUpdate(id, { targetPrice: null, targetR: null })
    }
    setEditTarget(null)
  }

  // ── 備註 ──
  function startEditNote(r) {
    setEditNote(r.id)
    setEditNoteVal(r.note || '')
  }
  function commitEditNote(id) {
    onUpdate(id, { note: editNoteVal.trim() })
    setEditNote(null)
  }

  // ── 賣出 ──
  function openSellModal(r) {
    setSellModal({ id: r.id, symbol: r.symbol, entryPrice: r.entryPrice, shares: r.shares })
    setSellPrice('')
    setSellDate(new Date().toISOString().slice(0, 10))
  }
  function confirmSell() {
    const sp = parseFloat(sellPrice)
    if (!sellModal || isNaN(sp) || sp <= 0) return
    onUpdate(sellModal.id, {
      status:    'sold',
      sellPrice: sp,
      sellDate,
    })
    setSellModal(null)
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

      {/* ── 賣出 Modal ── */}
      {sellModal && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)',
          zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }} onClick={() => setSellModal(null)}>
          <div style={{
            background: '#1e222d', border: '1px solid #363a45',
            borderRadius: 10, padding: '28px 32px', minWidth: 300,
            boxShadow: '0 8px 32px rgba(0,0,0,.5)',
          }} onClick={e => e.stopPropagation()}>
            <div style={{ fontSize: 17, fontWeight: 700, marginBottom: 18, color: '#e0e3eb' }}>
              💰 賣出 {sellModal.symbol}
            </div>
            <div style={{ marginBottom: 14 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 5 }}>賣出日期</div>
              <input
                type="date"
                value={sellDate}
                onChange={e => setSellDate(e.target.value)}
                style={{
                  width: '100%', padding: '7px 10px',
                  background: '#131722', color: '#e0e3eb',
                  border: '1px solid #363a45', borderRadius: 6, fontSize: 14,
                }}
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 12, color: 'var(--text-3)', marginBottom: 5 }}>賣出價格</div>
              <input
                autoFocus
                type="number" step="0.1"
                placeholder="輸入賣出價"
                value={sellPrice}
                onChange={e => setSellPrice(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') confirmSell(); if (e.key === 'Escape') setSellModal(null) }}
                style={{
                  width: '100%', padding: '7px 10px',
                  background: '#131722', color: '#e0e3eb',
                  border: '1px solid #363a45', borderRadius: 6, fontSize: 14,
                }}
              />
              {/* 預覽損益 */}
              {parseFloat(sellPrice) > 0 && (
                <div style={{ marginTop: 8, fontSize: 13 }}>
                  {(() => {
                    const sp = parseFloat(sellPrice)
                    const pct = (sp - sellModal.entryPrice) / sellModal.entryPrice * 100
                    const amt = (sp - sellModal.entryPrice) * sellModal.shares
                    return (
                      <span style={{ color: pct >= 0 ? '#4caf50' : '#ef5350' }}>
                        {fmt(pct)} ／ {fmtN(amt)}
                      </span>
                    )
                  })()}
                </div>
              )}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={confirmSell}
                disabled={!sellPrice || isNaN(parseFloat(sellPrice))}
                style={{
                  flex: 1, padding: '9px 0', borderRadius: 6,
                  background: '#26a69a', color: '#fff', border: 'none',
                  fontWeight: 700, fontSize: 14, cursor: 'pointer',
                  opacity: (!sellPrice || isNaN(parseFloat(sellPrice))) ? .45 : 1,
                }}
              >確認賣出</button>
              <button
                onClick={() => setSellModal(null)}
                style={{
                  flex: 1, padding: '9px 0', borderRadius: 6,
                  background: '#2a2e39', color: '#9098a1', border: 'none',
                  fontSize: 14, cursor: 'pointer',
                }}
              >取消</button>
            </div>
          </div>
        </div>
      )}

      {/* ── 摘要列 ── */}
      <div className="hd-summary">
        <div className="hd-sum-item">
          <span className="hd-sum-label">持倉中</span>
          <span className="hd-sum-val">{activeHoldings.length} 檔</span>
        </div>
        {hasPrice && (
          <div className="hd-sum-item">
            <span className="hd-sum-label">未實現損益</span>
            <span className={`hd-sum-val ${totalPnl >= 0 ? 'up' : 'down'}`}>
              {totalPnl >= 0 ? '+' : ''}NT${Math.round(Math.abs(totalPnl)).toLocaleString()}
            </span>
          </div>
        )}
        {soldRows.length > 0 && (
          <div className="hd-sum-item">
            <span className="hd-sum-label">已實現損益</span>
            <span className={`hd-sum-val ${realizedTotal >= 0 ? 'up' : 'down'}`}>
              {realizedTotal >= 0 ? '+' : ''}NT${Math.round(Math.abs(realizedTotal)).toLocaleString()}
            </span>
          </div>
        )}
        <button className="hd-refresh" onClick={fetchPrices} disabled={loading}>
          {loading ? '更新中…' : '🔄 更新報價'}
        </button>
      </div>

      {/* ── 持倉中表格 ── */}
      {activeHoldings.length > 0 && (
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
                <th>備註</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const stopWarn   = r.distToStop != null && r.distToStop < 5
                const stopDanger = r.distToStop != null && r.distToStop < 2
                return (
                  <tr key={r.id} className={stopDanger ? 'hd-danger' : stopWarn ? 'hd-warn' : ''}>
                    <td
                      onClick={() => onSelectStock(r.symbol)}
                      style={{ cursor: 'pointer' }}
                      title="點擊查看 K 線"
                    >
                      <div className="hd-sym" style={{ color: 'var(--accent)' }}>{r.symbol}</div>
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
                      ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
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
                            ? <span style={{ color: '#c85a50', fontWeight: 700 }}>⚠️ 已跌破停損</span>
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
                            style={{ background: '#26a69a', color: '#fff', border: 'none',
                              borderRadius: 4, padding: '2px 6px', cursor: 'pointer', fontSize: 12 }}>✓</button>
                          <button onClick={() => setEditTarget(null)}
                            style={{ background: 'transparent', color: '#787b86', border: 'none',
                              cursor: 'pointer', fontSize: 13 }}>✕</button>
                        </div>
                      ) : (
                        <div onClick={() => startEditTarget(r)} title="點擊編輯止盈價"
                          style={{ cursor: 'pointer' }}>
                          {r.targetPrice
                            ? <>
                                <div>${Number(r.targetPrice).toFixed(2)}</div>
                                {r.targetR && <div style={{ fontSize: 11, color: '#787b86' }}>{r.targetR}R</div>}
                              </>
                            : <span style={{ color: 'var(--text-3)', fontSize: 12 }}>點擊設定</span>}
                        </div>
                      )}
                    </td>

                    {/* 距止盈 */}
                    <td className={
                      r.distToTarget == null ? '' :
                      r.distToTarget <= 0   ? 'up' :
                      r.distToTarget < 5    ? 'hd-target-near' : ''
                    }>
                      {r.distToTarget != null
                        ? (r.distToTarget <= 0
                            ? <span style={{ color: '#4caf50', fontWeight: 700 }}>🎯 已達目標</span>
                            : `${r.distToTarget.toFixed(1)}%`)
                        : '—'}
                    </td>

                    {/* 備註 */}
                    <td style={{ minWidth: 120, maxWidth: 200 }}>
                      {editNote === r.id ? (
                        <div style={{ display: 'flex', gap: 4 }}>
                          <input
                            autoFocus
                            value={editNoteVal}
                            onChange={e => setEditNoteVal(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') commitEditNote(r.id); if (e.key === 'Escape') setEditNote(null) }}
                            onBlur={() => commitEditNote(r.id)}
                            style={{
                              flex: 1, padding: '3px 7px', fontSize: 12,
                              background: 'var(--surface-2)', color: 'var(--text-1)',
                              border: '1px solid var(--accent)', borderRadius: 4, outline: 'none',
                            }}
                            placeholder="輸入備註…"
                          />
                        </div>
                      ) : (
                        <div
                          onClick={() => startEditNote(r)}
                          title="點擊編輯備註"
                          style={{
                            cursor: 'pointer', fontSize: 12, color: r.note ? 'var(--text-1)' : 'var(--text-3)',
                            minHeight: 22, padding: '2px 4px', borderRadius: 4,
                            border: '1px dashed transparent',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                          }}
                          onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-md)'}
                          onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
                        >
                          {r.note || '+ 備註'}
                        </div>
                      )}
                    </td>

                    <td>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button className="hd-btn hd-chart"
                          onClick={() => onSelectStock(r.symbol)} title="查K線">📈</button>
                        <button
                          onClick={() => openSellModal(r)}
                          title="標記為已賣出"
                          style={{
                            background: 'transparent', border: '1px solid #26a69a',
                            color: '#26a69a', borderRadius: 5,
                            width: 28, height: 28, cursor: 'pointer',
                            fontSize: 13, display: 'flex', alignItems: 'center', justifyContent: 'center',
                          }}>
                          💰
                        </button>
                        <button className="hd-btn hd-del"
                          onClick={() => { if (confirm(`確認移除 ${r.symbol}？`)) onRemove(r.id) }}
                          title="移除">✕</button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {activeHoldings.length === 0 && soldHoldings.length > 0 && (
        <div style={{ textAlign: 'center', padding: '32px 0', color: 'var(--text-3)', fontSize: 14 }}>
          目前無持倉中個股
        </div>
      )}

      {/* ── 已完成交易 ── */}
      {soldRows.length > 0 && (
        <div style={{ marginTop: 24 }}>
          <div
            style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '10px 4px', cursor: 'pointer', userSelect: 'none',
            }}
            onClick={() => setShowSold(v => !v)}
          >
            <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-1)' }}>
              ✅ 已完成交易
            </span>
            <span style={{
              background: 'var(--down-dim)', color: 'var(--down)',
              borderRadius: 10, fontSize: 12, padding: '1px 8px', fontWeight: 600,
            }}>{soldRows.length} 筆</span>
            <span style={{ marginLeft: 'auto', color: 'var(--text-3)', fontSize: 13 }}>
              {showSold ? '▲ 收起' : '▼ 展開'}
            </span>
          </div>

          {showSold && (
            <div className="hd-table-wrap">
              <table className="hd-table">
                <thead>
                  <tr>
                    <th>代碼 / 名稱</th>
                    <th>進場日</th>
                    <th>進場價</th>
                    <th>賣出日</th>
                    <th>賣出價</th>
                    <th>張數</th>
                    <th>持有天數</th>
                    <th>損益 %</th>
                    <th>已實現損益</th>
                    <th>備註</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {soldRows.map(r => (
                    <tr key={r.id} style={{ opacity: .85 }}>
                      <td>
                        <div className="hd-sym">{r.symbol}</div>
                        <div className="hd-name">{r.name || '—'}</div>
                      </td>
                      <td>{r.entryDate}</td>
                      <td>${r.entryPrice.toFixed(1)}</td>
                      <td>{r.sellDate || '—'}</td>
                      <td>{r.sellPrice != null ? `$${Number(r.sellPrice).toFixed(1)}` : '—'}</td>
                      <td>{r.lots} 張</td>
                      <td style={{ color: 'var(--text-3)' }}>
                        {r.holdDays != null ? `${r.holdDays} 天` : '—'}
                      </td>
                      <td className={r.realPnlPct != null ? (r.realPnlPct >= 0 ? 'up' : 'down') : ''}>
                        {r.realPnlPct != null ? fmt(r.realPnlPct) : '—'}
                      </td>
                      <td className={r.realPnlAmt != null ? (r.realPnlAmt >= 0 ? 'up' : 'down') : ''}>
                        {r.realPnlAmt != null ? fmtN(r.realPnlAmt) : '—'}
                      </td>
                      {/* 備註 */}
                      <td style={{ minWidth: 120, maxWidth: 200 }}>
                        {editNote === r.id ? (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <input
                              autoFocus
                              value={editNoteVal}
                              onChange={e => setEditNoteVal(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter') commitEditNote(r.id); if (e.key === 'Escape') setEditNote(null) }}
                              onBlur={() => commitEditNote(r.id)}
                              style={{
                                flex: 1, padding: '3px 7px', fontSize: 12,
                                background: 'var(--surface-2)', color: 'var(--text-1)',
                                border: '1px solid var(--accent)', borderRadius: 4, outline: 'none',
                              }}
                              placeholder="輸入備註…"
                            />
                          </div>
                        ) : (
                          <div
                            onClick={() => startEditNote(r)}
                            title="點擊編輯備註"
                            style={{
                              cursor: 'pointer', fontSize: 12, color: r.note ? 'var(--text-1)' : 'var(--text-3)',
                              minHeight: 22, padding: '2px 4px', borderRadius: 4,
                              border: '1px dashed transparent', whiteSpace: 'pre-wrap', wordBreak: 'break-all',
                            }}
                            onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-md)'}
                            onMouseLeave={e => e.currentTarget.style.borderColor = 'transparent'}
                          >
                            {r.note || '+ 備註'}
                          </div>
                        )}
                      </td>
                      <td>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button className="hd-btn hd-chart"
                            onClick={() => onSelectStock(r.symbol)} title="查K線">📈</button>
                          <button
                            onClick={() => { if (confirm(`將 ${r.symbol} 移回持倉中？`)) onUpdate(r.id, { status: 'active', sellPrice: null, sellDate: null }) }}
                            title="移回持倉"
                            style={{
                              background: 'transparent', border: '1px solid #787b86',
                              color: '#787b86', borderRadius: 5,
                              width: 28, height: 28, cursor: 'pointer',
                              fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>↩</button>
                          <button className="hd-btn hd-del"
                            onClick={() => { if (confirm(`確認刪除 ${r.symbol} 紀錄？`)) onRemove(r.id) }}
                            title="刪除">✕</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
