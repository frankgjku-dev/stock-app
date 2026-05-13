import { useState, useEffect, useRef } from 'react'
import { API_BASE } from '../config'

export default function useStockData(symbol, interval, period) {
  const [candles, setCandles] = useState([])
  const [quote,   setQuote]   = useState(null)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState(null)
  const pollRef = useRef(null)

  // Historical candles
  useEffect(() => {
    if (!symbol) return
    setLoading(true)
    setError(null)

    fetch(`${API_BASE}/api/stocks/${symbol}/candles?interval=${interval}&period=${period}`)
      .then(r => r.json())
      .then(data => {
        if (data.error && !data.candles?.length) throw new Error(data.error)
        setCandles(data.candles ?? [])
      })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
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
