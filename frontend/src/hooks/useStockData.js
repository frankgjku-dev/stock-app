import { useState, useEffect, useRef } from 'react'
import { API_BASE } from '../config'

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

    const url = `${API_BASE}/api/stocks/${symbol}/candles?interval=${interval}&period=${period}`;

    (async () => {
      let lastErr = ''
      for (let i = 0; i < 3; i++) {
        try {
          if (i > 0) await new Promise(r => setTimeout(r, 2000))
          const res  = await fetch(url)
          const data = await res.json()
          if (data.candles?.length) {
            setCandles(data.candles)
            setError(null)
            setLoading(false)
            return
          }
          lastErr = data.error || 'No data'
        } catch (e) {
          lastErr = e.message
        }
      }
      setError(lastErr)
      setLoading(false)
    })()
  }, [symbol, interval, period])

  // Real-time quote polling (every 5 s)
  useEffect(() => {
    if (!symbol) return

    async function fetchQuote() {
      try {
        const r = await fetch(`${API_BASE}/api/stocks/${symbol}/quote`)
        const data = await r.json()
        if (!data.error) setQuote(data)
      } catch { /* network error — keep last quote */ }
    }

    fetchQuote()
    pollRef.current = setInterval(fetchQuote, 30000)  // 30秒輪詢，避免打爆 API
    return () => clearInterval(pollRef.current)
  }, [symbol])

  return { candles, quote, loading, error }
}
