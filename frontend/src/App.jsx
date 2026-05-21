import { useState, useCallback, useRef, useEffect } from 'react'
import TopBar           from './components/TopBar'
import Chart            from './components/Chart'
import DrawingToolbar   from './components/DrawingToolbar'
import IndicatorBar     from './components/IndicatorBar'
import WatchlistSidebar from './components/WatchlistSidebar'
import AuthModal        from './components/AuthModal'
import AlertsModal      from './components/AlertsModal'
import Institutional    from './components/Institutional'
import Screener         from './pages/Screener'
import Calculator       from './pages/Calculator'
import Journal          from './pages/Journal'
import Backtest         from './pages/Backtest'
import Holdings         from './pages/Holdings'
import MarketIntel      from './pages/MarketIntel'
import RSRanking        from './pages/RSRanking'
import StockAnalysis    from './pages/StockAnalysis'
import useStockData     from './hooks/useStockData'
import { supabase }     from './lib/supabase'
import { API_BASE, APP_VERSION } from './config'

const TABS = [
  { id: 'chart',      label: 'K線分析' },
  { id: 'screener',   label: '選股 (Minervini)' },
  { id: 'intel',      label: '📡 市場情報' },
  { id: 'backtest',   label: '回測' },
  { id: 'calculator', label: '部位計算機' },
  { id: 'holdings',   label: '📊 持倉' },
  { id: 'journal',    label: '交易日誌' },
  { id: 'rs',         label: '💪 RS排行' },
  { id: 'analysis',   label: '🔍 個股分析' },
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
  const [btMarkers,  setBtMarkers]  = useState(null)  // 回測交易標記
  const [activeTool, setActiveTool] = useState('cursor')
  const [drawColor,  setDrawColor]  = useState('#b86e2a')
  const [indicators, setIndicators] = useState({
    ma5: true, ma10: true, ma20: true, ma60: true, ma120: false, ma240: false,
  })

  /* ── data state（先從 localStorage 讀，登入後從雲端覆蓋）── */
  const [watchlist, setWatchlist] = useState(() => ls('tw_watchlist', DEFAULT_WATCHLIST))
  const [holdings,  setHoldings]  = useState(() => ls('tw_holdings',  []))
  const [journal,   setJournal]   = useState(() => ls('tw_journal',   []))
  const [drawings,  setDrawings]  = useState(() => ls('tw_drawings',  {}))
  const [alerts,    setAlerts]    = useState(() => ls('tw_alerts',    []))
  const [showAlerts, setShowAlerts] = useState(false)

  const chartClearRef = useRef(null)

  // 用 ref 讓 scheduleSync 永遠拿到最新值
  const watchlistRef = useRef(watchlist)
  const holdingsRef  = useRef(holdings)
  const journalRef   = useRef(journal)
  const drawingsRef  = useRef(drawings)
  const alertsRef    = useRef(alerts)
  watchlistRef.current = watchlist
  holdingsRef.current  = holdings
  journalRef.current   = journal
  drawingsRef.current  = drawings
  alertsRef.current    = alerts

  /* ══════════════════════════════════════════════════
     雲端同步工具函式
  ══════════════════════════════════════════════════ */
  async function loadFromCloud(uid) {
    const { data, error } = await supabase
      .from('user_data')
      .select('watchlist, holdings, journal, drawings, alerts')
      .eq('id', uid)
      .single()
    if (error) {
      // PGRST116 = 找不到資料列（新用戶，正常）；其他才是真正錯誤
      if (error.code !== 'PGRST116') {
        console.error('[Supabase loadFromCloud error]', error.code, error.message, error.details)
        setSyncing('error')
      }
      return
    }
    if (!data) return
    if (data.watchlist) { setWatchlist(data.watchlist); localStorage.setItem('tw_watchlist', JSON.stringify(data.watchlist)) }
    if (data.holdings)  { setHoldings(data.holdings);   localStorage.setItem('tw_holdings',  JSON.stringify(data.holdings)) }
    if (data.journal)   { setJournal(data.journal);     localStorage.setItem('tw_journal',   JSON.stringify(data.journal)) }
    if (data.drawings)  { setDrawings(data.drawings);   localStorage.setItem('tw_drawings',  JSON.stringify(data.drawings)) }
    if (data.alerts)    { setAlerts(data.alerts);        localStorage.setItem('tw_alerts',    JSON.stringify(data.alerts)) }
    setSyncing(false)
  }

  function scheduleSync() {
    clearTimeout(syncTimer.current)
    syncTimer.current = setTimeout(async () => {
      if (!user) return
      setSyncing(true)
      const { error } = await supabase.from('user_data').upsert({
        id: user.id,
        watchlist: watchlistRef.current,
        holdings:  holdingsRef.current,
        journal:   journalRef.current,
        drawings:  drawingsRef.current,
        alerts:    alertsRef.current,
        updated_at: new Date().toISOString(),
      })
      if (error) {
        console.error('[Supabase scheduleSync error]', error.code, error.message, error.details)
        setSyncing('error')
      } else {
        setSyncing(false)
      }
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
  useEffect(() => { localStorage.setItem('tw_watchlist', JSON.stringify(watchlist)); if (user) scheduleSync() }, [watchlist])
  useEffect(() => { localStorage.setItem('tw_holdings',  JSON.stringify(holdings));  if (user) scheduleSync() }, [holdings])
  useEffect(() => { localStorage.setItem('tw_journal',   JSON.stringify(journal));   if (user) scheduleSync() }, [journal])
  useEffect(() => { localStorage.setItem('tw_drawings',  JSON.stringify(drawings));  if (user) scheduleSync() }, [drawings])
  useEffect(() => { localStorage.setItem('tw_alerts',    JSON.stringify(alerts));    if (user) scheduleSync() }, [alerts])

  /* ── 警示輪詢（每 60 秒）── */
  useEffect(() => {
    const tick = async () => {
      const current = alertsRef.current
      const active = current.filter(a => !a.triggered)
      if (active.length === 0) return

      // Request notification permission once
      if (Notification.permission === 'default') {
        Notification.requestPermission().catch(() => {})
      }

      const updated = [...current]
      let changed = false

      for (const alert of active) {
        try {
          const res = await fetch(`${API_BASE}/api/stocks/${alert.symbol}/quote`)
          const q = await res.json()
          const price = q.price ?? q.close ?? null
          if (price === null) continue

          const hit =
            (alert.type === 'above' && price >= alert.price) ||
            (alert.type === 'below' && price <= alert.price)

          if (hit) {
            const idx = updated.findIndex(a => a.id === alert.id)
            if (idx !== -1) {
              updated[idx] = { ...updated[idx], triggered: true, triggeredAt: new Date().toLocaleString() }
              changed = true
              if (Notification.permission === 'granted') {
                new Notification(`🔔 ${alert.symbol} 警示觸發`, {
                  body: `${alert.symbol} 現價 ${price}，已${alert.type === 'above' ? '突破' : '跌破'} ${alert.price}`,
                })
              }
            }
          }
        } catch (_) {}
      }

      if (changed) setAlerts(updated)
    }

    tick()
    const id = setInterval(tick, 60000)
    return () => clearInterval(id)
  }, [])

  /* ── alerts 操作 ── */
  const addAlert    = useCallback((a) => setAlerts(prev => [...prev, a]), [])
  const removeAlert = useCallback((id) => setAlerts(prev => prev.filter(a => a.id !== id)), [])

  /* ── 登出 ── */
  async function handleLogout() {
    await supabase.auth.signOut()
    setUser(null)
  }

  /* ── K線資料 ── */
  const { candles, quote, loading, error } = useStockData(symbol, interval, period)

  const handleIntervalChange = useCallback((iv, p) => {
    setInterval(iv); setPeriod(p)
    setBtMarkers(null)   // 切換週期時清除回測標記
  }, [])

  // 從回測交易紀錄跳到 K 線圖並標記買賣點
  const handleViewTrade = useCallback((sym, trade) => {
    // 計算需要多長的 period 才能包含買入日
    const monthsAgo = (Date.now() - new Date(trade.entry_date + 'T00:00:00Z')) / (1000 * 60 * 60 * 24 * 30)
    const p = monthsAgo <= 13 ? '1y' : monthsAgo <= 25 ? '2y' : monthsAgo <= 37 ? '3y' : '5y'

    setSymbol(sym)
    setInterval('1d')
    setPeriod(p)
    setBtMarkers([
      {
        time:     trade.entry_date,
        position: 'belowBar',
        color:    '#4caf93',
        shape:    'arrowUp',
        text:     `買入 ${trade.entry_price}`,
      },
      {
        time:     trade.exit_date,
        position: 'aboveBar',
        color:    trade.pnl_pct > 0 ? '#4caf93' : '#c85a50',
        shape:    'arrowDown',
        text:     `${trade.exit_reason} ${trade.pnl_pct > 0 ? '+' : ''}${trade.pnl_pct}%`,
      },
    ])
    setTab('chart')
  }, [])
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

  const updateHolding = useCallback((id, patch) => {
    setHoldings(prev => prev.map(h => h.id === id ? { ...h, ...patch } : h))
  }, [])

  /* ── journal 操作 ── */
  const addTrade    = useCallback((t) => setJournal(prev => [t, ...prev]), [])
  const updateTrade = useCallback((id, patch) => setJournal(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t)), [])
  const deleteTrade = useCallback((id) => setJournal(prev => prev.filter(t => t.id !== id)), [])

  /* ── drawings 操作 ── */
  const drawingsKey = `${symbol}_${interval}`
  const handleDrawingsChange = useCallback((arr) => {
    setDrawings(prev => ({ ...prev, [drawingsKey]: arr }))
  }, [drawingsKey])

  /* ════════════════════════════════════════════════ */
  return (
    <div className="app">

      {/* ── 頂部 ── */}
      {tab === 'chart' ? (
        <TopBar
          symbol={symbol} quote={quote} interval={interval}
          onSymbolChange={(s) => { setSymbol(s); setBtMarkers(null) }} onIntervalChange={handleIntervalChange}
          watchlist={watchlist} onToggleInGroup={toggleInGroup} onAddGroup={addGroup}
        />
      ) : (
        <div className="topbar">
          <div className="logo">
            台股分析
            <span style={{ fontSize: 11, fontWeight: 400, color: 'var(--text-3)', marginLeft: 6, letterSpacing: 0 }}>
              {APP_VERSION}
            </span>
          </div>
        </div>
      )}

      {/* ── 雲端同步狀態列 ── */}
      <div className="sync-bar">
        {/* 🔔 警示鈴 */}
        <button className="bell-btn" onClick={() => setShowAlerts(true)}>
          🔔
          {alerts.filter(a => !a.triggered).length > 0 && (
            <span className="bell-badge">{alerts.filter(a => !a.triggered).length}</span>
          )}
        </button>

        {user ? (
          <>
            <span className="sync-user">☁ {user.email}</span>
            {syncing === true    && <span className="sync-dot">同步中…</span>}
            {syncing === 'error' && <span className="sync-dot" style={{color:'#c85a50'}} title="請開啟 F12 Console 查看詳細錯誤">⚠️ 同步失敗</span>}
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
              {btMarkers?.length > 0 && (
                <div style={{
                  position:'absolute', top:6, left:'50%', transform:'translateX(-50%)',
                  zIndex:10, background:'var(--surface)', border:'1px solid var(--border)',
                  borderRadius:20, padding:'4px 14px', fontSize:11, color:'var(--text-2)',
                  display:'flex', alignItems:'center', gap:10, pointerEvents:'none',
                  boxShadow:'0 2px 8px rgba(0,0,0,0.25)',
                }}>
                  <span>📌 回測標記：
                    <span style={{color:'#4caf93', marginLeft:4}}>▲ {btMarkers[0]?.text}</span>
                    <span style={{color: btMarkers[1]?.color ?? '#aaa', marginLeft:8}}>▼ {btMarkers[1]?.text}</span>
                  </span>
                </div>
              )}
              {loading && <div className="loading-overlay">載入中…</div>}
              {error && !loading && (
                <div className="loading-overlay" style={{ color:'#c85a50', fontSize:13, flexDirection:'column', gap:10 }}>
                  <div style={{ fontSize:15, fontWeight:600 }}>⚠️ 無法載入 K 線資料</div>
                  <div style={{ fontSize:12, opacity:0.9, background:'#c85a5022', border:'1px solid #c85a5055', borderRadius:6, padding:'6px 12px', maxWidth:400, wordBreak:'break-all' }}>{error}</div>
                </div>
              )}
              <Chart
                candles={candles} indicators={indicators}
                activeTool={activeTool} drawColor={drawColor} clearRef={chartClearRef}
                drawingsKey={drawingsKey}
                savedDrawings={drawings[drawingsKey]}
                onDrawingsChange={handleDrawingsChange}
                tradeMarkers={btMarkers}
              />
            </div>
            <Institutional symbol={symbol} />
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
      {tab === 'intel'      && (
        <MarketIntel onSelectStock={(s) => { setSymbol(s); setTab('chart') }} />
      )}
      {tab === 'backtest'   && <Backtest symbol={symbol} onViewTrade={handleViewTrade} />}
      {tab === 'calculator' && (
        <Calculator onAddHolding={addHolding} onSwitchToHoldings={() => setTab('holdings')} />
      )}
      {tab === 'holdings' && (
        <Holdings holdings={holdings} onRemove={removeHolding} onUpdate={updateHolding}
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

      {tab === 'rs' && (
        <RSRanking
          watchlist={watchlist}
          onSelectStock={(s) => { setSymbol(s); setTab('chart') }}
        />
      )}

      {tab === 'analysis' && (
        <StockAnalysis
          currentSymbol={symbol}
          onSelectStock={(s) => { setSymbol(s); setTab('chart') }}
        />
      )}

      {/* ── 登入 Modal ── */}
      {showAuth && <AuthModal onClose={() => setShowAuth(false)} />}

      {/* ── 警示 Modal ── */}
      {showAlerts && (
        <AlertsModal
          alerts={alerts}
          onAdd={addAlert}
          onRemove={removeAlert}
          onClose={() => setShowAlerts(false)}
        />
      )}
    </div>
  )
}
