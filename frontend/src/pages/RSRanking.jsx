import { useState } from 'react'
import { API_BASE } from '../config'

const API = `${API_BASE}/api/rs-ranking`

export default function RSRanking({ watchlist, onSelectStock }) {
  const [rows,    setRows]    = useState([])
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const [scanned, setScanned] = useState(false)

  /* Collect all unique symbols from watchlist groups */
  const watchSymbols = [...new Set(
    (watchlist?.groups || []).flatMap(g => g.stocks || [])
  )]

  async function fetchRS(symbols) {
    setLoading(true)
    setError(null)
    try {
      const qs = symbols.length ? `?symbols=${symbols.join(',')}` : ''
      const res = await fetch(`${API}${qs}`)
      const data = await res.json()
      setRows(data.data || [])
      setScanned(true)
    } catch (e) {
      setError('無法取得資料，請稍後再試')
    } finally {
      setLoading(false)
    }
  }

  function handleWatchlist() {
    if (watchSymbols.length === 0) return
    fetchRS(watchSymbols)
  }

  function handleFullScan() {
    if (!window.confirm('全市場掃描需要較長時間（約 30–60 秒），確定繼續？')) return
    fetchRS([])
  }

  const medals = ['🥇', '🥈', '🥉']

  return (
    <div className="rs-page">
      <div className="rs-header">
        <span className="rs-title">💪 RS 排行榜</span>
        <span className="rs-desc">RS = 相對 0050 的超額報酬（越高越強勢）</span>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {watchSymbols.length > 0 ? (
          <button
            className="rs-scan-btn"
            onClick={handleWatchlist}
            disabled={loading}
          >
            計算 RS 排行（自選股 {watchSymbols.length} 檔）
          </button>
        ) : (
          <span className="rs-hint">請先在自選股清單中加入股票，或使用全市場掃描</span>
        )}
        <button
          className="rs-scan-btn secondary"
          onClick={handleFullScan}
          disabled={loading}
        >
          全市場掃描
        </button>
      </div>

      {loading && (
        <div className="rs-loading">
          <span>計算中… 約需 15 秒，請稍候</span>
        </div>
      )}

      {error && (
        <div style={{ color: '#c85a50', fontSize: 13, padding: '8px 0' }}>{error}</div>
      )}

      {!loading && scanned && rows.length === 0 && (
        <div className="rs-hint">無法取得任何股票的 RS 資料，請稍後再試</div>
      )}

      {!loading && rows.length > 0 && (
        <table className="rs-table">
          <thead>
            <tr>
              <th>排名</th>
              <th>代號</th>
              <th>名稱</th>
              <th>RS分數</th>
              <th>3個月</th>
              <th>6個月</th>
              <th>12個月</th>
              <th>現價</th>
              <th>看K線</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.symbol}>
                <td>
                  <span className={`rs-rank${i < 3 ? ` rs-medal-${i + 1}` : ''}`}>
                    {i < 3 ? medals[i] : i + 1}
                  </span>
                </td>
                <td style={{ fontWeight: 700, color: 'var(--accent)' }}>{r.symbol}</td>
                <td style={{ fontSize: 12, color: 'var(--text-2)' }}>{r.name}</td>
                <td>
                  <span className={r.rs > 0 ? 'rs-pos' : r.rs < 0 ? 'rs-neg' : ''}>
                    {r.rs > 0 ? '+' : ''}{r.rs}
                  </span>
                </td>
                <td>
                  <span className={r.ch3 > 0 ? 'rs-pos' : r.ch3 < 0 ? 'rs-neg' : ''}>
                    {r.ch3 > 0 ? '+' : ''}{r.ch3}%
                  </span>
                </td>
                <td>
                  <span className={r.ch6 > 0 ? 'rs-pos' : r.ch6 < 0 ? 'rs-neg' : ''}>
                    {r.ch6 > 0 ? '+' : ''}{r.ch6}%
                  </span>
                </td>
                <td>
                  <span className={r.ch12 > 0 ? 'rs-pos' : r.ch12 < 0 ? 'rs-neg' : ''}>
                    {r.ch12 > 0 ? '+' : ''}{r.ch12}%
                  </span>
                </td>
                <td>{r.price}</td>
                <td>
                  <button
                    className="rs-chart-btn"
                    onClick={() => onSelectStock(r.symbol)}
                  >
                    看K線
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
