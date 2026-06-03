import { useRef, useState } from 'react'

const TOOLS = [
  { id: 'cursor',     icon: '↖',  label: '選取 / 移動 (Esc 取消選取)' },
  null,
  { id: 'segment',    icon: '╱',  label: '直線：點兩下定兩端點，不延伸' },
  { id: 'trendline',  icon: '↗',  label: '趨勢線：點兩下定端點，雙向延伸' },
  { id: 'ray',        icon: '→',  label: '射線：點兩下，單向延伸' },
  { id: 'horizontal', icon: '—',  label: '水平線：點一下即完成' },
  { id: 'vertical',   icon: '|',  label: '垂直線：點一下即完成' },
  { id: 'rectangle',  icon: '▭',  label: '矩形區間：點兩下定對角' },
  { id: 'fibonacci',  icon: '≋',  label: '斐波那契回調：點兩下定高低點' },
  { id: 'arc',        icon: '⌒',  label: '弧形量幅：點兩下定起終點，顯示漲跌%' },
  { id: 'text',       icon: 'T',  label: '文字標注：先輸入文字，再點擊放置' },
]

const PRESET_COLORS = [
  { hex: '#b86e2a', label: '焦糖' },
  { hex: '#c85a50', label: '暖紅' },
  { hex: '#4a9468', label: '草綠' },
  { hex: '#5a8ec8', label: '天藍' },
  { hex: '#9068b8', label: '薰衣草' },
  { hex: '#c8a030', label: '金黃' },
  { hex: '#1e140a', label: '深焙' },
]

export default function DrawingToolbar({
  activeTool, onToolChange, onClearAll,
  drawColor = '#b86e2a', onColorChange,
  labelText = '', onLabelTextChange,
}) {
  const colorInputRef = useRef(null)

  return (
    <div className="drawing-toolbar">
      {TOOLS.map((t, i) =>
        t === null
          ? <div key={`sep-${i}`} className="tool-sep" />
          : (
            <button
              key={t.id}
              className={`tool-btn ${activeTool === t.id ? 'active' : ''}`}
              onClick={() => onToolChange(t.id)}
              title={t.label}
            >
              <span style={{ fontSize: 14, fontWeight: 600, lineHeight: 1 }}>{t.icon}</span>
            </button>
          )
      )}

      {/* 文字工具輸入框（選取 text 工具才顯示）*/}
      {activeTool === 'text' && (
        <>
          <div className="tool-sep" />
          <input
            className="text-tool-input"
            type="text"
            value={labelText}
            onChange={e => onLabelTextChange?.(e.target.value)}
            placeholder="輸入標注文字…"
            maxLength={30}
            autoFocus
            title="輸入後點擊圖表放置"
          />
        </>
      )}

      <div className="tool-sep" />

      {/* 清除所有繪圖 */}
      <button
        className="tool-btn"
        title="清除所有繪圖 (Backspace 刪除最後一筆)"
        onClick={onClearAll}
        style={{ fontSize: 13 }}
      >
        🗑
      </button>

      <div className="tool-sep" />

      {/* ── 畫線顏色 ── */}
      <div className="color-section" title="畫線顏色">
        {PRESET_COLORS.map(({ hex, label }) => (
          <button
            key={hex}
            className={`color-swatch ${drawColor === hex ? 'active' : ''}`}
            style={{ '--swatch-color': hex }}
            title={label}
            onClick={() => onColorChange(hex)}
          />
        ))}

        {/* 自訂色 */}
        <button
          className="color-swatch color-swatch-custom"
          title="自訂顏色"
          style={{ '--swatch-color': drawColor }}
          onClick={() => colorInputRef.current?.click()}
        >
          <span className="color-swatch-plus">＋</span>
        </button>
        <input
          ref={colorInputRef}
          type="color"
          value={drawColor}
          onChange={e => onColorChange(e.target.value)}
          style={{ position: 'absolute', opacity: 0, width: 0, height: 0, pointerEvents: 'none' }}
          tabIndex={-1}
        />
      </div>
    </div>
  )
}
