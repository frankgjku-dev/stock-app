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
          <div style={{ position: 'relative' }}>
            <input
              className="analysis-input"
              placeholder="代碼或名稱"
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

          {/* 產業分析 */}
          {(data.sector || data.industry) && data.industry_heat && (
            <div style={{
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 10, padding: '14px 18px', marginBottom: 12,
            }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-1)', marginBottom: 10 }}>
                🏭 產業分析
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 20px', marginBottom: 10 }}>
                {data.sector && (
                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>所屬板塊　</span>
                    <span style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 600 }}>{data.sector}</span>
                  </div>
                )}
                {data.industry && (
                  <div>
                    <span style={{ fontSize: 11, color: 'var(--text-3)' }}>細分產業　</span>
                    <span style={{ fontSize: 13, color: 'var(--text-1)', fontWeight: 600 }}>{data.industry}</span>
                  </div>
                )}
                <div>
                  <span style={{ fontSize: 11, color: 'var(--text-3)' }}>產業熱度　</span>
                  <span style={{
                    fontSize: 13, fontWeight: 700,
                    color: data.industry_heat.color,
                  }}>
                    {data.industry_heat.level} {data.industry_heat.label}
                  </span>
                </div>
              </div>
              <div style={{
                fontSize: 12, color: 'var(--text-2)', lineHeight: 1.6,
                borderTop: '1px solid var(--border)', paddingTop: 8,
              }}>
                {data.industry_heat.note}
                {data.industry_heat.watch
                  ? <span style={{ marginLeft: 8, color: '#26a69a', fontWeight: 600 }}>✅ 建議關注</span>
                  : <span style={{ marginLeft: 8, color: 'var(--text-3)' }}>⏳ 暫時觀望</span>
                }
              </div>
            </div>
          )}

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

            {/* VCP 型態（完整版） */}
            <div className="ar-card">
              <div className="ar-card-title">
                🔁 VCP 型態
                <span className="ar-vcp-badge">{data.vcp_count} 段收縮</span>
                {data.vcp_score > 0 && (
                  <span className="ar-vcp-score">{data.vcp_score}分</span>
                )}
              </div>
              {data.vcp_pullbacks.length === 0 ? (
                <div className="ar-empty">未偵測到符合條件的 VCP 型態<br/>
                  <span style={{fontSize:11,opacity:0.7}}>需：深度遞減＋低點墊高＋每段縮小≥20%</span>
                </div>
              ) : (
                <div className="ar-vcps">
                  {/* 回檔明細 */}
                  {data.vcp_pullbacks.map((p, i) => (
                    <div key={i} className="ar-vcp-row">
                      <span className="ar-vcp-idx">第 {i+1} 段</span>
                      <span>${p.peak}</span>
                      <span className="down">↓{p.depth_pct}%</span>
                      <span>${p.trough}</span>
                      {p.peak_date && (
                        <span style={{ fontSize: 10, color: 'var(--text-3)', marginLeft: 4 }}>
                          {p.peak_date.slice(5)} → {p.trough_date?.slice(5)}
                        </span>
                      )}
                    </div>
                  ))}
                  {/* 型態標籤 */}
                  <div className="ar-vcp-tags">
                    {data.higher_lows && <span className="ar-tag green">低點墊高✓</span>}
                    {data.vol_contracting && <span className="ar-tag green">量能萎縮✓</span>}
                    {data.base_days > 0 && <span className="ar-tag">整理{data.base_days}日</span>}
                  </div>
                  {/* 樞紐點 */}
                  {data.pivot_price && (
                    <div className="ar-pivot-line">
                      📌 樞紐點（買入觸發）：<strong>${data.pivot_price}</strong>
                      {data.dist_to_pivot !== null && (
                        <span className={data.dist_to_pivot <= 0 ? 'up' : data.dist_to_pivot <= 3 ? 'warning-text' : 'flat'}>
                          　{data.dist_to_pivot > 0 ? `距離 +${data.dist_to_pivot}%` : `已突破 ${Math.abs(data.dist_to_pivot)}%`}
                        </span>
                      )}
                    </div>
                  )}
                  {/* 狀態 */}
                  {data.buy_status && data.buy_status !== '—' && (
                    <div className="ar-buy-status">
                      現況：<strong>{data.buy_status}</strong>
                    </div>
                  )}
                  {/* VCP 評分細節 */}
                  {data.vcp_details?.length > 0 && (
                    <div className="ar-vcp-detail-list">
                      {data.vcp_details.map((d, i) => <span key={i} className="ar-vcp-detail">{d}</span>)}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* HL5MA 策略 */}
            <div className="ar-card">
              <div className="ar-card-title">
                📈 HL 5MA 策略
                {data.hl5ma_valid
                  ? <span className="ar-vcp-badge" style={{background:'#26a69a33',color:'#26a69a',borderColor:'#26a69a55'}}>{data.hl5ma_count} 個 HL</span>
                  : <span className="ar-vcp-badge">尚未形成</span>
                }
                {data.hl5ma_entry && <span className="ar-vcp-score" style={{background:'#26a69a',color:'#fff'}}>⚡ 買點</span>}
                {data.hl5ma_in_recovery && !data.hl5ma_entry && (
                  <span className="ar-vcp-score" style={{background:'#0288d1',color:'#fff'}}>🔄 確認期</span>
                )}
              </div>

              {/* HL 列表 */}
              {data.hl5ma_points?.length > 0 ? (
                <div className="ar-vcps">
                  {data.hl5ma_points.map((p, i) => (
                    <div key={i} className="ar-vcp-row">
                      <span className="ar-vcp-idx">HL{i + 1}</span>
                      <span className="up">${p.price}</span>
                      <span style={{fontSize:10,color:'var(--text-3)'}}>{p.date?.slice(5)}</span>
                      <span style={{fontSize:10,color:'var(--text-3)'}}>突破 {p.entry_price}</span>
                      {p.vol_ok
                        ? <span className="ar-tag green" style={{fontSize:9}}>量✓</span>
                        : <span className="ar-tag"       style={{fontSize:9}}>量✗</span>
                      }
                      {p.ma5_rising != null && (
                        p.ma5_rising
                          ? <span className="ar-tag green" style={{fontSize:9}}>扣抵↑</span>
                          : <span className="ar-tag"       style={{fontSize:9}}>扣抵↓</span>
                      )}
                    </div>
                  ))}

                  {/* 關鍵價位 */}
                  <div style={{marginTop:8,display:'flex',flexDirection:'column',gap:4}}>
                    <div className="ar-level-row">
                      <span className="ar-level-label">5MA</span>
                      <span className="ar-level-val">${data.hl5ma_ma5}</span>
                      <span style={{
                        fontSize:10, marginLeft:6,
                        color: data.hl5ma_ma5_rising ? '#26a69a' : '#aaa'
                      }}>
                        {data.hl5ma_ma5_rising ? '↑上彎（扣抵↑）' : '持平/下彎'}
                      </span>
                    </div>
                    {data.hl5ma_swing_high > 0 && (
                      <div className="ar-level-row">
                        <span className="ar-level-label">待突破前高</span>
                        <span className="ar-level-val" style={{color:'var(--accent)'}}>${data.hl5ma_swing_high}</span>
                      </div>
                    )}
                    <div className="ar-level-row">
                      <span className="ar-level-label">前 HL（停損參考）</span>
                      <span className="ar-level-val down">${data.hl5ma_prev_hl}</span>
                    </div>
                  </div>

                  {/* 當前狀態 */}
                  {data.hl5ma_entry && (
                    <div className="ar-buy-status" style={{color:'#26a69a',marginTop:6}}>
                      ⚡ 今日突破前高 + 5MA上彎 + 量放大，符合進場條件
                    </div>
                  )}
                  {data.hl5ma_in_recovery && !data.hl5ma_entry && (
                    <div className="ar-buy-status" style={{color:'#0288d1',marginTop:6}}>
                      🔄 已站回 5MA，等收盤突破前高（{data.hl5ma_swing_high}）才確認 HL
                      {!data.hl5ma_ma5_rising && <span style={{color:'#e0a800',marginLeft:6}}>⚠️ 5MA 尚未上彎</span>}
                    </div>
                  )}
                  {data.hl5ma_in_pullback && (
                    <div className="ar-buy-status" style={{marginTop:6}}>
                      🔻 回檔中，最低 ${data.hl5ma_pullback_low}
                      {data.hl5ma_prev_hl > 0 && (
                        <span style={{
                          marginLeft:6, fontSize:11,
                          color: data.hl5ma_pullback_low < data.hl5ma_prev_hl ? '#c85a50' : '#26a69a'
                        }}>
                          {data.hl5ma_pullback_low < data.hl5ma_prev_hl ? '⚠️ 已跌破前HL' : '前HL守住✓'}
                        </span>
                      )}
                    </div>
                  )}
                  {!data.hl5ma_in_pullback && !data.hl5ma_in_recovery && !data.hl5ma_entry && data.hl5ma_valid && (
                    <div className="ar-buy-status" style={{marginTop:6}}>
                      等待回踩 5MA 形成下一個 HL
                    </div>
                  )}
                </div>
              ) : (
                <div className="ar-empty">
                  尚未形成有效 HL 結構<br/>
                  <span style={{fontSize:11,opacity:0.7}}>需：收盤突破前高確認 ≥2 個 Higher Low</span>
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
