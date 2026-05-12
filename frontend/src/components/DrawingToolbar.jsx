const TOOLS = [
  { id: 'cursor',     icon: '↖',  label: '選取 / 移動 (Esc 取消選取)' },
  null, // separator
  { id: 'trendline',  icon: '↗',  label: '趨勢線：點兩下定端點，雙向延伸' },
  { id: 'ray',        icon: '→',  label: '射線：點兩下，單向延伸' },
  { id: 'horizontal', icon: '—',  label: '水平線：點一下即完成' },
  { id: 'vertical',   icon: '|',  label: '垂直線：點一下即完成' },
  { id: 'rectangle',  icon: '▭',  label: '矩形區間：點兩下定對角' },
  { id: 'fibonacci',  icon: '≋',  label: '斐波那契回調：點兩下定高低點' },
]

export default function DrawingToolbar({ activeTool, onToolChange, onClearAll }) {
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
    </div>
  )
}
