import { useState, useCallback } from 'react'
import TopBar     from './components/TopBar'
import Chart      from './components/Chart'
import DrawingToolbar from './components/DrawingToolbar'
import IndicatorBar   from './components/IndicatorBar'
import Screener   from './pages/Screener'
import Calculator from './pages/Calculator'
import Journal    from './pages/Journal'
import useStockData from './hooks/useStockData'

const TABS = [
  { id: 'chart',      label: 'K線分析' },
  { id: 'screener',   label: '選股 (Minervini)' },
  { id: 'calculator', label: '部位計算機' },
  { id: 'journal',    label: '交易日誌' },
]

export default function App() {
  const [tab,      setTab]      = useState('chart')
  const [symbol,   setSymbol]   = useState('2330')
  const [interval, setInterval] = useState('1d')
  const [period,   setPeriod]   = useState('1y')
  const [activeTool, setActiveTool] = useState('cursor')
  const [indicators, setIndicators] = useState({
    ma5: true, ma10: true, ma20: true, ma60: true, ma120: false, ma240: false,
  })

  const { candles, quote, loading } = useStockData(symbol, interval, period)

  const handleIntervalChange = useCallback((iv, p) => {
    setInterval(iv); setPeriod(p)
  }, [])

  const toggleIndicator = useCallback((key) => {
    setIndicators(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  return (
    <div className="app">
      {/* ── 頂部 ── */}
      {tab === 'chart' ? (
        <TopBar
          symbol={symbol} quote={quote} interval={interval}
          onSymbolChange={setSymbol} onIntervalChange={handleIntervalChange}
        />
      ) : (
        <div className="topbar">
          <div className="logo">台股分析</div>
        </div>
      )}

      {/* ── Tab 列 ── */}
      <div className="tab-bar">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── 內容 ── */}
      {tab === 'chart' && (
        <div className="main">
          <DrawingToolbar activeTool={activeTool} onToolChange={setActiveTool} />
          <div className="chart-area">
            <IndicatorBar indicators={indicators} onToggle={toggleIndicator} />
            <div className="chart-wrapper">
              {loading && <div className="loading-overlay">載入中...</div>}
              <Chart candles={candles} indicators={indicators} activeTool={activeTool} />
            </div>
          </div>
        </div>
      )}

      {tab === 'screener'   && <Screener   onSelectStock={(s) => { setSymbol(s); setTab('chart') }} />}
      {tab === 'calculator' && <Calculator />}
      {tab === 'journal'    && <Journal />}
    </div>
  )
}
