import { useEffect, useRef } from 'react'
import { createChart, CrosshairMode } from 'lightweight-charts'

// 台灣色彩慣例：紅漲綠跌（奶茶暖化版）
const CANDLE_UP   = '#d4736a'
const CANDLE_DOWN = '#5fa882'

const MA_CONFIG = [
  { key: 'ma5',   period: 5,   color: '#c8925a' },  // 焦糖
  { key: 'ma10',  period: 10,  color: '#89afd4' },  // 粉藍
  { key: 'ma20',  period: 20,  color: '#d4736a' },  // 暖紅
  { key: 'ma60',  period: 60,  color: '#b88fc8' },  // 薰衣草
  { key: 'ma120', period: 120, color: '#5fa882' },  // 鼠尾草綠
  { key: 'ma240', period: 240, color: '#d4a06a' },  // 淡焦糖
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

export default function Chart({ candles, indicators, activeTool }) {
  const containerRef = useRef(null)
  const canvasRef    = useRef(null)

  // All mutable state lives here to avoid stale closures in chart subscriptions
  const S = useRef({
    chart: null,
    series: {},
    drawings: [],   // completed drawings
    tempDraw: null, // in-progress drawing
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

  // ── canvas resize ───────────────────────────────────
  function resizeCanvas() {
    const el = canvasRef.current
    const ct = containerRef.current
    if (!el || !ct) return
    el.width  = ct.clientWidth
    el.height = ct.clientHeight
  }

  // ── render all drawings on canvas ──────────────────
  function redraw() {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    const { drawings, tempDraw, mouse } = S.current
    ;[...drawings, ...(tempDraw ? [tempDraw] : [])].forEach(d =>
      renderShape(ctx, d, canvas, mouse)
    )
  }

  function renderShape(ctx, d, canvas, mouse) {
    const { type, points, done } = d
    if (!points[0]) return
    const p1 = toPixel(points[0].price, points[0].time)
    if (!p1) return

    ctx.save()
    ctx.lineWidth   = 1.5
    ctx.strokeStyle = '#2196F3'
    ctx.fillStyle   = '#2196F3'
    ctx.font        = '11px monospace'

    // helper: second reference point (stored or live mouse)
    const getP2 = () =>
      points[1] ? toPixel(points[1].price, points[1].time) : mouse

    switch (type) {
      case 'horizontal': {
        ctx.beginPath()
        ctx.moveTo(0, p1.y)
        ctx.lineTo(canvas.width, p1.y)
        ctx.stroke()
        ctx.fillText(points[0].price.toFixed(2), canvas.width - 64, p1.y - 3)
        break
      }
      case 'vertical': {
        ctx.beginPath()
        ctx.moveTo(p1.x, 0)
        ctx.lineTo(p1.x, canvas.height)
        ctx.stroke()
        break
      }
      case 'trendline': {
        const p2 = getP2()
        if (!p2) break
        ctx.beginPath()
        if (done && points[1]) {
          // extend line in both directions
          const dx = p2.x - p1.x, dy = p2.y - p1.y
          const scale = 3000
          ctx.moveTo(p1.x - dx * scale, p1.y - dy * scale)
          ctx.lineTo(p2.x + dx * scale, p2.y + dy * scale)
        } else {
          ctx.moveTo(p1.x, p1.y)
          ctx.lineTo(p2.x, p2.y)
        }
        ctx.stroke()
        // dots at anchors
        if (done && points[1]) {
          const dp2 = toPixel(points[1].price, points[1].time)
          ;[p1, dp2].forEach(p => {
            if (!p) return
            ctx.beginPath()
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2)
            ctx.fill()
          })
        }
        break
      }
      case 'rectangle': {
        const p2 = getP2()
        if (!p2) break
        const w = p2.x - p1.x, h = p2.y - p1.y
        ctx.fillStyle = '#2196F315'
        ctx.fillRect(p1.x, p1.y, w, h)
        ctx.strokeRect(p1.x, p1.y, w, h)
        break
      }
      case 'fibonacci': {
        const p2 = getP2()
        if (!p2) break
        const FIB_LEVELS = [
          { r: 0,     label: '0%',    color: '#ef5350' },
          { r: 0.236, label: '23.6%', color: '#ff9800' },
          { r: 0.382, label: '38.2%', color: '#ffeb3b' },
          { r: 0.5,   label: '50%',   color: '#4caf50' },
          { r: 0.618, label: '61.8%', color: '#2196f3' },
          { r: 0.786, label: '78.6%', color: '#9c27b0' },
          { r: 1,     label: '100%',  color: '#ef5350' },
        ]
        const minX = Math.min(p1.x, p2.x)
        const maxX = Math.max(p1.x, p2.x)
        const priceSpan = points[1]
          ? points[1].price - points[0].price
          : null

        FIB_LEVELS.forEach(({ r, label, color }) => {
          const y = p1.y + (p2.y - p1.y) * r
          ctx.strokeStyle = color
          ctx.fillStyle   = color
          ctx.beginPath()
          ctx.moveTo(minX, y)
          ctx.lineTo(maxX, y)
          ctx.stroke()
          ctx.fillText(label, maxX + 4, y + 4)
          if (priceSpan !== null) {
            const price = points[0].price + priceSpan * r
            ctx.fillText(price.toFixed(2), minX - 62, y + 4)
          }
        })
        break
      }
    }
    ctx.restore()
  }

  // ── chart initialisation ────────────────────────────
  useEffect(() => {
    const ct = containerRef.current
    if (!ct) return

    const chart = createChart(ct, {
      width:  ct.clientWidth,
      height: ct.clientHeight,
      layout: { background: { color: '#1e1710' }, textColor: '#c4aa8a' },
      grid: {
        vertLines: { color: 'rgba(180,148,108,0.08)' },
        horzLines: { color: 'rgba(180,148,108,0.08)' },
      },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: {
        borderColor: 'rgba(180,148,108,0.18)',
        scaleMargins: { top: 0.08, bottom: 0.24 },
      },
      timeScale: { borderColor: 'rgba(180,148,108,0.18)', timeVisible: true },
    })
    S.current.chart = chart

    // Candlestick
    const cs = chart.addCandlestickSeries({
      upColor: CANDLE_UP, downColor: CANDLE_DOWN,
      borderVisible: false,
      wickUpColor: CANDLE_UP, wickDownColor: CANDLE_DOWN,
    })
    S.current.series.candle = cs

    // Volume (uses a separate price scale id so it doesn't overlap)
    const vs = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'vol',
    })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
    S.current.series.volume = vs

    // MA lines
    MA_CONFIG.forEach(({ key, color }) => {
      const ms = chart.addLineSeries({
        color, lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
      })
      S.current.series[key] = ms
    })

    // Subscribe to range/crosshair changes → redraw drawings
    chart.timeScale().subscribeVisibleLogicalRangeChange(() => redraw())
    chart.subscribeCrosshairMove(() => redraw())

    resizeCanvas()

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width: ct.clientWidth, height: ct.clientHeight })
      resizeCanvas()
      redraw()
    })
    ro.observe(ct)

    return () => {
      ro.disconnect()
      chart.remove()
      S.current.chart   = null
      S.current.series  = {}
    }
  }, [])

  // ── update candlestick + volume + MA when data changes ──
  useEffect(() => {
    if (!candles?.length) return
    const { series, chart } = S.current

    series.candle?.setData(
      candles.map(c => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }))
    )
    series.volume?.setData(
      candles.map(c => ({
        time: c.time,
        value: c.volume,
        color: c.close >= c.open ? `${CANDLE_UP}55` : `${CANDLE_DOWN}55`,
      }))
    )
    MA_CONFIG.forEach(({ key, period }) => {
      series[key]?.setData(calcMA(candles, period))
    })
    chart?.timeScale().fitContent()
  }, [candles])

  // ── toggle MA visibility ────────────────────────────
  useEffect(() => {
    if (!indicators) return
    MA_CONFIG.forEach(({ key }) => {
      S.current.series[key]?.applyOptions({ visible: indicators[key] !== false })
    })
  }, [indicators])

  // ── drawing mouse handlers ──────────────────────────
  // activeTool is read via a ref to avoid stale closures on canvas handlers
  const activeToolRef = useRef(activeTool)
  activeToolRef.current = activeTool

  function handleMouseDown(e) {
    const tool = activeToolRef.current
    if (tool === 'cursor') return
    const rect = canvasRef.current.getBoundingClientRect()
    const dp = toData(e.clientX - rect.left, e.clientY - rect.top)
    if (!dp) return

    const oneClick = tool === 'horizontal' || tool === 'vertical'
    if (!S.current.tempDraw) {
      const draw = { type: tool, points: [dp], done: oneClick }
      if (oneClick) {
        S.current.drawings.push(draw)
      } else {
        S.current.tempDraw = draw
      }
    } else {
      // second click → finish
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
    } else {
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
