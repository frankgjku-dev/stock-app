import { useState, useEffect, useRef } from 'react'
import { API_BASE } from '../config'

/** 判斷目前是否在台股交易時段（前端時區無關，直接算台北時間） */
function isTWMarketOpen() {
  const tw = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Taipei' }))
  const d = tw.getDay()                           // 0=日, 6=六
  if (d === 0 || d === 6) return false
  const t = tw.getHours() * 60 + tw.getMinutes()
  return t >= 9 * 60 && t <= 13 * 60 + 40        // 09:00 ~ 13:40
}

export default function useStockData(symbol, interval, period) {
  const [candles, setCandles] = useState([])
  const [quote,   setQuote]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const pollRef = useRef(null)

  // Historical candles（最多重試 3 次，避免 yfinance rate-limit 暫時失敗）
  useEffect(() => {
    if (!symbol) return
    setLoading(true)
    setError(null)
    setCandles([])   // 切換股票時立即清掉舊K線，避免顯示錯誤股票的圖

    // 分鐘線在目前伺服器環境不支援，直接提示
    const isIntraday = !['1d','1wk','1mo'].includes(interval)
    if (isIntraday) {
      setError('分鐘線資料目前不支援，請切換至「日」線')
      setLoading(false)
      return
    }

    const url = `${API_BASE}/api/stocks/${symbol}/candles?interval=${interval}&period=${period}`;

    (async () => {
      let lastErr = ''
      for (let i = 0; i < 3; i++) {
        try {
          if (i > 0) await new Promise(r => setTimeout(r, 2000))
          const res = await fetch(url)
          const ct  = res.headers.get('content-type') || ''
          if (!ct.includes('application/json')) {
            lastErr = '後端服務啟動中，請稍候再試…'
            continue
          }
          const data = await res.json()
          if (data.candles?.length) {
            setCandles(data.candles)
            setError(null)
            setLoading(false)
            return
          }
          lastErr = data.error || '查無資料'
        } catch (e) {
          lastErr = '網路錯誤，請稍後重試'
        }
      }
      setError(lastErr)
      setLoading(false)
    })()
  }, [symbol, interval, period])

  // ── 開盤期間每 3 分鐘靜默刷新日線 K 棒 ──────────────────────
  // 後端已設定開盤期間 TTL=3min，前端也同步輪詢，確保當日 K 棒即時出現
  useEffect(() => {
    if (!symbol || !['1d','1wk','1mo'].includes(interval)) return

    const url = `${API_BASE}/api/stocks/${symbol}/candles?interval=${interval}&period=${period}`

    async function silentRefresh() {
      if (!isTWMarketOpen()) return
      try {
        const res = await fetch(url)
        const ct  = res.headers.get('content-type') || ''
        if (!ct.includes('application/json')) return
        const data = await res.json()
        if (data.candles?.length) setCandles(data.candles)   // 直接更新，不觸發 loading
      } catch { /* 靜默失敗 */ }
    }

    const timer = setInterval(silentRefresh, 3 * 60 * 1000)  // 每 3 分鐘
    return () => clearInterval(timer)
  }, [symbol, interval, period])

  // Real-time quote polling (every 30 s)
  useEffect(() => {
    if (!symbol) return

    async function fetchQuote() {
      try {
        const r  = await fetch(`${API_BASE}/api/stocks/${symbol}/quote`)
        const ct = r.headers.get('content-type') || ''
        if (!ct.includes('application/json')) return
        const data = await r.json()
        if (!data.error) setQuote(data)
      } catch { /* network error — keep last quote */ }
    }

    fetchQuote()
    pollRef.current = setInterval(fetchQuote, 30000)
    return () => clearInterval(pollRef.current)
  }, [symbol])

  return { candles, quote, loading, error }
}
