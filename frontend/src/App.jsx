import { useState, useCallback, useRef, useEffect } from 'react'
import TopBar           from './components/TopBar'
import Chart            from './components/Chart'
import DrawingToolbar   from './components/DrawingToolbar'
import IndicatorBar     from './components/IndicatorBar'
import WatchlistSidebar from './components/WatchlistSidebar'
import AuthModal        from './components/AuthModal'
import Screener         from './pages/Screener'
import Calculator       from './pages/Calculator'
import Journal          from './pages/Journal'
import Backtest         from './pages/Backtest'
import Holdings         from './pages/Holdings'
import useStockData     from './hooks/useStockData'
import { supabase }     from './lib/supabase'

const TABS = [
  { id: 'chart',      label: 'K線分析' },
  { id: 'screener',   label: '選股 (Minervini)' },
  { id: 'backtest',   label: '回測' },
  { id: 'calculator', label: '部位計算機' },
  { id: 'holdings',   label: '📊 持倉' },
  { id: 'journal',    label: '交易日誌' },
]

const DEFAULT_WATCHLIST = { groups: [] }

function ls(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key) || 'null') ?? fallback }
  catch { return fallback }
}

export default function App() {
  /* ── auth ── */
  const [user,      setUser]      = useState(null)
  const [showAuth,  setShowAuth]  = useState(false)
  const [syncing,   setSyncing]   = useState(false)
  const syncTimer = useRef(null)

  /* ── UI state ── */
  const [tab,        setTab]        = useState('chart')
  const [symbol,     setSymbol]     = useState('2330')
  const [interval,   setInterval]   = useState('1d')
  const [period,     setPeriod]     = useState('1y')
  const [activeTool, setActiveTool] = useState('cursor')
  const [drawColor,  setDrawColor]  = useState('#b86e2a')
  const [indicators, setIndicators] = useState({
    ma5: true, ma10: true, ma20: true, ma60: true, ma120: false, ma240: false,
  })

  /* ── data state（先從 localStorage 讀，登入後從雲端覆蓋）── */
  const [watchlist, setWatchlist] = useState(() => ls('tw_watchlist', DEFAULT_WATCHLIST))
  const [holdings,  setHoldings]  = useState(() => ls('tw_holdings',  []))
  const [journal,   setJournal]   = useState(() => ls('tw_journal',   []))

  const chartClearRef = useRef(null)

  /* ══════════════════════════════════════════════════
     雲端同步工具函式
  ══════════════════════════════════════════════════ */
  async function loadFromCloud(uid) {
    const { data, error } = await supabase
      .from('user_data')
      .select('watchlist, holdings, journal')
      .eq('id', uid)
      .single()
    if (error || !data) return
    if (data.watchlist) { setWatchlist(data.watchlist); localStorage.setItem('tw_watchlist', JSON.stringify(data.watchlist)) }
    if (data.holdings)  { setHoldings(data.holdings);   localStorage.setItem('tw_holdings',  JSON.stringify(data.holdings)) }
    if (data.journal)   { setJournal(data.journal);     localStorage.setItem('tw_journal',   JSON.stringify(data.journal)) }
  }

  function scheduleSync(patch) {
    clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(async () => {
      if (!user) return
      setSyncing(true)
      await supabase.from('user_data').upsert({
        id: user.id,
        ...patch,
        updated_at: new Date().toISOString(),
      })
      setSyncing(false)
    }, 1500)
  }

  /* ── 監聽 Supabase 登入狀態 ── */
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) { setUser(session.user); loadFromCloud(session.user.id) }
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user ?? null
      setUser(u)
      if (u) loadFromCloud(u.id)
    })
    return () => subscription.unsubscribe()
  }, [])

  /* ── 自動同步到 localStorage + 雲端 ── */
  useEffect(() => {
    localStorage.setItem('tw_watchlist', JSON.stringify(watchlist))
    if (user) scheduleSync({ watchlist, holdings, journal })
  }, [watchlist])

  useEffect(() => {
    localStorage.setItem('tw_holdings', JSON.stringify(holdings))
    if (user) scheduleSync({ watchlist, holdings, journal })
  }, [holdings])

  useEffect(() => {
    localStorage.setItem('tw_journal', JSON.stringify(journal))
    if (user) scheduleSync({ watchlist, holdings, journal })
  }, [journal])

  /* ── 登出 ── */
  async function handleLogout() {
    await supabase.auth.signOut()
    setUser(null)
  }

  /* ── K線資料 ── */
  const { candles, quote, loading, error } = useStockData(symbol, interval, period)

  const handleIntervalChange = useCallback((iv, p) => { setInterval(iv); setPeriod(p) }, [])
  const toggleIndicator = useCallback((key) => {
    setIndicators(prev => ({ ...prev, [key]: !prev[key] }))
  }, [])

  /* ── watchlist 操作 ── */
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

  /* ── holdings 操作 ── */
  const addHolding = useCallback((h) => {
    setHoldings(prev => {
      const exists = prev.find(x => x.symbol === h.symbol && x.entryDate === h.entryDate && x.entryPrice === h.entryPrice)
      if (exists) return prev
      return [{ ...h, id: Date.now() }, ...prev]
    })
  }, [])

  const removeHolding = useCallback((id) => {
    setHoldings(prev => prev.filter(h => h.id !== id))
  }, [])

  /* ── journal 操作 ── */
  const addTrade    = useCallback((t) => setJournal(prev => [t, ...prev]), [])
  const updateTrade = useCallback((id, patch) => setJournal(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t)), [])
  const deleteTrade = useCallback((id) => setJournal(prev => prev.filter(t => t.id !== id)), [])

  /* ════════════════════════════════════════════════ */
  return (
    <div className="app">

      {/* ── 頂部 ── */}
      {tab === 'chart' ? (
        <TopBar
          symbol={symbol} quote={quote} interval={interval}
          onSymbolChange={setSymbol} onIntervalChange={handleIntervalChange}
          watchlist={watchlist} onToggleInGroup={toggleInGroup} onAddGroup={addGroup}
        />
      ) : (
        <div className="topbar"><div className="logo">台股分析</div></div>
      )}

      {/* ── 雲端同步狀態列 ── */}
      <div className="sync-bar">
        {user ? (
          <>
            <span className="sync-user">☁ {user.email}</span>
            {syncing && <span className="sync-dot">同步中…</span>}
            <button className="sync-logout" onClick={handleLogout}>登出</button>
          </>
        ) : (
          <button className="sync-login-btn" onClick={() => setShowAuth(true)}>
            ☁ 登入以同步雲端
          </button>
        )}
      </div>

      {/* ── Tab 列 ── */}
      <div className="tab-bar">
        {TABS.map(t => (
          <button
            key={t.id}
            className={`tab-btn ${tab === t.id ? 'active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'holdings' && holdings.length > 0 && (
              <span className="tab-badge">{holdings.length}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── 內容 ── */}
      {tab === 'chart' && (
        <div className="main">
          <DrawingToolbar
            activeTool={activeTool} onToolChange={setActiveTool}
            onClearAll={() => chartClearRef.current?.()}
            drawColor={drawColor} onColorChange={setDrawColor}
          />
          <div className="chart-area">
            <IndicatorBar indicators={indicators} onToggle={toggleIndicator} />
            <div className="chart-wrapper">
              {loading && <div className="loading-overlay">載入中…</div>}
              {error && !loading && (
                <div className="loading-overlay" style={{ color:'#c85a50', fontSize:13, flexDirection:'column', gap:8 }}>
                  <div>⚠️ 無法載入 K 線資料</div>
                  <div style={{ fontSize:11, opacity:0.7 }}>{error}</div>
                </div>
              )}
              <Chart
                candles={candles} indicators={indicators}
                activeTool={activeTool} drawColor={drawColor} clearRef={chartClearRef}
              />
            </div>
          </div>
          <WatchlistSidebar
            watchlist={watchlist} currentSymbol={symbol}
            onSelectSymbol={setSymbol} onToggleInGroup={toggleInGroup}
            onAddGroup={addGroup} onDeleteGroup={deleteGroup} onRenameGroup={renameGroup}
          />
        </div>
      )}

      {tab === 'screener' && (
        <Screener
          onSelectStock={(s) => { setSymbol(s); setTab('chart') }}
          watchlist={watchlist} onToggleInGroup={toggleInGroup}
        />
      )}
      {tab === 'backtest'   && <Backtest symbol={symbol} />}
      {tab === 'calculator' && (
        <Calculator onAddHolding={addHolding} onSwitchToHoldings={() => setTab('holdings')} />
      )}
      {tab === 'holdings' && (
        <Holdings holdings={holdings} onRemove={removeHolding}
          onSelectStock={(s) => { setSymbol(s); setTab('chart') }} />
      )}
      {tab === 'journal' && (
        <Journal
          trades={journal}
          onAdd={addTrade}
          onUpdate={updateTrade}
          onDelete={deleteTrade}
        />
      )}

      {/* ── 登入 Modal ── */}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}
    </div>
  )
}
