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

// ── 技術指標計算 ─────────────────────────────────────────────────
function calcBB(candles, period = 20, mult = 2) {
  const upper = [], middle = [], lower = []
  for (let i = period - 1; i < candles.length; i++) {
    const sl   = candles.slice(i - period + 1, i + 1)
    const mean = sl.reduce((s, c) => s + c.close, 0) / period
    const std  = Math.sqrt(sl.reduce((s, c) => s + (c.close - mean) ** 2, 0) / period)
    upper.push({ time: candles[i].time, value: +(mean + mult * std).toFixed(3) })
    middle.push({ time: candles[i].time, value: +mean.toFixed(3) })
    lower.push({ time: candles[i].time, value: +(mean - mult * std).toFixed(3) })
  }
  return { upper, middle, lower }
}

function calcRSI(candles, period = 14) {
  const out = []
  if (candles.length <= period) return out
  let ag = 0, al = 0
  for (let i = 1; i <= period; i++) {
    const d = candles[i].close - candles[i - 1].close
    ag += Math.max(0, d); al += Math.max(0, -d)
  }
  ag /= period; al /= period
  for (let i = period; i < candles.length; i++) {
    if (i > period) {
      const d = candles[i].close - candles[i - 1].close
      ag = (ag * (period - 1) + Math.max(0, d))  / period
      al = (al * (period - 1) + Math.max(0, -d)) / period
    }
    const rsi = al === 0 ? 100 : +(100 - 100 / (1 + ag / al)).toFixed(2)
    out.push({ time: candles[i].time, value: rsi })
  }
  return out
}

function _ema(vals, period) {
  const k = 2 / (period + 1), out = [vals[0]]
  for (let i = 1; i < vals.length; i++) out.push(vals[i] * k + out[i - 1] * (1 - k))
  return out
}

function calcMACD(candles, fast = 12, slow = 26, signal = 9) {
  const closes = candles.map(c => c.close)
  const ef = _ema(closes, fast), es = _ema(closes, slow)
  const macdArr = closes.map((_, i) => ef[i] - es[i])
  const sigArr  = _ema(macdArr.slice(slow - 1), signal)
  const out = { macd: [], signal: [], hist: [] }
  for (let i = slow - 1; i < candles.length; i++) {
    const m = macdArr[i], s = sigArr[i - (slow - 1)], h = m - s
    out.macd.push({ time: candles[i].time, value: +m.toFixed(4) })
    out.signal.push({ time: candles[i].time, value: +s.toFixed(4) })
    out.hist.push({ time: candles[i].time, value: +h.toFixed(4),
      color: h >= 0 ? '#4a946888' : '#c85a5088' })
  }
  return out
}

function calcVolMA(candles, period = 5) {
  const out = []
  for (let i = period - 1; i < candles.length; i++) {
    const avg = candles.slice(i - period + 1, i + 1).reduce((s, c) => s + c.volume, 0) / period
    out.push({ time: candles[i].time, value: Math.round(avg) })
  }
  return out
}

// RSI/MACD 子圖佈局
function _applyPaneLayout(chart, cs, showRSI, showMACD) {
  if (!chart || !cs) return
  if (!showRSI && !showMACD) {
    cs.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.24 } })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } })
  } else if (showRSI && !showMACD) {
    cs.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.46 } })
    chart.priceScale('rsi').applyOptions({ scaleMargins: { top: 0.58, bottom: 0.20 } })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } })
  } else if (!showRSI && showMACD) {
    cs.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.46 } })
    chart.priceScale('macd').applyOptions({ scaleMargins: { top: 0.58, bottom: 0.20 } })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } })
  } else {
    cs.priceScale().applyOptions({ scaleMargins: { top: 0.05, bottom: 0.62 } })
    chart.priceScale('rsi').applyOptions({ scaleMargins: { top: 0.42, bottom: 0.42 } })
    chart.priceScale('macd').applyOptions({ scaleMargins: { top: 0.63, bottom: 0.20 } })
    chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } })
  }
}

const FIB_LEVELS = [
  { r:0,     label:'0%',    color:'#c85a50' },
  { r:0.236, label:'23.6%', color:'#c87830' },
  { r:0.382, label:'38.2%', color:'#b86e2a' },
  { r:0.5,   label:'50%',   color:'#5a8058' },
  { r:0.618, label:'61.8%', color:'#4a7ab8' },
  { r:0.786, label:'78.6%', color:'#8058a8' },
  { r:1,     label:'100%',  color:'#c85a50' },
]

// 將日期字串（YYYY-MM-DD）前後移動 N 天
function shiftDate(dateStr, days) {
  const d = new Date(dateStr + 'T00:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

// 回測標記：自動縮放到買賣區間（前後各留 30 個交易日的緩衝）
function _scrollToMarkers(chart, markers) {
  if (!chart || !markers?.length) return
  const times = markers.map(m => m.time).sort()
  const from  = shiftDate(times[0],                    -45)
  const to    = shiftDate(times[times.length - 1],      45)
  setTimeout(() => {
    try { chart.timeScale().setVisibleRange({ from, to }) } catch (_) {}
  }, 80)
}

function calcMA(candles, period) {
  const out = []
  for (let i = period - 1; i < candles.length; i++) {
    let s = 0
    for (let j = i - period + 1; j <= i; j++) s += candles[j].close
    out.push({ time: candles[i].time, value: +(s / period).toFixed(2) })
  }
  return out
}

function lighten(hex) {
  try {
    const n = parseInt(hex.slice(1), 16)
    const r = Math.min(255, ((n>>16)&255) + 60)
    const g = Math.min(255, ((n>>8) &255) + 60)
    const b = Math.min(255,  (n     &255) + 60)
    return `rgb(${r},${g},${b})`
  } catch { return hex }
}

export default function Chart({
  candles, indicators, activeTool, onToolChange, drawColor = '#b86e2a', clearRef,
  drawingsKey, savedDrawings, onDrawingsChange,
  tradeMarkers,           // [{ time, position, color, shape, text }] — 回測買賣點標記
  labelText = '',         // 文字標注工具：當前輸入的文字
}) {
  const containerRef        = useRef(null)
  const activeToolRef       = useRef(activeTool)
  const drawColorRef        = useRef(drawColor)
  const onDrawingsChangeRef = useRef(onDrawingsChange)
  const onToolChangeRef     = useRef(onToolChange)
  const tradeMarkersRef     = useRef(tradeMarkers)
  const indicatorsRef       = useRef(indicators)
  const labelTextRef        = useRef(labelText)
  activeToolRef.current       = activeTool
  drawColorRef.current        = drawColor
  onDrawingsChangeRef.current = onDrawingsChange
  onToolChangeRef.current     = onToolChange
  indicatorsRef.current       = indicators
  labelTextRef.current        = labelText
  tradeMarkersRef.current     = tradeMarkers

  const S = useRef({
    chart: null, series: {},
    drawings: [],
    preview: null,
    selectedIdx: -1,
    hoverPt: null,
    candleMap: new Map(),   // time → candle（Ctrl 吸附用）
    ctrlHeld: false,
    snapPt: null,           // { x, y, price, time } Ctrl 吸附點
    redraw: null,
  })

  /* ── toPixel / hitTest：只用到 S，可放在元件層級 ── */
  // pt = { price, time }  ← 一般資料點（K 棒時間）
  //      { price, logical } ← 超出最後 K 棒的未來區域（logical index）
  function toPixel(pt) {
    if (!pt) return null
    const { chart, series } = S.current
    if (!chart || !series.candle) return null
    const { price, time, logical } = pt
    const x = (time != null)
      ? chart.timeScale().timeToCoordinate(time)
      : (logical != null ? chart.timeScale().logicalToCoordinate(logical) : null)
    const y = series.candle.priceToCoordinate(price)
    return (x != null && y != null) ? { x, y } : null
  }

  function hitTest(d, mx, my) {
    const { type, pts } = d
    if (!pts[0]) return false

    // ── 矩形：允許角點不在可視範圍（捲軸移出畫面 / 未來區域）──
    if (type === 'rectangle') {
      if (!pts[1]) return false
      const { chart, series } = S.current
      if (!chart || !series.candle) return false
      const ts = chart.timeScale()
      // 處理一般時間 & logical（未來區域）兩種端點
      const toX = (pt) => {
        if (pt.time != null) {
          const x = ts.timeToCoordinate(pt.time)
          if (x != null) return x
          const vr = ts.getVisibleRange()
          return vr ? (pt.time <= vr.from ? -99999 : 99999) : null
        }
        if (pt.logical != null) return ts.logicalToCoordinate(pt.logical) ?? 99999
        return null
      }
      const toY = (pt) => {
        const y = series.candle.priceToCoordinate(pt.price)
        if (y != null) return y
        const topPrice = series.candle.coordinateToPrice(0) ?? 0
        return pt.price >= topPrice ? -99999 : 99999
      }
      const x1 = toX(pts[0]), y1 = toY(pts[0])
      const x2 = toX(pts[1]), y2 = toY(pts[1])
      if (x1 == null || x2 == null) return false
      const [lx, rx] = [Math.min(x1, x2), Math.max(x1, x2)]
      const [ty, by] = [Math.min(y1, y2), Math.max(y1, y2)]
      return mx >= lx && mx <= rx && my >= ty && my <= by
    }

    const p1 = toPixel(pts[0])
    if (!p1) return false
    const T = 9
    if (type === 'horizontal') return Math.abs(my - p1.y) < T
    if (type === 'vertical')   return Math.abs(mx - p1.x) < T
    // 文字框：bounding box（同矩形）
    if (type === 'text') {
      if (!pts[1]) return Math.hypot(mx - p1.x, my - p1.y) < 12
      const p2t = toPixel(pts[1])
      if (!p2t) return false
      const [lx,rx] = [Math.min(p1.x,p2t.x), Math.max(p1.x,p2t.x)]
      const [ty,by] = [Math.min(p1.y,p2t.y), Math.max(p1.y,p2t.y)]
      return mx>=lx && mx<=rx && my>=ty && my<=by
    }
    if (!pts[1]) return false
    const p2 = toPixel(pts[1])
    if (!p2) return false
    if (type === 'arc') {
      // Cubic bezier U-shape: sample along curve + check draggable nadir handle
      const arcHt   = Math.abs(p2.x - p1.x)
      const arcDept = arcHt * (d.arcDepthFactor ?? 0.75)
      const cp1xt = p1.x, cp1yt = p1.y + arcDept
      const cp2xt = p2.x, cp2yt = p2.y + arcDept
      // nadir handle at bezier t=0.5
      const nadNx = 0.5*(p1.x+p2.x), nadNy = 0.5*(p1.y+p2.y) + 0.75*arcDept
      if (Math.hypot(mx - nadNx, my - nadNy) < 12) return true
      for (let ti = 0; ti <= 12; ti++) {
        const ta = ti / 12, oa = 1 - ta
        const bx = oa*oa*oa*p1.x + 3*oa*oa*ta*cp1xt + 3*oa*ta*ta*cp2xt + ta*ta*ta*p2.x
        const by = oa*oa*oa*p1.y + 3*oa*oa*ta*cp1yt + 3*oa*ta*ta*cp2yt + ta*ta*ta*p2.y
        if (Math.hypot(mx - bx, my - by) < T) return true
      }
      return false
    }
    const dx=p2.x-p1.x, dy=p2.y-p1.y, len2=dx*dx+dy*dy
    if (!len2) return Math.hypot(mx-p1.x, my-p1.y) < T
    const t = Math.max(0, Math.min(1, ((mx-p1.x)*dx+(my-p1.y)*dy)/len2))
    return Math.hypot(mx-p1.x-t*dx, my-p1.y-t*dy) < T
  }

  /* ── 圖表初始化 ───────────────────────────────────── */
  useEffect(() => {
    const ct = containerRef.current
    if (!ct) return

    const dpr = window.devicePixelRatio || 1

    // ── canvas 掛到 body，用 position:fixed 精確覆蓋圖表 ──
    const canvas = document.createElement('canvas')
    canvas.style.cssText = [
      'position:fixed',
      'top:0', 'left:0', 'width:0', 'height:0',
      'pointer-events:none',
      'z-index:9998',
    ].join(';')
    document.body.appendChild(canvas)

    // ── syncCanvas：根據圖表容器的螢幕位置更新 canvas ──
    function syncCanvas() {
      const rect = ct.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) return
      canvas.style.left   = rect.left   + 'px'
      canvas.style.top    = rect.top    + 'px'
      canvas.style.width  = rect.width  + 'px'
      canvas.style.height = rect.height + 'px'
      if (canvas.width  !== Math.round(rect.width  * dpr) ||
          canvas.height !== Math.round(rect.height * dpr)) {
        canvas.width  = Math.round(rect.width  * dpr)
        canvas.height = Math.round(rect.height * dpr)
        canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0)
      }
    }

    // ── paint 單一繪圖 ──────────────────────────────
    function paint(ctx, d, W, H, isPreview, selected) {
      const { type, pts, color = '#b86e2a' } = d
      if (!pts[0]) return
      const p1 = toPixel(pts[0])
      if (!p1) return
      const strokeColor = selected ? lighten(color) : color

      ctx.save()
      ctx.strokeStyle = strokeColor
      ctx.fillStyle   = strokeColor
      ctx.lineWidth   = selected ? 2.5 : 1.5
      ctx.setLineDash(isPreview ? [6, 4] : [])
      ctx.font = '11px Inter, system-ui, sans-serif'

      const p2 = pts[1]
        ? toPixel(pts[1])
        : (d.cursor ?? null)

      switch (type) {
        case 'horizontal': {
          ctx.beginPath(); ctx.moveTo(0, p1.y); ctx.lineTo(W, p1.y); ctx.stroke()
          ctx.setLineDash([])
          const lbl = pts[0].price.toFixed(2)
          const tw  = ctx.measureText(lbl).width + 10
          ctx.fillStyle = 'rgba(250,245,236,0.90)'
          ctx.fillRect(W - tw - 4, p1.y - 12, tw, 17)
          ctx.fillStyle = strokeColor
          ctx.fillText(lbl, W - tw, p1.y + 2)
          break
        }
        case 'vertical': {
          ctx.beginPath(); ctx.moveTo(p1.x, 0); ctx.lineTo(p1.x, H); ctx.stroke()
          break
        }
        case 'segment':
        case 'trendline':
        case 'ray': {
          if (!p2) break
          ctx.beginPath()
          if (!isPreview && pts[1]) {
            const dx = p2.x - p1.x, dy = p2.y - p1.y, sc = 8000
            if (type === 'trendline') {
              ctx.moveTo(p1.x - dx*sc, p1.y - dy*sc)
              ctx.lineTo(p2.x + dx*sc, p2.y + dy*sc)
            } else if (type === 'ray') {
              ctx.moveTo(p1.x, p1.y)
              ctx.lineTo(p2.x + dx*sc, p2.y + dy*sc)
            } else {
              ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y)
            }
          } else {
            ctx.moveTo(p1.x, p1.y); ctx.lineTo(p2.x, p2.y)
          }
          ctx.stroke(); ctx.setLineDash([])
          // 未選取時：小實心圓點；選取時由 switch 後的通用 handle 負責
          if (!selected) {
            const anchors = [p1, ...(pts[1] ? [toPixel(pts[1])] : [])].filter(Boolean)
            anchors.forEach(pt => {
              ctx.beginPath(); ctx.arc(pt.x, pt.y, 3, 0, Math.PI*2)
              ctx.fillStyle = strokeColor; ctx.fill()
              ctx.strokeStyle = 'rgba(250,245,236,0.9)'; ctx.lineWidth = 1.5; ctx.stroke()
            })
          }
          break
        }
        case 'rectangle': {
          if (!p2) break
          ctx.fillStyle = color + (selected ? '22' : '11')
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
            if (span != null)
              ctx.fillText((pts[0].price + span * r).toFixed(2), minX - 54, y + 4)
          })
          break
        }
        case 'arc': {
          if (!p2) break
          // Cubic bezier U/dome shape — arcDepthFactor controls curvature (draggable)
          const arcH     = Math.abs(p2.x - p1.x)
          const arcDepth = arcH * (d.arcDepthFactor ?? 0.75)
          const arcCp1x  = p1.x,  arcCp1y = p1.y + arcDepth
          const arcCp2x  = p2.x,  arcCp2y = p2.y + arcDepth
          // nadir/apex: cubic bezier midpoint (t=0.5)
          const nadX = 0.5 * (p1.x + p2.x)
          const nadY = 0.5 * (p1.y + p2.y) + 0.75 * arcDepth

          // 1. Semi-transparent fill (interior between chord and arc)
          ctx.save()
          ctx.setLineDash([])
          ctx.fillStyle = color + (isPreview ? '1a' : '2e')
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.bezierCurveTo(arcCp1x, arcCp1y, arcCp2x, arcCp2y, p2.x, p2.y)
          ctx.closePath()
          ctx.fill()
          ctx.restore()

          // 2. Arc outline (dashed in preview)
          ctx.strokeStyle = strokeColor
          ctx.lineWidth   = selected ? 2.5 : 1.5
          ctx.beginPath()
          ctx.moveTo(p1.x, p1.y)
          ctx.bezierCurveTo(arcCp1x, arcCp1y, arcCp2x, arcCp2y, p2.x, p2.y)
          ctx.stroke()
          ctx.setLineDash([])

          // 3. Endpoint anchor dots
          const arcAnchors = [p1, ...(pts[1] ? [toPixel(pts[1])] : [])].filter(Boolean)
          arcAnchors.forEach(pt => {
            ctx.beginPath(); ctx.arc(pt.x, pt.y, selected ? 5 : 3, 0, Math.PI * 2)
            ctx.fillStyle = strokeColor; ctx.fill()
            ctx.strokeStyle = 'rgba(250,245,236,0.9)'; ctx.lineWidth = 1.5; ctx.stroke()
          })

          // 4. Nadir/apex handle — draggable, visible when arc is selected
          if (selected && pts[1]) {
            ctx.save()
            ctx.setLineDash([])
            ctx.fillStyle   = 'rgba(250,245,236,0.95)'
            ctx.strokeStyle = strokeColor
            ctx.lineWidth   = 2
            ctx.beginPath(); ctx.arc(nadX, nadY, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke()
            // ↕ arrows hint
            ctx.lineWidth = 1.5
            ctx.beginPath()
            ctx.moveTo(nadX, nadY - 11); ctx.lineTo(nadX, nadY - 7)
            ctx.moveTo(nadX, nadY + 7);  ctx.lineTo(nadX, nadY + 11)
            ctx.stroke()
            ctx.restore()
          }

          // 5. % label at nadir — based on nadir PRICE so it live-updates while dragging
          //    placed arc: use coordinateToPrice(nadY) so dragging the handle updates the %
          //    preview:    use cursor price (end-point candidate)
          const arcLabelPrice = pts[1]
            ? (S.current.series?.candle?.coordinateToPrice(nadY) ?? null)
            : (isPreview ? (S.current.series?.candle?.coordinateToPrice(p2.y) ?? null) : null)
          if (arcLabelPrice != null) {
            const pct = (arcLabelPrice - pts[0].price) / pts[0].price * 100
            const pctLabel = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
            ctx.save()
            ctx.setLineDash([])
            ctx.font = 'bold 11px Inter, system-ui, sans-serif'
            const lbw = ctx.measureText(pctLabel).width + 14
            const lbh = 18
            const lbrx = nadX - lbw / 2
            // Cup (arcDepth≥0): label above nadir; Dome (arcDepth<0): below apex
            const lbry = arcDepth >= 0 ? nadY - lbh - 6 : nadY + 6
            ctx.fillStyle = pct >= 0 ? 'rgba(74,148,96,0.92)' : 'rgba(200,90,80,0.92)'
            ctx.beginPath()
            if (ctx.roundRect) ctx.roundRect(lbrx, lbry, lbw, lbh, 4)
            else ctx.rect(lbrx, lbry, lbw, lbh)
            ctx.fill()
            ctx.fillStyle = '#fff'
            ctx.textAlign = 'center'
            ctx.textBaseline = 'middle'
            ctx.fillText(pctLabel, nadX, lbry + lbh / 2)
            ctx.restore()
          }
          break
        }
        case 'text': {
          if (!p2) break
          const txt = d.text || ''
          ctx.save()
          ctx.setLineDash(isPreview ? [5, 3] : [])
          const bx2 = Math.min(p1.x, p2.x), by2 = Math.min(p1.y, p2.y)
          const bw2 = Math.abs(p2.x - p1.x), bh3 = Math.abs(p2.y - p1.y)
          // 半透明背景
          ctx.fillStyle = color + (selected ? '30' : '18')
          if (ctx.roundRect) ctx.roundRect(bx2, by2, bw2, bh3, 4)
          else ctx.rect(bx2, by2, bw2, bh3)
          ctx.fill()
          // 邊框
          ctx.strokeStyle = selected ? lighten(color) : color
          ctx.lineWidth   = selected ? 2 : 1.5
          ctx.beginPath()
          if (ctx.roundRect) ctx.roundRect(bx2, by2, bw2, bh3, 4)
          else ctx.rect(bx2, by2, bw2, bh3)
          ctx.stroke()
          // 文字居中（自動縮字）
          if (txt && bw2 > 8 && bh3 > 8) {
            ctx.setLineDash([])
            const maxW = bw2 - 8
            let   fs   = Math.min(14, bh3 - 8)
            if (fs >= 7) {
              ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`
              while (ctx.measureText(txt).width > maxW && fs > 7) {
                fs--; ctx.font = `600 ${fs}px Inter, system-ui, sans-serif`
              }
              ctx.fillStyle    = selected ? lighten(color) : color
              ctx.textAlign    = 'center'
              ctx.textBaseline = 'middle'
              ctx.fillText(txt, bx2 + bw2 / 2, by2 + bh3 / 2, maxW)
            }
          }
          ctx.restore()
          break
        }
      }

      // ── 通用端點 handle（選取 + 非預覽 + 非 arc，arc 有自己的 handle）──
      // 所有畫線選取後在端點顯示白圓，使用者可拖拉調整長度／形狀
      if (selected && !isPreview && type !== 'arc') {
        pts.forEach((pt, pi) => {
          if (!pt) return
          const pp = pi === 0 ? p1 : toPixel(pt)
          if (!pp) return
          ctx.save()
          ctx.setLineDash([])
          ctx.fillStyle   = 'rgba(250,245,236,0.95)'
          ctx.strokeStyle = strokeColor
          ctx.lineWidth   = 2
          ctx.beginPath(); ctx.arc(pp.x, pp.y, 6, 0, Math.PI * 2)
          ctx.fill(); ctx.stroke()
          ctx.restore()
        })
      }

      ctx.restore()
    }

    // ── redraw：清除並重繪所有圖層 ─────────────────
    function redraw() {
      if (canvas.width === 0 || canvas.height === 0) {
        syncCanvas()
        if (canvas.width === 0 || canvas.height === 0) return
      }
      const ctx = canvas.getContext('2d')
      const W = canvas.width / dpr, H = canvas.height / dpr
      ctx.clearRect(0, 0, W, H)

      const { drawings, preview, selectedIdx, snapPt } = S.current
      drawings.forEach((d, i) => paint(ctx, d, W, H, false, i === selectedIdx))
      if (preview) paint(ctx, preview, W, H, true, false)

      // Ctrl 吸附指示圈
      if (snapPt) {
        ctx.save()
        ctx.strokeStyle = '#b86e2a'
        ctx.lineWidth   = 1.5
        ctx.beginPath(); ctx.arc(snapPt.x, snapPt.y, 7, 0, Math.PI * 2); ctx.stroke()
        ctx.beginPath()
        ctx.moveTo(snapPt.x - 13, snapPt.y); ctx.lineTo(snapPt.x + 13, snapPt.y)
        ctx.moveTo(snapPt.x, snapPt.y - 13); ctx.lineTo(snapPt.x, snapPt.y + 13)
        ctx.stroke()
        ctx.restore()
      }
    }

    S.current.redraw = redraw

    // ── 建立圖表 ────────────────────────────────────
    const chart = createChart(ct, {
      width:  ct.clientWidth,
      height: ct.clientHeight,
      layout: { background:{ color:'#fdf8f0' }, textColor:'#7a5c38' },
      grid: {
        vertLines: { color:'rgba(140,100,60,0.09)' },
        horzLines: { color:'rgba(140,100,60,0.09)' },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color:'#b86e2a66', labelBackgroundColor:'#b86e2a' },
        horzLine: { color:'#b86e2a66', labelBackgroundColor:'#b86e2a' },
      },
      rightPriceScale: { borderColor:'rgba(140,100,60,0.18)' },
      timeScale: {
        borderColor: 'rgba(140,100,60,0.18)',
        timeVisible: true,
      },
      localization: {
        // 游標懸浮標籤：左年份　右月/日（日線）或 年份 月/日 時:分（分線）
        timeFormatter: (time) => {
          if (time == null) return ''
          // 日線：字串 "YYYY-MM-DD"
          if (typeof time === 'string') {
            return `${time.slice(0,4)}　${time.slice(5,7)}/${time.slice(8,10)}`
          }
          // BusinessDay { year, month, day }
          if (typeof time === 'object' && 'year' in time) {
            const m = String(time.month).padStart(2, '0')
            const d = String(time.day).padStart(2, '0')
            return `${time.year}　${m}/${d}`
          }
          // 分鐘線：unix timestamp（秒）
          if (typeof time !== 'number' || isNaN(time)) return ''
          const dt = new Date(time * 1000)
          if (isNaN(dt.getTime())) return ''
          const mo = String(dt.getMonth() + 1).padStart(2, '0')
          const dy = String(dt.getDate()).padStart(2, '0')
          const h  = String(dt.getHours()).padStart(2, '0')
          const mi = String(dt.getMinutes()).padStart(2, '0')
          return `${dt.getFullYear()}　${mo}/${dy}　${h}:${mi}`
        },
      },
    })
    S.current.chart = chart

    const cs = chart.addCandlestickSeries({
      upColor:CANDLE_UP, downColor:CANDLE_DOWN,
      borderVisible:false, wickUpColor:CANDLE_UP, wickDownColor:CANDLE_DOWN,
    })
    cs.priceScale().applyOptions({ scaleMargins:{ top:0.05, bottom:0.24 } })
    S.current.series.candle = cs

    const vs = chart.addHistogramSeries({ priceFormat:{ type:'volume' }, priceScaleId:'vol' })
    chart.priceScale('vol').applyOptions({ scaleMargins:{ top:0.82, bottom:0 } })
    S.current.series.volume = vs

    MA_CONFIG.forEach(({ key, color }) => {
      S.current.series[key] = chart.addLineSeries({
        color, lineWidth:1,
        priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false,
      })
    })

    // ── Bollinger Bands（主要價格軸，覆蓋在 K 棒上）──
    const bbOpts = { lineWidth:2, priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false }
    S.current.series.bbUpper  = chart.addLineSeries({ ...bbOpts, color:'#4a7ac8cc' })   // 實線，上軌
    S.current.series.bbMiddle = chart.addLineSeries({ ...bbOpts, color:'#4a7ac877', lineStyle:2 }) // 虛線，中軌
    S.current.series.bbLower  = chart.addLineSeries({ ...bbOpts, color:'#4a7ac8cc' })   // 實線，下軌

    // ── 成交量 MA5（'vol' 價格軸）──
    S.current.series.volMA = chart.addLineSeries({
      priceScaleId:'vol', color:'#c89050cc', lineWidth:1,
      priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false,
    })

    // ── RSI（獨立 'rsi' 價格軸）──
    const rsiSeries = chart.addLineSeries({
      priceScaleId:'rsi', color:'#9068b8', lineWidth:2,
      priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false,
    })
    // 參考線 70 / 50 / 30
    rsiSeries.createPriceLine({ price:70, color:'#c85a5055', lineWidth:1, lineStyle:1, axisLabelVisible:true, title:'70' })
    rsiSeries.createPriceLine({ price:50, color:'#7a5c3844', lineWidth:1, lineStyle:2, axisLabelVisible:false })
    rsiSeries.createPriceLine({ price:30, color:'#4a946855', lineWidth:1, lineStyle:1, axisLabelVisible:true, title:'30' })
    S.current.series.rsi = rsiSeries

    // ── MACD（獨立 'macd' 價格軸）──
    S.current.series.macdHist = chart.addHistogramSeries({
      priceScaleId:'macd', priceLineVisible:false, lastValueVisible:false,
    })
    S.current.series.macdLine = chart.addLineSeries({
      priceScaleId:'macd', color:'#5a8ec8', lineWidth:2,
      priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false,
    })
    S.current.series.macdSignal = chart.addLineSeries({
      priceScaleId:'macd', color:'#c85a50', lineWidth:2,
      priceLineVisible:false, lastValueVisible:false, crosshairMarkerVisible:false,
    })
    // MACD 零軸
    S.current.series.macdLine.createPriceLine({ price:0, color:'#7a5c3866', lineWidth:1, lineStyle:2, axisLabelVisible:false })

    // ── OHLC 資訊列（頂部懸浮 legend）──────────────
    const legend = document.createElement('div')
    legend.className = 'chart-ohlc-legend'
    legend.style.pointerEvents = 'none'   // 不攔截滑鼠事件，讓 subscribeClick 正常運作
    ct.appendChild(legend)

    function fmtVol(v) {
      if (v == null || isNaN(v)) return '--'
      if (v >= 1e8) return (v / 1e8).toFixed(1) + '億'
      if (v >= 1e4) return (v / 1e4).toFixed(0) + '萬'
      return String(v)
    }
    // 台股：1 張 = 1,000 股，成交張數 = volume / 1000
    function fmtZhang(v) {
      if (v == null || isNaN(v)) return '--'
      const z = Math.round(v / 1000)
      if (z >= 10000) return (z / 10000).toFixed(1) + '萬張'
      return z.toLocaleString() + '張'
    }
    function fmtTime(t) {
      if (t == null) return ''
      // 日線：lightweight-charts 傳回字串 "YYYY-MM-DD"
      if (typeof t === 'string') {
        const m = t.slice(5, 7)
        const d = t.slice(8, 10)
        return `${t.slice(0, 4)}　${m}/${d}`
      }
      // BusinessDay 物件 { year, month, day }
      if (typeof t === 'object' && 'year' in t) {
        const m = String(t.month).padStart(2, '0')
        const d = String(t.day).padStart(2, '0')
        return `${t.year}　${m}/${d}`
      }
      // 分鐘線：unix timestamp（秒）
      if (typeof t !== 'number' || isNaN(t)) return ''
      const dt = new Date(t * 1000)
      if (isNaN(dt.getTime())) return ''
      const mo = String(dt.getMonth() + 1).padStart(2, '0')
      const dy = String(dt.getDate()).padStart(2, '0')
      const h  = String(dt.getHours()).padStart(2, '0')
      const mi = String(dt.getMinutes()).padStart(2, '0')
      return `${dt.getFullYear()}　${mo}/${dy}　${h}:${mi}`
    }

    // 圖表滾動/縮放 → 重繪覆蓋層
    chart.timeScale().subscribeVisibleLogicalRangeChange(redraw)

    // crosshair 移動
    chart.subscribeCrosshairMove(param => {
      S.current.hoverPt = param.point || null

      // ── 更新 OHLC legend ──
      if (!param.time || !param.point) {
        legend.style.opacity = '0'
      } else {
        const ohlc = param.seriesData?.get(cs)
        const volD = param.seriesData?.get(vs)
        if (ohlc && ohlc.open != null && !isNaN(ohlc.open)) {
          const up    = ohlc.close >= ohlc.open
          const ma5D  = param.seriesData?.get(S.current.series.ma5)
          const ma5v  = (ma5D?.value != null && !isNaN(ma5D.value)) ? ma5D.value.toFixed(2) : '--'
          legend.innerHTML =
            `<span class="lg-date">${fmtTime(param.time)}</span>` +
            `<span class="lg-item">開<b>${ohlc.open.toFixed(2)}</b></span>` +
            `<span class="lg-item">高<b style="color:#c85a50">${ohlc.high.toFixed(2)}</b></span>` +
            `<span class="lg-item">低<b style="color:#4a9468">${ohlc.low.toFixed(2)}</b></span>` +
            `<span class="lg-item">收<b style="color:${up ? '#c85a50' : '#4a9468'}">${ohlc.close.toFixed(2)}</b></span>` +
            `<span class="lg-item">量<b>${fmtVol(volD?.value)}</b></span>` +
            `<span class="lg-item">張<b>${fmtZhang(volD?.value)}</b></span>` +
            `<span class="lg-item" style="color:#b86e2a">MA5<b>${ma5v}</b></span>`
          legend.style.opacity = '1'
        } else {
          legend.style.opacity = '0'
        }
      }

      // ── Ctrl 吸附：找最近 K 棒的最高/最低點 ──
      let snapPt = null
      if (S.current.ctrlHeld && param.time && param.point) {
        const candle = S.current.candleMap.get(param.time)
        if (candle) {
          const highY = cs.priceToCoordinate(candle.high)
          const lowY  = cs.priceToCoordinate(candle.low)
          if (highY != null && lowY != null) {
            const snapPrice = param.point.y <= (highY + lowY) / 2 ? candle.high : candle.low
            const snapY = cs.priceToCoordinate(snapPrice)
            const snapX = chart.timeScale().timeToCoordinate(param.time)
            if (snapY != null && snapX != null) {
              snapPt = { x: snapX, y: snapY, price: snapPrice, time: param.time }
            }
          }
        }
      }
      S.current.snapPt = snapPt

      // preview 虛線終點：有吸附就用吸附座標
      if (param.point && S.current.preview) {
        S.current.preview.cursor = snapPt
          ? { x: snapPt.x, y: snapPt.y }
          : param.point
      }
      redraw()
    })

    // 點擊 → 畫線
    let _wasDragging = false   // 拖拉結束後防止 subscribeClick 誤清選取
    chart.subscribeClick(param => {
      const tool = activeToolRef.current

      if (tool === 'cursor') {
        if (_wasDragging) { _wasDragging = false; return }   // 拖拉結束不改選取
        if (param.point) {
          const { x, y } = param.point
          let hit = -1
          for (let i = S.current.drawings.length - 1; i >= 0; i--) {
            if (hitTest(S.current.drawings[i], x, y)) { hit = i; break }
          }
          S.current.selectedIdx = hit
          redraw()
        }
        return
      }

      if (!param.point) return
      // param.time 在無 K 棒區域可能為 null，先試 coordinateToTime 兜底
      const clickTime = param.time ?? chart.timeScale().coordinateToTime?.(param.point.x)

      // ── 決定資料點（有 Ctrl 吸附就用吸附值）──
      let dp
      let cursorForPreview = param.point
      if (S.current.ctrlHeld && S.current.snapPt) {
        const sp = S.current.snapPt
        dp = { time: sp.time, price: sp.price }
        cursorForPreview = { x: sp.x, y: sp.y }
      } else {
        let price = cs.coordinateToPrice(param.point.y)
        if (price == null) {
          for (let step = 5; step <= 200; step += 5) {
            price = cs.coordinateToPrice(Math.max(0, param.point.y - step))
                    ?? cs.coordinateToPrice(param.point.y + step)
            if (price != null) break
          }
        }
        if (price == null) return
        if (clickTime) {
          dp = { time: clickTime, price: Number(price) }
        } else {
          // 超出最後 K 棒的未來區域：改用 logical index 記錄 x 位置
          const logical = chart.timeScale().coordinateToLogical?.(param.point.x) ?? null
          if (logical == null) return
          dp = { time: null, logical, price: Number(price) }
        }
      }

      const color = drawColorRef.current
      const oneClick = tool === 'horizontal' || tool === 'vertical'

      if (!S.current.preview) {
        if (oneClick) {
          S.current.drawings.push({ type: tool, pts: [dp], color })
          onDrawingsChangeRef.current?.(S.current.drawings)
        } else {
          // 文字工具：第一點記錄文字內容
          const extra = tool === 'text'
            ? { text: labelTextRef.current.trim() || '文字' }
            : {}
          S.current.preview = { type: tool, pts: [dp], color, cursor: cursorForPreview, ...extra }
        }
      } else {
        const prev = S.current.preview
        // 文字工具：第二點完成文字框（需帶入 text）
        const extra = prev.text != null ? { text: prev.text } : {}
        S.current.drawings.push({ type: prev.type, pts: [...prev.pts, dp], color: prev.color, ...extra })
        S.current.preview = null
        onDrawingsChangeRef.current?.(S.current.drawings)
      }
      redraw()
    })

    syncCanvas()
    redraw()

    // ── Arc nadir drag (adjust curvature after placement) ────────────
    let arcDrag = null

    function getArcNadir(d) {
      if (d.type !== 'arc' || !d.pts[1]) return null
      const pp1 = toPixel(d.pts[0])
      const pp2 = toPixel(d.pts[1])
      if (!pp1 || !pp2) return null
      const aw = Math.abs(pp2.x - pp1.x)
      const ad = aw * (d.arcDepthFactor ?? 0.75)
      return { x: 0.5*(pp1.x+pp2.x), y: 0.5*(pp1.y+pp2.y)+0.75*ad,
               midY: 0.5*(pp1.y+pp2.y), w: aw }
    }

    function onArcMouseDown(e) {
      if (activeToolRef.current !== 'cursor') return
      const { selectedIdx, drawings } = S.current
      if (selectedIdx < 0) return
      const d = drawings[selectedIdx]
      if (d?.type !== 'arc') return
      const rect = ct.getBoundingClientRect()
      const nad  = getArcNadir(d)
      if (!nad) return
      if (Math.hypot(e.clientX - rect.left - nad.x, e.clientY - rect.top - nad.y) > 12) return
      arcDrag = { idx: selectedIdx, midY: nad.midY, w: nad.w }
      // Prevent chart pan during drag
      chart.applyOptions({ handleScroll: { pressedMouseMove: false, mouseWheel: true, horzTouchDrag: false } })
      ct.style.cursor = 'ns-resize'
      e.stopPropagation()
    }

    function onArcMouseMove(e) {
      const rect = ct.getBoundingClientRect()
      if (arcDrag) {
        const my = e.clientY - rect.top
        const { idx, midY, w } = arcDrag
        const raw = w > 0 ? (my - midY) / (0.75 * w) : 0.75
        S.current.drawings[idx] = {
          ...S.current.drawings[idx],
          arcDepthFactor: Math.max(-2.5, Math.min(3, raw)),
        }
        redraw()
        return
      }
      // Show ns-resize cursor when hovering over nadir handle
      if (activeToolRef.current === 'cursor') {
        const { selectedIdx, drawings } = S.current
        if (selectedIdx >= 0 && drawings[selectedIdx]?.type === 'arc') {
          const nad = getArcNadir(drawings[selectedIdx])
          if (nad && Math.hypot(e.clientX - rect.left - nad.x, e.clientY - rect.top - nad.y) <= 12) {
            ct.style.cursor = 'ns-resize'
            return
          }
        }
        if (ct.style.cursor === 'ns-resize') ct.style.cursor = 'default'
      }
    }

    function onArcMouseUp() {
      if (!arcDrag) return
      arcDrag = null
      chart.applyOptions({ handleScroll: { pressedMouseMove: true, mouseWheel: true, horzTouchDrag: true } })
      ct.style.cursor = 'default'
      onDrawingsChangeRef.current?.(S.current.drawings)
    }

    ct.addEventListener('mousedown', onArcMouseDown, true)
    ct.addEventListener('mousemove', onArcMouseMove, true)
    ct.addEventListener('mouseup',   onArcMouseUp,   true)

    // ── 游標模式：拖拉移動畫線 ────────────────────────────────────────
    let moveDrag      = null   // { drawingIdx, startCX, startCY, originalPts, type }
    let potentialDrag = null   // 尚未確認是拖拉，等超過 5px
    let endptDrag     = null   // { drawingIdx, ptIdx } — 端點拖拉（改長度/形狀）

    function onMoveMouseDown(e) {
      if (activeToolRef.current !== 'cursor') return
      if (arcDrag) return   // arc nadir 拖拉優先
      const rect = ct.getBoundingClientRect()
      const x = e.clientX - rect.left, y = e.clientY - rect.top

      // ── 優先：偵測是否點到已選取畫線的端點 handle ──
      const { selectedIdx, drawings } = S.current
      if (selectedIdx >= 0) {
        const d = drawings[selectedIdx]
        for (let pi = 0; pi < d.pts.length; pi++) {
          const pp = pi === 0
            ? toPixel(d.pts[0])
            : toPixel(d.pts[pi])
          if (pp && Math.hypot(x - pp.x, y - pp.y) < 10) {
            endptDrag = { drawingIdx: selectedIdx, ptIdx: pi }
            chart.applyOptions({ handleScroll: { pressedMouseMove: false, mouseWheel: true, horzTouchDrag: false } })
            ct.style.cursor = 'crosshair'
            e.stopPropagation()
            return
          }
        }
      }

      // ── 整條拖拉 ──
      let hit = -1
      for (let i = drawings.length - 1; i >= 0; i--) {
        if (hitTest(drawings[i], x, y)) { hit = i; break }
      }
      if (hit < 0) return
      potentialDrag = {
        drawingIdx: hit,
        startCX: e.clientX, startCY: e.clientY,
        originalPts: drawings[hit].pts.map(p => ({ ...p })),
        type: drawings[hit].type,
      }
    }

    function onMoveMouseMove(e) {
      const rect = ct.getBoundingClientRect()

      // ── 端點拖拉：只更新單一端點（改長度 / 形狀）──
      if (endptDrag) {
        const mx = e.clientX - rect.left, my = e.clientY - rect.top
        const { chart: c, series } = S.current
        if (!c || !series.candle) return
        const ts  = c.timeScale()
        const cs2 = series.candle
        const d   = S.current.drawings[endptDrag.drawingIdx]
        const isH = d.type === 'horizontal'
        const isV = d.type === 'vertical'
        const origPt = d.pts[endptDrag.ptIdx]
        // 水平線只改 price（y），垂直線只改 time（x）
        const price = isV ? origPt.price : Number(cs2.coordinateToPrice(my) ?? origPt.price)
        let newPt
        if (isH) {
          newPt = { ...origPt, price }
        } else {
          const newTime = ts.coordinateToTime(mx)
          if (newTime != null) {
            newPt = { time: newTime, price }
          } else {
            const newLogical = ts.coordinateToLogical(mx)
            newPt = newLogical != null ? { time: null, logical: newLogical, price } : origPt
          }
        }
        const newPts = [...d.pts]
        newPts[endptDrag.ptIdx] = newPt
        S.current.drawings[endptDrag.drawingIdx] = { ...d, pts: newPts }
        redraw()
        return
      }

      // ── 整條拖拉中：即時更新端點位置 ──
      if (moveDrag) {
        const dx = e.clientX - moveDrag.startCX
        const dy = e.clientY - moveDrag.startCY
        const { chart: c, series } = S.current
        if (!c || !series.candle) return
        const ts  = c.timeScale()
        const cs2 = series.candle
        const isH = moveDrag.type === 'horizontal'  // 水平線：只移 y
        const isV = moveDrag.type === 'vertical'    // 垂直線：只移 x
        const newPts = moveDrag.originalPts.map(pt => {
          const origX = pt.time != null
            ? ts.timeToCoordinate(pt.time)
            : (pt.logical != null ? ts.logicalToCoordinate(pt.logical) : null)
          const origY = cs2.priceToCoordinate(pt.price)
          if (origX == null || origY == null) return pt
          const newX = isH ? origX : origX + dx
          const newY = isV ? origY : origY + dy
          const newPrice = isV ? pt.price : Number(cs2.coordinateToPrice(newY) ?? pt.price)
          if (isH) return { ...pt, price: newPrice }
          const newTime = ts.coordinateToTime(newX)
          if (newTime != null) return { time: newTime, price: newPrice }
          const newLogical = ts.coordinateToLogical(newX)
          return newLogical != null ? { time: null, logical: newLogical, price: newPrice } : pt
        })
        S.current.drawings[moveDrag.drawingIdx] = {
          ...S.current.drawings[moveDrag.drawingIdx], pts: newPts,
        }
        S.current.selectedIdx = moveDrag.drawingIdx
        redraw()
        return
      }

      // ── 超過 5px 才正式啟動拖拉 ──
      if (potentialDrag) {
        if (Math.hypot(e.clientX - potentialDrag.startCX, e.clientY - potentialDrag.startCY) > 5) {
          moveDrag = potentialDrag
          potentialDrag = null
          chart.applyOptions({ handleScroll: { pressedMouseMove: false, mouseWheel: true, horzTouchDrag: false } })
          ct.style.cursor = 'grabbing'
        }
        return
      }

      // ── 懸停：顯示 grab cursor（ns-resize / grabbing 不覆蓋）──
      if (activeToolRef.current === 'cursor' && !arcDrag) {
        const cur = ct.style.cursor
        if (cur !== 'ns-resize' && cur !== 'grabbing') {
          const x = e.clientX - rect.left, y = e.clientY - rect.top
          let onAny = false
          for (let i = S.current.drawings.length - 1; i >= 0; i--) {
            if (hitTest(S.current.drawings[i], x, y)) { onAny = true; break }
          }
          ct.style.cursor = onAny ? 'grab' : 'default'
        }
      }
    }

    function onMoveMouseUp() {
      potentialDrag = null
      if (endptDrag) {
        endptDrag = null
        _wasDragging = true
        chart.applyOptions({ handleScroll: { pressedMouseMove: true, mouseWheel: true, horzTouchDrag: true } })
        ct.style.cursor = 'default'
        onDrawingsChangeRef.current?.(S.current.drawings)
        return
      }
      if (!moveDrag) return
      _wasDragging = true
      chart.applyOptions({ handleScroll: { pressedMouseMove: true, mouseWheel: true, horzTouchDrag: true } })
      ct.style.cursor = 'default'
      onDrawingsChangeRef.current?.(S.current.drawings)
      moveDrag = null
    }

    ct.addEventListener('mousedown', onMoveMouseDown, true)
    ct.addEventListener('mousemove', onMoveMouseMove, true)
    ct.addEventListener('mouseup',   onMoveMouseUp,   true)

    const ro = new ResizeObserver(() => {
      chart.applyOptions({ width:ct.clientWidth, height:ct.clientHeight })
      syncCanvas(); redraw()
    })
    ro.observe(ct)

    // 視窗滾動也要更新 canvas 位置
    const onScroll = () => { syncCanvas(); redraw() }
    window.addEventListener('scroll', onScroll, true)

    return () => {
      ro.disconnect()
      window.removeEventListener('scroll', onScroll, true)
      ct.removeEventListener('mousedown', onArcMouseDown, true)
      ct.removeEventListener('mousemove', onArcMouseMove, true)
      ct.removeEventListener('mouseup',   onArcMouseUp,   true)
      ct.removeEventListener('mousedown', onMoveMouseDown, true)
      ct.removeEventListener('mousemove', onMoveMouseMove, true)
      ct.removeEventListener('mouseup',   onMoveMouseUp,   true)
      chart.remove()
      document.body.removeChild(canvas)
      if (ct.contains(legend)) ct.removeChild(legend)
      S.current.chart = null
      S.current.series = {}
      S.current.redraw = null
    }
  }, [])

  /* ── 資料 ─────────────────────────────────────── */
  useEffect(() => {
    if (!candles?.length) return
    const { series, chart } = S.current
    series.candle?.setData(candles.map(c => ({ time:c.time, open:c.open, high:c.high, low:c.low, close:c.close })))
    series.volume?.setData(candles.map(c => ({
      time:c.time, value:c.volume,
      color: c.close >= c.open ? `${CANDLE_UP}60` : `${CANDLE_DOWN}60`,
    })))
    MA_CONFIG.forEach(({ key, period }) => series[key]?.setData(calcMA(candles, period)))

    // ── 技術指標 ──
    const bb     = calcBB(candles)
    series.bbUpper?.setData(bb.upper)
    series.bbMiddle?.setData(bb.middle)
    series.bbLower?.setData(bb.lower)
    series.volMA?.setData(calcVolMA(candles))
    series.rsi?.setData(calcRSI(candles))
    const macd = calcMACD(candles)
    series.macdHist?.setData(macd.hist)
    series.macdLine?.setData(macd.macd)
    series.macdSignal?.setData(macd.signal)

    // ── 套用目前的佈局（RSI/MACD 子圖高度）──
    const ind = indicatorsRef.current
    _applyPaneLayout(chart, series.candle, ind?.rsi, ind?.macd)

    // 建立 time → candle 的快速查表（Ctrl 吸附用）
    S.current.candleMap = new Map(candles.map(c => [c.time, c]))
    // 資料載入後套用回測標記（若有）
    const tm = tradeMarkersRef.current
    if (tm?.length) {
      series.candle?.setMarkers(tm)
      _scrollToMarkers(chart, tm)
    } else {
      chart?.timeScale().fitContent()
    }
  }, [candles])

  /* ── 回測標記 ─────────────────────────────────── */
  useEffect(() => {
    const { series, chart } = S.current
    if (!series?.candle) return
    if (!tradeMarkers?.length) {
      series.candle.setMarkers([])
      chart?.timeScale().fitContent()
      return
    }
    series.candle.setMarkers(tradeMarkers)
    _scrollToMarkers(chart, tradeMarkers)
  }, [tradeMarkers])

  /* ── 指標開關（MA + BB + VolMA + RSI + MACD）── */
  useEffect(() => {
    if (!indicators) return
    const { series, chart } = S.current
    MA_CONFIG.forEach(({ key }) =>
      series[key]?.applyOptions({ visible: indicators[key] !== false })
    )
    // BB
    const showBB = !!indicators.bb
    series.bbUpper?.applyOptions({ visible: showBB })
    series.bbMiddle?.applyOptions({ visible: showBB })
    series.bbLower?.applyOptions({ visible: showBB })
    // VolMA
    series.volMA?.applyOptions({ visible: !!indicators.volMA })
    // RSI / MACD 需要重排佈局
    const showRSI  = !!indicators.rsi
    const showMACD = !!indicators.macd
    series.rsi?.applyOptions({ visible: showRSI })
    series.macdHist?.applyOptions({ visible: showMACD })
    series.macdLine?.applyOptions({ visible: showMACD })
    series.macdSignal?.applyOptions({ visible: showMACD })
    _applyPaneLayout(chart, series.candle, showRSI, showMACD)
  }, [indicators])

  /* ── 清除全部 ─────────────────────────────────── */
  useEffect(() => {
    if (clearRef) clearRef.current = () => {
      S.current.drawings = []; S.current.preview = null; S.current.selectedIdx = -1
      S.current.redraw?.()
      onDrawingsChangeRef.current?.([])
    }
  }, [clearRef])

  /* ── 股票/週期切換：載入對應的已儲存畫線 ────── */
  useEffect(() => {
    S.current.drawings    = savedDrawings?.length ? [...savedDrawings] : []
    S.current.preview     = null
    S.current.selectedIdx = -1
    S.current.snapPt      = null
    S.current.redraw?.()
  }, [drawingsKey])

  /* ── 鍵盤快捷鍵 ───────────────────────────────── */
  useEffect(() => {
    function onKeyDown(e) {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return

      // 追蹤 Ctrl 按住狀態
      if (e.key === 'Control') { S.current.ctrlHeld = true; return }

      // Ctrl+Z 還原
      if (e.ctrlKey && e.key === 'z') {
        e.preventDefault()
        if (S.current.preview) {
          S.current.preview = null
        } else if (S.current.drawings.length) {
          S.current.drawings = S.current.drawings.slice(0, -1)
          onDrawingsChangeRef.current?.(S.current.drawings)
        }
        S.current.redraw?.()
        return
      }

      if (e.key === 'Escape') {
        S.current.preview = null
        S.current.selectedIdx = -1
        S.current.redraw?.()
        // 若正在使用畫線工具，Esc 切回游標
        if (activeToolRef.current !== 'cursor') {
          onToolChangeRef.current?.('cursor')
        }
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const { selectedIdx, drawings } = S.current
        if (selectedIdx >= 0) {
          S.current.drawings = drawings.filter((_, i) => i !== selectedIdx)
          S.current.selectedIdx = -1
        } else if (drawings.length) {
          S.current.drawings = drawings.slice(0, -1)
        }
        S.current.redraw?.()
        onDrawingsChangeRef.current?.(S.current.drawings)
      }
    }

    function onKeyUp(e) {
      if (e.key === 'Control') {
        S.current.ctrlHeld = false
        S.current.snapPt   = null
        S.current.redraw?.()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup',   onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup',   onKeyUp)
    }
  }, [])

  /* ── 畫線模式：停用拖曳平移 ───────────────────── */
  useEffect(() => {
    const { chart } = S.current
    if (!chart) return
    const drawing = activeTool !== 'cursor'
    chart.applyOptions({
      handleScroll: { pressedMouseMove: !drawing, mouseWheel: true, horzTouchDrag: !drawing },
      handleScale:  { mouseWheel: true, pinch: true, axisPressedMouseMove: !drawing },
    })
    if (containerRef.current) {
      containerRef.current.style.cursor = drawing ? 'crosshair' : 'default'
    }
  }, [activeTool])

  return (
    <div ref={containerRef} style={{ width:'100%', height:'100%' }} />
  )
}
