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
  candles, indicators, activeTool, drawColor = '#b86e2a', clearRef,
  drawingsKey, savedDrawings, onDrawingsChange,
  tradeMarkers,   // [{ time, position, color, shape, text }] — 回測買賣點標記
}) {
  const containerRef        = useRef(null)
  const activeToolRef       = useRef(activeTool)
  const drawColorRef        = useRef(drawColor)
  const onDrawingsChangeRef = useRef(onDrawingsChange)
  const tradeMarkersRef     = useRef(tradeMarkers)
  activeToolRef.current       = activeTool
  drawColorRef.current        = drawColor
  onDrawingsChangeRef.current = onDrawingsChange
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
  function toPixel(price, time) {
    const { chart, series } = S.current
    if (!chart || !series.candle) return null
    const x = chart.timeScale().timeToCoordinate(time)
    const y = series.candle.priceToCoordinate(price)
    return (x != null && y != null) ? { x, y } : null
  }

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
      const p1 = toPixel(pts[0].price, pts[0].time)
      if (!p1) return
      const strokeColor = selected ? lighten(color) : color

      ctx.save()
      ctx.strokeStyle = strokeColor
      ctx.fillStyle   = strokeColor
      ctx.lineWidth   = selected ? 2.5 : 1.5
      ctx.setLineDash(isPreview ? [6, 4] : [])
      ctx.font = '11px Inter, system-ui, sans-serif'

      const p2 = pts[1]
        ? toPixel(pts[1].price, pts[1].time)
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
          const anchors = [p1, ...(pts[1] ? [toPixel(pts[1].price, pts[1].time)] : [])].filter(Boolean)
          anchors.forEach(pt => {
            ctx.beginPath(); ctx.arc(pt.x, pt.y, selected ? 5 : 3, 0, Math.PI*2)
            ctx.fillStyle = strokeColor; ctx.fill()
            ctx.strokeStyle = 'rgba(250,245,236,0.9)'; ctx.lineWidth = 1.5; ctx.stroke()
          })
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
          if (time !== null && typeof time === 'object' && 'year' in time) {
            // 日線/週線/月線：BusinessDay { year, month, day }
            const m = String(time.month).padStart(2, '0')
            const d = String(time.day).padStart(2, '0')
            return `${time.year}　${m}/${d}`
          }
          // 分鐘線：unix timestamp（秒）
          const dt = new Date(time * 1000)
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

    // ── OHLC 資訊列（頂部懸浮 legend）──────────────
    const legend = document.createElement('div')
    legend.className = 'chart-ohlc-legend'
    ct.appendChild(legend)

    function fmtVol(v) {
      if (v == null || isNaN(v)) return '--'
      if (v >= 1e8) return (v / 1e8).toFixed(1) + '億'
      if (v >= 1e4) return (v / 1e4).toFixed(0) + '萬'
      return String(v)
    }
    function fmtTime(t) {
      if (t == null) return ''
      if (typeof t === 'object' && 'year' in t) {
        const m = String(t.month).padStart(2, '0')
        const d = String(t.day).padStart(2, '0')
        return `${t.year}　${m}/${d}`
      }
      const dt = new Date(t * 1000)
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
          const up = ohlc.close >= ohlc.open
          legend.innerHTML =
            `<span class="lg-date">${fmtTime(param.time)}</span>` +
            `<span class="lg-item">開<b>${ohlc.open.toFixed(2)}</b></span>` +
            `<span class="lg-item">高<b style="color:#c85a50">${ohlc.high.toFixed(2)}</b></span>` +
            `<span class="lg-item">低<b style="color:#4a9468">${ohlc.low.toFixed(2)}</b></span>` +
            `<span class="lg-item">收<b style="color:${up ? '#c85a50' : '#4a9468'}">${ohlc.close.toFixed(2)}</b></span>` +
            `<span class="lg-item">量<b>${fmtVol(volD?.value)}</b></span>`
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
    chart.subscribeClick(param => {
      const tool = activeToolRef.current

      if (tool === 'cursor') {
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

      if (!param.point || !param.time) return

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
        dp = { time: param.time, price: Number(price) }
      }

      const color = drawColorRef.current
      const oneClick = tool === 'horizontal' || tool === 'vertical'

      if (!S.current.preview) {
        if (oneClick) {
          S.current.drawings.push({ type: tool, pts: [dp], color })
          onDrawingsChangeRef.current?.(S.current.drawings)
        } else {
          S.current.preview = { type: tool, pts: [dp], color, cursor: cursorForPreview }
        }
      } else {
        const prev = S.current.preview
        S.current.drawings.push({ type: prev.type, pts: [...prev.pts, dp], color: prev.color })
        S.current.preview = null
        onDrawingsChangeRef.current?.(S.current.drawings)
      }
      redraw()
    })

    syncCanvas()
    redraw()

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

  /* ── MA 開關 ──────────────────────────────────── */
  useEffect(() => {
    if (!indicators) return
    MA_CONFIG.forEach(({ key }) =>
      S.current.series[key]?.applyOptions({ visible: indicators[key] !== false })
    )
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
        S.current.preview = null; S.current.selectedIdx = -1; S.current.redraw?.()
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
