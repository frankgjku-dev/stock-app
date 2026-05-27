import { useState, useEffect, useRef, useCallback } from 'react'

export default function StockNotes({ symbol, notes, onChange }) {
  const [open, setOpen] = useState(false)
  const [text, setText] = useState('')
  const timerRef    = useRef(null)
  const textareaRef = useRef(null)

  // 切換股票時讀取該股備註，有備註自動展開
  useEffect(() => {
    const saved = notes[symbol] || ''
    setText(saved)
    setOpen(!!saved.trim())
  }, [symbol])   // 故意不把 notes 放進依賴，只在換股票時重設

  const handleChange = useCallback((e) => {
    const val = e.target.value
    setText(val)
    clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => onChange(symbol, val), 600)
  }, [symbol, onChange])

  function handleToggle() {
    const next = !open
    setOpen(next)
    if (next) setTimeout(() => textareaRef.current?.focus(), 50)
  }

  const hasNote = !!(notes[symbol]?.trim())
  const lastEdit = notes[`__ts_${symbol}`]

  return (
    <div className="stock-notes">
      <div className="stock-notes-header" onClick={handleToggle}>
        <span className="stock-notes-title">
          📝 備註
          {hasNote && <span className="notes-dot" title="已有備註" />}
        </span>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          {lastEdit && open && (
            <span className="notes-ts">{lastEdit}</span>
          )}
          <span className="notes-toggle">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <textarea
          ref={textareaRef}
          className="stock-notes-textarea"
          placeholder={`為 ${symbol} 記錄操作思路、進出場理由、觀察重點…`}
          value={text}
          onChange={handleChange}
          onBlur={() => { clearTimeout(timerRef.current); onChange(symbol, text) }}
        />
      )}
    </div>
  )
}
