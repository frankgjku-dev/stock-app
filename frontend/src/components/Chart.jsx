import { useEffect, useRef, useCallback } from 'react'
import { createChart, CrosshairMode } from 'lightweight-charts'

// 台灣色彩慣例：紅漲綠跌（奶茶暖化版）
const CANDLE_UP   = '#c85a50'
const CANDLE_DOWN = '#4a9468'

const MA_CONFIG = [
  { key: 'ma5',   period: 5,   color: '#b86e2a' },  // 焦糖
  { key: 'ma10',  period: 10,  color: '#5a8ec8' },  // 粉藍
  { key: 'ma20',  period: 20,  color: '#c85a50' },  // 暖紅
  { key: 'ma60',  period: 60,  color: '#9068b8' },  // 薰衣草
  { key: 'ma120', period: 120, color: '#4a9468' },  // 鼠尾草綠
  { key: 'ma240', period: 240, color: '#c89050' },  // 淡焦糖
]

// 繪圖顏色
const DRAW_COLOR   = '#b86e2a'
const DRAW_SELECT  = '#e09040'
const FIB_LEVELS = [
  { r: 0,     label: '0%',    color: '#c85a50' },
  { r: 0.236, label: '23.6%', color: '#c87830' },
  { r: 0.382, label: '38.2%', color: '#b86e2a' },
  { r: 0.5,   label: '50%',   color: '#688e50' },
  { r: 0.618, label: '61.8%', color: '#4a7ab8' },
  { r: 0.786, label: '78.6%', color: '#8058a8' },
  { r: 1,     label: '100%',  color: '#c85a50' },
]

function calcMA(candles, period) {
  const result = []
  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0
    for (let j = i - period + 1; j <= i; j++) sum += candles[j].close
    result.push({ time: candles[i].time, value: +(sum / period).toFixed(2) })
  }
  return result
}

// 計算點到線段的距離
function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay
  if (dx === 0 && dy === 0) return Math.hypot(px - ax, py - ay)
  const t = Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy) / (dx*dx + dy*dy)))
  return Math.hypot(px - ax - t*dx, py - ay - t*dy)
}

export default function Chart({ candles, indicators, activeTool, clearRef }) {
  const containerRef = useRef(null)
  const canvasRef    = useRef(null)

  const S = useRef({
    chart: null,
    series: {},
    drawings: [],
    tempDraw: null,
    selectedIdx: -1,
    mouse: { x: 0, y: 0 },
  })

  // ── coordinate helpers ──────────────────────────────
  function toPixel(price, time) {
    const { chart, series } = S.current
    if (!chart || !series.candle) return null
    const x = chart.timeScale().timeToCoordinate(time)
    const y = series.candle.priceToCoordinate(price)
    return x != null && y != null ? { x, y } : null
  }

  function toData(x, y) {
    const { chart, series } = S.current
    if (!chart || !series.candle) return null
    const time  = chart.timeScale().coordinateToTime(x)
    const price = series.candle.coordinateToPrice(y)
    return time != null && price != null ? { time, price } : null
  }

  function resizeCanvas() {
    const el = canvasRef.current
    const ct = containerRef.current
    if (!el || !ct) return
    const dpr = window.devicePixelRatio || 1
    el.width  = ct.clientWidth  * dpr
    el.height = ct.clientHeight * dpr
    const ctx = el.getContext('2d')
    ctx.scale(dpr, dpr)
  }

  // ── hit testing ────────────────────────────────────
  function hitTest(d, mx, my) {
    const { type, points } = d
    if (!points[0]) return false
    const p1 = toPixel(points[0].price, points[0].time)
    if (!p1) return false
    const THRESH = 8

    switch (type) {
      case 'horizontal':
        return Math.abs(my - p1.y) < THRESH
      case 'vertical':
        return Math.abs(mx - p1.x) < THRESH
      case 'trendline':
      case 'ray': {
        if (!points[1]) return false
        const p2 = toPixel(points[1].price, points[1].time)
        if (!p2) return false
        return distToSegment(mx, my, p1.x, p1.y, p2.x, p2.y) < THRESH
      }
      case 'rectangle': {
        if (!points[1]) return false
        const p2 = toPixel(points[1].price, points[1].time)
        if (!p2) return false
        const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x)
        const minY = Math.min(p1.y, p2.y), maxY = Math.max(p1.y, p2.y)
        return mx >= minX && mx <= maxX && my >= minY && my <= maxY
      }
      case 'fibonacci': {
        if (!points[1]) return false
        const p2 = toPixel(points[1].price, points[1].time)
        if (!p2) return false
        const minX = Math.min(p1.x, p2.x), maxX = Math.max(p1.x, p2.x)
        const inX = mx >= minX && mx <= maxX
        if (!inX) return false
        return FIB_LEVELS.some(({ r }) => {
          const y = p1.y + (p2.y - p1.y) * r
          return Math.abs(my - y) < THRESH
        })
      }
      default: return false
    }
  }

  // ── render ─────────────────────────────────────────
  function redraw() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ct = containerRef.current
    const W = ct?.clientWidth || canvas.width
    const H = ct?.clientHeight || canvas.height
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, W, H)

    const { drawings, tempDraw, mouse, selectedIdx } = S.current
    const all = [...drawings, ...(tempDraw ? [tempDraw] : [])]
    all.forEach((d, i) => renderShape(ctx, d, W, H, mouse, i === selectedIdx))
  }

  function renderShape(ctx, d, W, H, mouse, selected) {
    const { type, points, done } = d
    if (!points[0]) return
    const p1 = toPixel(points[0].price, points[0].time)
    if (!p1) return

    ctx.save()
    ctx.lineWidth   = selected ? 2.5 : 1.5
    ctx.strokeStyle = selected ? DRAW_SELECT : DRAW_COLOR
    ctx.fillStyle   = selected ? DRAW_SELECT : DRAW_COLOR
    ctx.font        = '11px Inter, system-ui, sans-serif'
    ctx.setLineDash([])

    const getP2 = () =>
      (points[1] ? toPixel(points[1].price, points[1].time) : null) ?? mouse

    switch (type) {
      case 'horizontal': {
        ctx.beginPath()
        ctx.setLineDash(done ? [] : [5, 4])
        ctx.moveTo(0, p1.y); ctx.lineTo(W, p1.y)
        ctx.stroke()
        ctx.setLineDash([])
        // price label
        ctx.fillStyle = selected ? DRAW_SELECT : DRAW_COLOR
        const label = points[0].price.toFixed(2)
        const tw = ctx.measureText(label).width
        ctx.fillStyle = 'rgba(240,230,210,0.85)'
        ctx.fillRect(W - tw - 14, p1.y - 10, tw + 10, 15)
        ctx.fillStyle = selected ? DRAW_SELECT : DRAW_COLOR
        ctx.fillText(label, W - tw - 9, p1.y + 2)
        break
      }
      case 'vertical': {
        ctx.beginPath()
        ctx.setLineDash(done ? [] : [5, 4])
        ctx.moveTo(p1.x, 0); ctx.lineTo(p1.x, H)
        ctx.stroke()
        ctx.setLineDash([])
        break
      }
      case 'trendline': {
        const p2 = getP2()
        if (!p2) break
        ctx.beginPath()
        if (done && points[1]) {
          ctx.setLineDash([])
          const dx = p2.x - p1.x, dy = p2.y - p1.y
          const scale = 5000
          ctx.moveTo(p1.x - dx * scale, p1.y - dy * scale)
          ctx.lineTo(p2.x + dx * scale, p2.y + dy * scale)
        } else {
          ctx.setLineDash([5, 4])
          ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y)
        }
        ctx.stroke()
        ctx.setLineDash([])
        // anchor dots
        if (points[1]) {
          const dp2 = toPixel(points[1].price, points[1].time)
          ;[p1, dp2].filter(Boolean).forEach(p => {
            ctx.beginPath(); ctx.arc(p.x, p.y, selected ? 5 : 3.5, 0, Math.PI * 2)
            ctx.fillStyle = selected ? DRAW_SELECT : DRAW_COLOR
            ctx.fill()
            ctx.strokeStyle = 'rgba(240,230,210,0.9)'
            ctx.lineWidth = 1.5; ctx.stroke()
          })
        }
        break
      }
      case 'ray': {
        const p2 = getP2()
        if (!p2) break
        ctx.beginPath()
        if (done && points[1]) {
          ctx.setLineDash([])
          const dx = p2.x - p1.x, dy = p2.y - p1.y
          ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x + dx * 5000, p2.y + dy * 5000)
        } else {
          ctx.setLineDash([5, 4])
          ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y)
        }
        ctx.stroke()
        ctx.setLineDash([])
        ctx.beginPath(); ctx.arc(p1.x, p1.y, selected ? 5 : 3.5, 0, Math.PI * 2)
        ctx.fillStyle = selected ? DRAW_SELECT : DRAW_COLOR
        ctx.fill()
        break
      }
      case 'rectangle': {
        const p2 = getP2()
        if (!p2) break
        ctx.setLineDash(done ? [] : [5, 4])
        ctx.fillStyle = selected ? 'rgba(224,144,64,0.10)' : 'rgba(184,110,42,0.08)'
        ctx.fillRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y)
        ctx.strokeRect(p1.x, p1.y, p2.x - p1.x, p2.y - p1.y)
        ctx.setLineDash([])
        break
      }
      case 'fibonacci': {
        const p2 = getP2()
        if (!p2) break
        const minX = Math.min(p1.x, p2.x)
        const maxX = Math.max(p1.x, p2.x)
        const priceRange = points[1] ? points[1].price - points[0].price : null

        ctx.setLineDash(done ? [] : [5, 4])
        FIB_LEVELS.forEach(({ r, label, color }) => {
          const y = p1.y + (p2.y - p1.y) * r
          ctx.strokeStyle = color
          ctx.fillStyle   = color
          ctx.lineWidth   = selected ? 2 : 1.2
          ctx.beginPath(); ctx.moveTo(minX, y); ctx.lineTo(maxX, y); ctx.stroke()
          ctx.font = '10px Inter, system-ui'
          ctx.fillText(label, maxX + 5, y + 4)
          if (priceRange !== null) {
            const price = (points[0].price + priceRange * r).toFixed(2)
            ctx.fillText(price, minX - 52, y + 4)
          }
        })
        ctx.setLineDash([])
        break
      }
    }
    ctx.restore()
  }

  // ── chart init ──────────────────────────────────────
  useEffect(() => {
    const ct = containerRef.current
    if (!ct) return

    const chart = createChart(ct, {
      width:  ct.clientWidth,
      height: ct.clientHeight,
      layout: {
        background: { color: '#fdf8f0' },
        textColor: '#7a6048',
      },
      grid: {
        vertLines: { color: 'rgba(140,100,60,0.10)' },
        horzLines: { color: 'rgba(140,100,60,0.10)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: '#b86e2a', labelBackgroundColor: '#b86e2a' },
        horzLine: { color: '#b86e2a', labelBackgroundColor: '#b86e2a' },
      },
      rightPriceScale: { borderColor: 'rgba(140,100,60,0.20)' , scaleMargins: { top: 0.08, bottom: 0.24 } },
      timeScale: { borderColor: 'rgba(140,100,60,0.20)', timeVisible: true },
    })
    S.current.chart = chart

    const cs = chart.addCandlestickSeries({
      upColor: CANDLE_UP, downColor: CANDLE_DOWN,
      borderVisible: false,
      wickUpColor: CANDLE_UP, wickDownColor: CANDLE_DOWN,
    })
    S.current.series.candle = cs

    const vs = chart.addHistogramSeries({
      priceFormat: { type: 'volume' }, priceScaleId: 'vol',
    })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    S.current.series.volume = vs

    MA_CONFIG.forEach(({ key, color }) => {
      const ms = chart.addLineSeries({
        color, lineWidth: 1,
        priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      })
      S.current.series[key] = ms
    })

    chart.timeScale().subscribeVisibleLogicalRangeChange(() => redraw())
    chart.subscribeCrosshairMove(() => redraw())

    resizeCanvas()

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: ct.clientWidth, height: ct.clientHeight })
      resizeCanvas(); redraw()
    })
    ro.observe(ct)

    return () => { ro.disconnect(); chart.remove(); S.current.chart = null; S.current.series = {} }
  }, [])

  // ── data ────────────────────────────────────────────
  useEffect(() => {
    if (!candles?.length) return
    const { series, chart } = S.current
    series.candle?.setData(candles.map(c => ({ time:c.time, open:c.open, high:c.high, low:c.low, close:c.close })))
    series.volume?.setData(candles.map(c => ({
      time: c.time, value: c.volume,
      color: c.close >= c.open ? `${CANDLE_UP}66` : `${CANDLE_DOWN}66`,
    })))
    MA_CONFIG.forEach(({ key, period }) => series[key]?.setData(calcMA(candles, period)))
    chart?.timeScale().fitContent()
  }, [candles])

  // ── indicators ──────────────────────────────────────
  useEffect(() => {
    if (!indicators) return
    MA_CONFIG.forEach(({ key }) => {
      S.current.series[key]?.applyOptions({ visible: indicators[key] !== false })
    })
  }, [indicators])

  // ── expose clearAll to parent ───────────────────────
  useEffect(() => {
    if (clearRef) clearRef.current = () => {
      S.current.drawings = []; S.current.tempDraw = null; S.current.selectedIdx = -1; redraw()
    }
  }, [clearRef])

  // ── keyboard shortcuts ──────────────────────────────
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        S.current.tempDraw  = null
        S.current.selectedIdx = -1
        redraw()
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && e.target.tagName !== 'INPUT') {
        const { selectedIdx, drawings } = S.current
        if (selectedIdx >= 0) {
          S.current.drawings = drawings.filter((_, i) => i !== selectedIdx)
          S.current.selectedIdx = -1
        } else if (drawings.length > 0) {
          S.current.drawings = drawings.slice(0, -1)
        }
        redraw()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // ── mouse handlers ──────────────────────────────────
  const activeToolRef = useRef(activeTool)
  activeToolRef.current = activeTool

  function handleMouseDown(e) {
    if (e.button === 2) return  // right-click handled separately
    const tool = activeToolRef.current
    const rect = canvasRef.current.getBoundingClientRect()
    const mx = e.clientX - rect.left
    const my = e.clientY - rect.top

    if (tool === 'cursor') {
      // hit test for selection
      const { drawings } = S.current
      let hit = -1
      for (let i = drawings.length - 1; i >= 0; i--) {
        if (hitTest(drawings[i], mx, my)) { hit = i; break }
      }
      S.current.selectedIdx = hit
      redraw()
      return
    }

    const dp = toData(mx, my)
    if (!dp) return

    const oneClick = tool === 'horizontal' || tool === 'vertical'
    if (!S.current.tempDraw) {
      const draw = { type: tool, points: [dp], done: oneClick }
      if (oneClick) S.current.drawings.push(draw)
      else          S.current.tempDraw = draw
    } else {
      S.current.tempDraw.points.push(dp)
      S.current.tempDraw.done = true
      S.current.drawings.push({ ...S.current.tempDraw })
      S.current.tempDraw = null
    }
    redraw()
  }

  function handleMouseMove(e) {
    const rect = canvasRef.current.getBoundingClientRect()
    S.current.mouse = { x: e.clientX - rect.left, y: e.clientY - rect.top }
    if (S.current.tempDraw) redraw()
  }

  function handleContextMenu(e) {
    e.preventDefault()
    if (S.current.tempDraw) {
      S.current.tempDraw = null
    } else if (S.current.selectedIdx >= 0) {
      S.current.drawings = S.current.drawings.filter((_, i) => i !== S.current.selectedIdx)
      S.current.selectedIdx = -1
    } else if (S.current.drawings.length > 0) {
      S.current.drawings.pop()
    }
    redraw()
  }

  const isDrawing = activeTool !== 'cursor'

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute', top: 0, left: 0,
          width: '100%', height: '100%',           // ← 這行是修復關鍵
          cursor: isDrawing ? 'crosshair' : 'default',
          pointerEvents: isDrawing ? 'auto' : 'none',
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onContextMenu={handleContextMenu}
      />
    </div>
  )
}
