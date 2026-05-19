import { useState, useEffect } from 'react'
import { API_BASE } from '../config'

function fmt(n) {
  if (n === 0) return '0'
  const k = Math.round(n / 1000)
  if (Math.abs(k) >= 1000) return (k / 1000).toFixed(1) + 'M'
  if (Math.abs(k) >= 1)    return k + 'K'
  return n.toString()
}

function NumCell({ v }) {
  if (v > 0) return <td className="inst-pos">+{fmt(v)}</td>
  if (v < 0) return <td className="inst-neg">{fmt(v)}</td>
  return <td className="inst-zero">0</td>
}

export default function Institutional({ symbol }) {
  const [data,    setData]    = useState([])
  const [loading, setLoading] = useState(false)
  const [open,    setOpen]    = useState(false)

  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch(`${API_BASE}/api/stocks/${symbol}/institutional`)
      .then(r => r.json())
      .then(d => setData(d.data || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  }, [symbol, open])

  // re-fetch when symbol changes (if already open)
  useEffect(() => {
    if (!open) return
    setLoading(true)
    fetch(`${API_BASE}/api/stocks/${symbol}/institutional`)
      .then(r => r.json())
      .then(d => setData(d.data || []))
      .catch(() => setData([]))
      .finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol])

  const maxAbs = data.length
    ? Math.max(...data.map(r => Math.abs(r.total_net)), 1)
    : 1

  return (
    <div className="institutional-panel">
      <div className="inst-header" onClick={() => setOpen(o => !o)}>
        <span className="inst-title">📊 法人籌碼</span>
        <span className="inst-toggle">{open ? '▲ 收合' : '▼ 展開'}</span>
      </div>

      {open && (
        <div className="inst-body">
          {loading && (
            <div style={{ padding: '12px 0', fontSize: 12, color: 'var(--text-3)' }}>載入中…</div>
          )}
          {!loading && data.length === 0 && (
            <div style={{ padding: '12px 0', fontSize: 12, color: 'var(--text-3)' }}>
              暫無資料（可能為假日或資料尚未更新）
            </div>
          )}
          {!loading && data.length > 0 && (
            <>
              <table className="inst-table">
                <thead>
                  <tr>
                    <th>日期</th>
                    <th>外資(張)</th>
                    <th>投信(張)</th>
                    <th>自營商(張)</th>
                    <th>三大合計(張)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.map((row, i) => (
                    <tr key={i}>
                      <td>{row.date}</td>
                      <NumCell v={row.foreign_net} />
                      <NumCell v={row.trust_net} />
                      <NumCell v={row.dealer_net} />
                      <NumCell v={row.total_net} />
                    </tr>
                  ))}
                </tbody>
              </table>

              {/* Mini bar chart */}
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3 }}>
                {data.map((row, i) => {
                  const pct = (row.total_net / maxAbs) * 100
                  const pos = pct >= 0
                  return (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 }}>
                      <span style={{ width: 32, color: 'var(--text-3)', flexShrink: 0 }}>{row.date}</span>
                      <div style={{ flex: 1, display: 'flex', alignItems: 'center', height: 8 }}>
                        {pos ? (
                          <div style={{
                            height: '100%',
                            width: `${Math.abs(pct)}%`,
                            background: '#26a69a',
                            borderRadius: 2,
                          }} />
                        ) : (
                          <div style={{
                            height: '100%',
                            width: `${Math.abs(pct)}%`,
                            background: '#c85a50',
                            borderRadius: 2,
                            marginLeft: 'auto',
                          }} />
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
