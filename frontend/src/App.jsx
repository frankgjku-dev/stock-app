import { useState, useCallback, useRef, useEffect } from 'react'
import TopBar          from './components/TopBar'
import Chart           from './components/Chart'
import DrawingToolbar  from './components/DrawingToolbar'
import IndicatorBar    from './components/IndicatorBar'
import WatchlistSidebar from './components/WatchlistSidebar'
import Screener        from './pages/Screener'
import Calculator      from './pages/Calculator'
import Journal         from './pages/Journal'
import useStockData    from './hooks/useStockData'

const TABS = [
  { id: 'chart',      label: 'K線分析' },
  { id: 'screener',   label: '選股 (Minervini)' },
  { id: 'calculator', label: '部位計算機' },
  { id: 'journal',    label: '交易日誌' },
]

const DEFAULT_WATCHLIST = { groups: [] }

function loadWatchlist() {
  try { return JSON.parse(localStorage.getItem('tw_watchlist') || 'null') || DEFAULT_WATCHLIST }
  catch { return DEFAULT_WATCHLIST }
}

export default function App() {
  const [tab,        setTab]        = useState('chart')
  const [symbol,     setSymbol]     = useState('2330')
  const [interval,   setInterval]   = useState('1d')
  const [period,     setPeriod]     = useState('1y')
  const [activeTool, setActiveTool] = useState('cursor')
  const [indicators, setIndicators] = useState({
    ma5: true, ma10: true, ma20: true, ma60: true, ma120: false, ma240: false,
  })
  const [watchlist, setWatchlist] = useState(loadWatchlist)
  const chartClearRef = useRef(null)

  useEffect(() => {
    localStorage.setItem('tw_watchlist', JSON.stringify(watchlist))
  }, [watchlist])

  const { candles, quote, loading } = useStockData(symbol, interval, period)

  const handleIntervalChange = useCallback((iv, p) => {
    setInterval(iv); setPeriod(p)
  }, [])
  const toggleIndicator = useCallback((key) => {
    setIndicators(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  /* ── watchlist operations ── */
  const addGroup = useCallback((name) => {
    setWatchlist(prev => ({
      ...prev,
      groups: [...prev.groups, { id: `g_${Date.now()}`, name, stocks: [] }],
    }))
  }, [])

  const deleteGroup = useCallback((id) => {
    setWatchlist(prev => ({ ...prev, groups: prev.groups.filter(g => g.id !== id) }))
  }, [])

  const renameGroup = useCallback((id, name) => {
    setWatchlist(prev => ({
      ...prev,
      groups: prev.groups.map(g => g.id === id ? { ...g, name } : g),
    }))
  }, [])

  const toggleInGroup = useCallback((sym, groupId) => {
    setWatchlist(prev => ({
      ...prev,
      groups: prev.groups.map(g => {
        if (g.id !== groupId) return g
        const has = g.stocks.includes(sym)
        return { ...g, stocks: has ? g.stocks.filter(s => s !== sym) : [...g.stocks, sym] }
      }),
    }))
  }, [])

  return (
    <div className="app">
      {/* ── 頂部 ── */}
      {tab === 'chart' ? (
        <TopBar
          symbol={symbol} quote={quote} interval={interval}
          onSymbolChange={setSymbol} onIntervalChange={handleIntervalChange}
          watchlist={watchlist}
          onToggleInGroup={toggleInGroup}
          onAddGroup={addGroup}
        />
      ) : (
        <div className="topbar"><div className="logo">台股分析</div></div>
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
          <DrawingToolbar
            activeTool={activeTool}
            onToolChange={setActiveTool}
            onClearAll={() => chartClearRef.current?.()}
          />
          <div className="chart-area">
            <IndicatorBar indicators={indicators} onToggle={toggleIndicator} />
            <div className="chart-wrapper">
              {loading && <div className="loading-overlay">載入中…</div>}
              <Chart
                candles={candles}
                indicators={indicators}
                activeTool={activeTool}
                clearRef={chartClearRef}
              />
            </div>
          </div>
          <WatchlistSidebar
            watchlist={watchlist}
            currentSymbol={symbol}
            onSelectSymbol={(s) => setSymbol(s)}
            onToggleInGroup={toggleInGroup}
            onAddGroup={addGroup}
            onDeleteGroup={deleteGroup}
            onRenameGroup={renameGroup}
          />
        </div>
      )}

      {tab === 'screener' && (
        <Screener
          onSelectStock={(s) => { setSymbol(s); setTab('chart') }}
          watchlist={watchlist}
          onToggleInGroup={toggleInGroup}
        />
      )}
      {tab === 'calculator' && <Calculator />}
      {tab === 'journal'    && <Journal />}
    </div>
  )
}
