import { useEffect, useRef } from 'react'
import { createChart, CrosshairMode } from 'lightweight-charts'

const CANDLE_UP   = '#c85a50'
const CANDLE_DOWN = '#4a9468'

const MA_CONFIG = [
  { key:'ma5',   period:5,   color:'#b86e2a' },
  { key:'ma10',  period:10,  color:'#5a8ec8' },
  { key:'ma20',  period:20,  color:'#c85a50' },
  { key:'ma60',  period:60,  color:'#9068b8' },
  { key:'ma120', period:120, color:'#4a9468' },
  { key:'ma240', period:240, color:'#c89050' },
]

const DRAW_COLOR  = '#b86e2a'
const DRAW_SELECT = '#e09040'
const FIB_LEVELS  = [
  { r:0,     label:'0%',    color:'#c85a50' },
  { r:0.236, label:'23.6%', color:'#c87830' },
  { r:0.382, label:'38.2%', color:'#b86e2a' },
  { r:0.5,   label:'50%',   color:'#5a8058' },
  { r:0.618, label:'61.8%', color:'#4a7ab8' },
  { r:0.786, label:'78.6%', color:'#8058a8' },
  { r:1,     label:'100%',  color:'#c85a50' },
]

function calcMA(candles, period) {
  const out = []
  for (let i = period - 1; i < candles.length; i++) {
    let s = 0
    for (let j = i - period + 1; j <= i; j++) s += candles[j].close
    out.push({ time: candles[i].time, value: +(s / period).toFixed(2) })
  }
  return out
}

export default function Chart({ candles, indicators, activeTool, clearRef }) {
  const wrapperRef   = useRef(null)
  const containerRef = useRef(null)
  const canvasRef    = useRef(null)

  const S = useRef({
    chart: null, series: {},
    drawings: [],
    preview: null,   // { type, pts:[{price,time}], cursor:{x,y} }
    selectedIdx: -1,
    cursorPt: { x:0, y:0 },  // latest crosshair position in chart px
  })

  /* ─── coordinate helpers ─────────────────────── */
  function toPixel(price, time) {
    const { chart, series } = S.current
    if (!chart || !series.candle) return null
    const x = chart.timeScale().timeToCoordinate(time)
    const y = series.candle.priceToCoordinate(price)
    return (x != null && y != null) ? { x, y } : null
  }

  /* ─── canvas resize ─────────────────────────── */
  function syncCanvas() {
    const el = canvasRef.current
    const ct = containerRef.current
    if (!el || !ct) return
    el.width  = ct.clientWidth
    el.height = ct.clientHeight
  }

  /* ─── render ─────────────────────────────────── */
  function redraw() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const { drawings, preview, selectedIdx } = S.current
    drawings.forEach((d, i) => paint(ctx, d, canvas, false, i === selectedIdx))
    if (preview) paint(ctx, preview, canvas, true, false)
  }

  function paint(ctx, d, canvas, isPreview, selected) {
    const { type, pts } = d
    if (!pts[0]) return
    const p1 = toPixel(pts[0].price, pts[0].time)
    if (!p1) return

    const color = selected ? DRAW_SELECT : DRAW_COLOR
    const W = canvas.width, H = canvas.height
    ctx.save()
    ctx.strokeStyle = color
    ctx.fillStyle   = color
    ctx.lineWidth   = selected ? 2.5 : 1.5
    ctx.font        = '11px Inter, system-ui, sans-serif'
    ctx.setLineDash(isPreview ? [6, 4] : [])

    // p2: stored second point OR live cursor
    const p2 = pts[1]
      ? toPixel(pts[1].price, pts[1].time)
      : (d.cursor || S.current.cursorPt)

    switch (type) {
      case 'horizontal': {
        ctx.beginPath(); ctx.moveTo(0, p1.y); ctx.lineTo(W, p1.y); ctx.stroke()
        ctx.setLineDash([])
        const lbl = pts[0].price.toFixed(2)
        const tw  = ctx.measureText(lbl).width + 10
        ctx.fillStyle = 'rgba(250,245,236,0.88)'
        ctx.fillRect(W - tw - 4, p1.y - 12, tw, 17)
        ctx.fillStyle = color
        ctx.fillText(pts[0].price.toFixed(2), W - tw, p1.y + 2)
        break
      }
      case 'vertical': {
        ctx.beginPath(); ctx.moveTo(p1.x, 0); ctx.lineTo(p1.x, H); ctx.stroke()
        break
      }
      case 'trendline':
      case 'ray': {
        if (!p2) break
        ctx.beginPath()
        if (!isPreview && pts[1]) {
          const dx = p2.x - p1.x, dy = p2.y - p1.y, sc = 6000
          if (type === 'trendline') {
            ctx.moveTo(p1.x - dx*sc, p1.y - dy*sc)
            ctx.lineTo(p2.x + dx*sc, p2.y + dy*sc)
          } else {
            ctx.moveTo(p1.x, p1.y)
            ctx.lineTo(p2.x + dx*sc, p2.y + dy*sc)
          }
        } else {
          ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y)
        }
        ctx.stroke()
        ctx.setLineDash([])
        // anchor dots
        const dots = [p1, ...(pts[1] ? [toPixel(pts[1].price, pts[1].time)] : [])].filter(Boolean)
        dots.forEach(p => {
          ctx.beginPath(); ctx.arc(p.x, p.y, selected ? 5 : 3, 0, Math.PI*2)
          ctx.fillStyle = color; ctx.fill()
          ctx.strokeStyle = 'rgba(250,245,236,0.9)'; ctx.lineWidth = 1.5; ctx.stroke()
        })
        break
      }
      case 'rectangle': {
        if (!p2) break
        ctx.fillStyle = selected
          ? 'rgba(224,144,64,0.10)' : 'rgba(184,110,42,0.07)'
        ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y)
        ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y)
        break
      }
      case 'fibonacci': {
        if (!p2) break
        const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x)
        const span = pts[1] ? pts[1].price - pts[0].price : null
        FIB_LEVELS.forEach(({ r, label, color: fc }) => {
          const y = p1.y + (p2.y - p1.y) * r
          ctx.strokeStyle = fc; ctx.fillStyle = fc; ctx.lineWidth = 1.2
          ctx.beginPath(); ctx.moveTo(minX, y); ctx.lineTo(maxX, y); ctx.stroke()
          ctx.font = '10px Inter, system-ui'
          ctx.fillText(label, maxX + 5, y + 4)
          if (span !== null)
            ctx.fillText((pts[0].price + span * r).toFixed(2), minX - 54, y + 4)
        })
        break
      }
    }
    ctx.restore()
  }

  /* ─── hit test ───────────────────────────────── */
  function hitTest(d, mx, my) {
    const { type, pts } = d
    if (!pts[0]) return false
    const p1 = toPixel(pts[0].price, pts[0].time)
    if (!p1) return false
    const T = 9
    if (type === 'horizontal') return Math.abs(my - p1.y) < T
    if (type === 'vertical')   return Math.abs(mx - p1.x) < T
    if (!pts[1]) return false
    const p2 = toPixel(pts[1].price, pts[1].time)
    if (!p2) return false
    if (type === 'rectangle') {
      const [lx,rx] = [Math.min(p1.x,p2.x), Math.max(p1.x,p2.x)]
      const [ty,by] = [Math.min(p1.y,p2.y), Math.max(p1.y,p2.y)]
      return mx>=lx && mx<=rx && my>=ty && my<=by
    }
    const dx=p2.x-p1.x, dy=p2.y-p1.y, len2=dx*dx+dy*dy
    if (!len2) return Math.hypot(mx-p1.x, my-p1.y) < T
    const t = Math.max(0, Math.min(1, ((mx-p1.x)*dx+(my-p1.y)*dy)/len2))
    return Math.hypot(mx-p1.x-t*dx, my-p1.y-t*dy) < T
  }

  /* ─── chart init ──────────────────────────────── */
  useEffect(() => {
    const ct = containerRef.current
    if (!ct) return

    const chart = createChart(ct, {
      width:  ct.clientWidth,
      height: ct.clientHeight,
      layout: {
        background: { color: '#fdf8f0' },
        textColor:  '#7a5c38',
      },
      grid: {
        vertLines: { color: 'rgba(140,100,60,0.09)' },
        horzLines: { color: 'rgba(140,100,60,0.09)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color:'#b86e2a66', labelBackgroundColor:'#b86e2a' },
        horzLine: { color:'#b86e2a66', labelBackgroundColor:'#b86e2a' },
      },
      rightPriceScale: {
        borderColor: 'rgba(140,100,60,0.18)',
        scaleMargins: { top:0.08, bottom:0.24 },
      },
      timeScale: { borderColor:'rgba(140,100,60,0.18)', timeVisible:true },
    })
    S.current.chart = chart

    // Candlestick
    const cs = chart.addCandlestickSeries({
      upColor:CANDLE_UP, downColor:CANDLE_DOWN,
      borderVisible:false, wickUpColor:CANDLE_UP, wickDownColor:CANDLE_DOWN,
    })
    S.current.series.candle = cs

    // Volume
    const vs = chart.addHistogramSeries({ priceFormat:{type:'volume'}, priceScaleId:'vol' })
    chart.priceScale('vol').applyOptions({ scaleMargins:{top:0.82, bottom:0} })
    S.current.series.volume = vs

    // MA lines
    MA_CONFIG.forEach(({ key, color }) => {
      const ms = chart.addLineSeries({
        color, lineWidth:1,
        priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false,
      })
      S.current.series[key] = ms
    })

    // ── 核心修正：用 chart 自己的事件 API ────────────────
    // 1. 追蹤滑鼠位置（在圖表座標系中），用於繪圖預覽
    chart.subscribeCrosshairMove(param => {
      if (param.point) {
        S.current.cursorPt = param.point
        if (S.current.preview) {
          S.current.preview.cursor = param.point
        }
      }
      redraw()
    })

    // 2. 偵測點擊（在圖表座標系中）→ 繪圖邏輯
    chart.subscribeClick(param => {
      const tool = activeToolRef.current
      if (!param.point) return

      const { x, y } = param.point

      // 選取模式：hit test
      if (tool === 'cursor') {
        const { drawings } = S.current
        let hit = -1
        for (let i = drawings.length - 1; i >= 0; i--) {
          if (hitTest(drawings[i], x, y)) { hit = i; break }
        }
        S.current.selectedIdx = hit
        redraw()
        return
      }

      // 取得 data 座標
      const price = cs.coordinateToPrice(y)
      const time  = param.time   // subscribeClick 提供 param.time

      if (price == null || time == null) return

      const dp = { price: Number(price), time }
      const oneClick = tool === 'horizontal' || tool === 'vertical'

      if (!S.current.preview) {
        if (oneClick) {
          S.current.drawings.push({ type:tool, pts:[dp] })
        } else {
          S.current.preview = { type:tool, pts:[dp], cursor:param.point }
        }
      } else {
        // 第二點 → 完成
        S.current.preview.pts.push(dp)
        S.current.drawings.push({ type: S.current.preview.type, pts: [...S.current.preview.pts] })
        S.current.preview = null
      }
      redraw()
    })

    syncCanvas()

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width:ct.clientWidth, height:ct.clientHeight })
      syncCanvas(); redraw()
    })
    ro.observe(ct)

    return () => {
      ro.disconnect(); chart.remove()
      S.current.chart = null; S.current.series = {}
    }
  }, [])

  /* ─── data ──────────────────────────────────── */
  useEffect(() => {
    if (!candles?.length) return
    const { series, chart } = S.current
    series.candle?.setData(candles.map(c => ({
      time:c.time, open:c.open, high:c.high, low:c.low, close:c.close,
    })))
    series.volume?.setData(candles.map(c => ({
      time:c.time, value:c.volume,
      color: c.close >= c.open ? `${CANDLE_UP}60` : `${CANDLE_DOWN}60`,
    })))
    MA_CONFIG.forEach(({ key, period }) => series[key]?.setData(calcMA(candles, period)))
    chart?.timeScale().fitContent()
  }, [candles])

  /* ─── indicators ────────────────────────────── */
  useEffect(() => {
    if (!indicators) return
    MA_CONFIG.forEach(({ key }) =>
      S.current.series[key]?.applyOptions({ visible: indicators[key] !== false })
    )
  }, [indicators])

  /* ─── expose clearAll ───────────────────────── */
  useEffect(() => {
    if (clearRef) clearRef.current = () => {
      S.current.drawings = []; S.current.preview = null; S.current.selectedIdx = -1; redraw()
    }
  }, [clearRef])

  /* ─── keyboard ──────────────────────────────── */
  useEffect(() => {
    function onKey(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return
      if (e.key === 'Escape') {
        S.current.preview = null; S.current.selectedIdx = -1; redraw()
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const { selectedIdx, drawings } = S.current
        if (selectedIdx >= 0) {
          S.current.drawings = drawings.filter((_, i) => i !== selectedIdx)
          S.current.selectedIdx = -1
        } else {
          S.current.drawings = drawings.slice(0, -1)
        }
        redraw()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const activeToolRef = useRef(activeTool)
  activeToolRef.current = activeTool

  /* ─── right-click to cancel / delete ─────────── */
  function handleContextMenu(e) {
    e.preventDefault()
    if (S.current.preview) {
      S.current.preview = null
    } else if (S.current.selectedIdx >= 0) {
      S.current.drawings = S.current.drawings.filter((_, i) => i !== S.current.selectedIdx)
      S.current.selectedIdx = -1
    } else if (S.current.drawings.length > 0) {
      S.current.drawings = S.current.drawings.slice(0, -1)
    }
    redraw()
  }

  const isDrawingMode = activeTool !== 'cursor'

  return (
    <div
      ref={wrapperRef}
      style={{
        position: 'relative', width:'100%', height:'100%',
        cursor: isDrawingMode ? 'crosshair' : 'default',
      }}
      onContextMenu={handleContextMenu}
    >
      {/* 圖表由 lightweight-charts 掌控 */}
      <div ref={containerRef} style={{ width:'100%', height:'100%' }} />

      {/* 繪圖 canvas：永遠 pointerEvents:none，不擋圖表事件 */}
      <canvas
        ref={canvasRef}
        style={{
          position:'absolute', top:0, left:0,
          width:'100%', height:'100%',
          pointerEvents: 'none',
        }}
      />
    </div>
  )
}
