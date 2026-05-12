const TOOLS = [
  { id: 'cursor',     svg: 'M4 4l8 20 4-8 8-4z',                         label: '選取 / 移動' },
  { id: 'trendline',  svg: 'M5 19L19 5M5 19h4M19 5v4',                   label: '趨勢線 (兩點延伸)' },
  { id: 'horizontal', svg: 'M3 12h18M3 12l3-3M3 12l3 3',                  label: '水平線' },
  { id: 'vertical',   svg: 'M12 3v18M12 3l-3 3M12 3l3 3',                 label: '垂直線' },
  { id: 'rectangle',  svg: 'M4 4h16v16H4z',                               label: '矩形' },
  { id: 'fibonacci',  svg: 'M4 6h16M4 10h16M4 14h16M4 18h16',            label: '斐波那契回調' },
]

function Icon({ path }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  )
}

export default function DrawingToolbar({ activeTool, onToolChange }) {
  return (
    <div className="drawing-toolbar">
      {TOOLS.map(({ id, svg, label }, i) => (
        <>
          {i === 1 && <div key="sep" className="tool-sep" />}
          <button
            key={id}
            className={`tool-btn ${activeTool === id ? 'active' : ''}`}
            onClick={() => onToolChange(id)}
            title={label}
          >
            <Icon path={svg} />
          </button>
        </>
      ))}
    </div>
  )
}
