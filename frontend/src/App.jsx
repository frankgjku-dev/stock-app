import { useState, useCallback } from 'react'
import TopBar from './components/TopBar'
import Chart from './components/Chart'
import DrawingToolbar from './components/DrawingToolbar'
import IndicatorBar from './components/IndicatorBar'
import useStockData from './hooks/useStockData'

export default function App() {
  const [symbol, setSymbol] = useState('2330')
  const [interval, setInterval] = useState('1d')
  const [period, setPeriod] = useState('1y')
  const [activeTool, setActiveTool] = useState('cursor')
  const [indicators, setIndicators] = useState({
    ma5: true,
    ma10: true,
    ma20: true,
    ma60: true,
    ma120: false,
    ma240: false,
  })

  const { candles, quote, loading } = useStockData(symbol, interval, period)

  const handleIntervalChange = useCallback((iv, p) => {
    setInterval(iv)
    setPeriod(p)
  }, [])

  const toggleIndicator = useCallback((key) => {
    setIndicators(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  return (
    <div className="app">
      <TopBar
        symbol={symbol}
        quote={quote}
        interval={interval}
        onSymbolChange={setSymbol}
        onIntervalChange={handleIntervalChange}
      />
      <div className="main">
        <DrawingToolbar activeTool={activeTool} onToolChange={setActiveTool} />
        <div className="chart-area">
          <IndicatorBar indicators={indicators} onToggle={toggleIndicator} />
          <div className="chart-wrapper">
            {loading && <div className="loading-overlay">載入中...</div>}
            <Chart
              candles={candles}
              indicators={indicators}
              activeTool={activeTool}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
