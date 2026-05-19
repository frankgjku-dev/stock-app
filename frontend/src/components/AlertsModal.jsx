import { useState, useEffect, useRef } from 'react'
import { API_BASE } from '../config'

export default function AlertsModal({ alerts, onAdd, onRemove, onClose }) {
  const [stockPool, setStockPool]   = useState({})
  const [symInput,  setSymInput]    = useState('')
  const [symQuery,  setSymQuery]    = useState('')
  const [dropOpen,  setDropOpen]    = useState(false)
  const [price,     setPrice]       = useState('')
  const [type,      setType]        = useState('above')
  const dropRef = useRef(null)

  /* 載入股票清單（後端返回 [{symbol, name}] array） */
  useEffect(() => {
    fetch(`${API_BASE}/api/stocks/list`)
      .then(r => r.json())
      .then(arr => {
        // 轉成 { symbol: name } dict 方便查找
        const pool = {}
        if (Array.isArray(arr)) arr.forEach(({ symbol, name }) => { pool[symbol] = name })
        setStockPool(pool)
      })
      .catch(() => {})
  }, [])

  /* 點外面關下拉 */
  useEffect(() => {
    function handler(e) {
      if (dropRef.current && !dropRef.current.contains(e.target)) setDropOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const filtered = symQuery.length >= 1
    ? Object.entries(stockPool)
        .filter(([k, v]) => k.includes(symQuery) || v.includes(symQuery))
        .slice(0, 10)
    : []

  function handleAdd() {
    const sym = symInput.trim().toUpperCase()
    if (!sym || !price) return
    const name = stockPool[sym] || stockPool[sym.toLowerCase()] || ''
    onAdd({
      id: Date.now(),
      symbol: sym,
      name,
      price: parseFloat(price),
      type,
      triggered: false,
      triggeredAt: null,
    })
    setSymInput('')
    setSymQuery('')
    setPrice('')
    setType('above')
  }

  const active    = alerts.filter(a => !a.triggered)
  const triggered = alerts.filter(a => a.triggered)

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="alerts-modal">
        {/* Header */}
        <div className="alerts-modal-header">
          <span>🔔 價格警示</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {/* Add form */}
        <div className="alerts-form">
          <div className="alerts-form-row">
            {/* Symbol search */}
            <div ref={dropRef} style={{ position: 'relative' }}>
              <input
                className="alerts-input"
                placeholder="代號，如 2330"
                value={symInput}
                onChange={e => {
                  setSymInput(e.target.value)
                  setSymQuery(e.target.value)
                  setDropOpen(true)
                }}
                onFocus={() => symQuery && setDropOpen(true)}
                style={{ minWidth: 100 }}
              />
              {dropOpen && filtered.length > 0 && (
                <div className="search-dropdown" style={{ top: '100%', left: 0, minWidth: 180, zIndex: 500 }}>
                  {filtered.map(([k, v]) => (
                    <div
                      key={k}
                      className="search-item"
                      onMouseDown={() => {
                        setSymInput(k)
                        setSymQuery(k)
                        setDropOpen(false)
                      }}
                    >
                      <span className="search-sym">{k}</span>
                      <span className="search-name">{v}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Price */}
            <input
              className="alerts-input"
              type="number"
              placeholder="目標價"
              value={price}
              onChange={e => setPrice(e.target.value)}
              style={{ minWidth: 90, width: 90 }}
            />

            {/* Type */}
            <select
              className="alerts-select"
              value={type}
              onChange={e => setType(e.target.value)}
            >
              <option value="above">突破（漲過）</option>
              <option value="below">跌破（跌破）</option>
            </select>

            <button className="alerts-add-btn" onClick={handleAdd}>＋ 新增</button>
          </div>
        </div>

        {/* Active alerts */}
        <div className="alerts-section-title">啟用中</div>
        {active.length === 0
          ? <div className="alerts-empty">尚無啟用中的警示</div>
          : active.map(a => (
            <AlertRow key={a.id} alert={a} onRemove={onRemove} />
          ))
        }

        {/* Triggered alerts */}
        {triggered.length > 0 && (
          <>
            <div className="alerts-section-title">已觸發</div>
            {triggered.map(a => (
              <AlertRow key={a.id} alert={a} onRemove={onRemove} />
            ))}
          </>
        )}
      </div>
    </div>
  )
}

function AlertRow({ alert, onRemove }) {
  const { id, symbol, name, type, price, triggered, triggeredAt } = alert
  return (
    <div className={`alert-row${triggered ? ' triggered' : ''}`}>
      <span className="alert-sym">{symbol}</span>
      <span className="alert-name">{name}</span>
      <span className={`alert-type ${type === 'above' ? 'above' : 'below'}`}>
        {type === 'above' ? '↑突破' : '↓跌破'}
      </span>
      <span className="alert-price">{price.toFixed(2)}</span>
      {triggeredAt && <span className="alert-triggered-at">{triggeredAt}</span>}
      <button className="alert-del" onClick={() => onRemove(id)}>✕</button>
    </div>
  )
}
