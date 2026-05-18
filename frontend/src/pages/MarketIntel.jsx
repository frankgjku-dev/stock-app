import { useState, useEffect, useRef } from 'react'
import { API_BASE } from '../config'

const THEME_COLORS = [
  '#b86e2a', '#4a7a8a', '#5a8058', '#8a5a8a',
  '#c85a50', '#5a6a8a', '#8a7a50', '#4a8a6a',
  '#7a5a4a', '#6a8a5a', '#8a6a4a', '#5a4a8a',
]

export default function MarketIntel({ onSelectStock }) {
  const [data,    setData]    = useState(null)
  const [status,  setStatus]  = useState('idle')
  const [tab,     setTab]     = useState('themes')   // themes | mentions | movers | news
  const pollRef = useRef(null)

  // 載入現有快取
  useEffect(() => {
    fetch(`${API_BASE}/api/market-intel/status`)
      .then(r => r.json())
      .then(d => { setStatus(d.status); if (d.status === 'done') setData(d) })
      .catch(() => {})
  }, [])

  function startScan() {
    setStatus('running')
    fetch(`${API_BASE}/api/market-intel/scan`, { method: 'POST' }).catch(() => {})
    clearInterval(pollRef.current)
    pollRef.current = setInterval(async () => {
      try {
        const d = await fetch(`${API_BASE}/api/market-intel/status`).then(r => r.json())
        setStatus(d.status)
        if (d.status === 'done' || d.status === 'error') {
          clearInterval(pollRef.current)
          if (d.status === 'done') setData(d)
        }
      } catch {}
    }, 2000)
  }
  useEffect(() => () => clearInterval(pollRef.current), [])

  const running = status === 'running'

  return (
    <div className="intel-page">

      {/* ── 頂部控制 ── */}
      <div className="intel-header">
        <div>
          <div className="intel-title">📡 市場情報雷達</div>
          <div className="intel-sub">
            自動掃描財經新聞，偵測熱門題材與異動股票
            {data?.last_updated && (
              <span style={{ marginLeft: 10, color: 'var(--text-3)' }}>
                上次更新：{data.last_updated}　共 {data.article_count} 篇新聞
              </span>
            )}
          </div>
        </div>
        <button
          className={`scan-btn ${running ? 'scanning' : ''}`}
          onClick={startScan}
          disabled={running}
        >
          {running ? '🔍 掃描中…' : data ? '🔄 重新掃描' : '🔍 開始掃描'}
        </button>
      </div>

      {/* ── 空白提示 ── */}
      {!data && !running && (
        <div className="screener-hint">
          點擊「開始掃描」，系統將爬取多個財經新聞來源，
          自動偵測熱門題材、最常被提及的股票，以及今日漲跌異動（約需 20–40 秒）。
        </div>
      )}
      {running && (
        <div className="screener-hint" style={{ color: 'var(--accent)' }}>
          正在抓取新聞並分析中，請稍候…
          <span style={{ marginLeft: 8, animation: 'spin 1s linear infinite', display: 'inline-block' }}>⏳</span>
        </div>
      )}

      {/* ── 主內容 ── */}
      {data && (
        <>
          {/* Tab 切換 */}
          <div className="intel-tabs">
            {[
              { k: 'themes',   l: '🔥 熱門題材',    n: data.themes?.length },
              { k: 'mentions', l: '📌 新聞提及股票', n: data.stock_mentions?.length },
              { k: 'movers',   l: '📈 今日異動',     n: data.movers?.length },
              { k: 'news',     l: '📰 新聞列表',     n: data.articles?.length },
            ].map(({ k, l, n }) => (
              <button
                key={k}
                className={`intel-tab ${tab === k ? 'active' : ''}`}
                onClick={() => setTab(k)}
              >
                {l}
                {n > 0 && <span className="intel-tab-n">{n}</span>}
              </button>
            ))}
          </div>

          {/* ── 熱門題材 ── */}
          {tab === 'themes' && (
            <div className="intel-section">
              <div className="intel-section-title">本次掃描最熱門題材</div>
              {data.themes?.length === 0 && (
                <div style={{ color: 'var(--text-3)', padding: 20 }}>未偵測到明顯題材，試著重新掃描</div>
              )}
              <div className="intel-themes-grid">
                {data.themes?.map((t, i) => (
                  <div key={t.theme} className="intel-theme-card">
                    <div className="itc-header">
                      <span className="itc-badge" style={{ background: THEME_COLORS[i % THEME_COLORS.length] + '22',
                        color: THEME_COLORS[i % THEME_COLORS.length],
                        borderColor: THEME_COLORS[i % THEME_COLORS.length] + '55' }}>
                        #{i + 1}
                      </span>
                      <span className="itc-name">{t.theme}</span>
                      <span className="itc-count">{t.count} 篇</span>
                    </div>
                    <div className="itc-articles">
                      {t.articles?.slice(0, 3).map((a, j) => (
                        <a key={j} href={a.link} target="_blank" rel="noreferrer"
                          className="itc-article-link">
                          {a.title}
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 新聞提及股票 ── */}
          {tab === 'mentions' && (
            <div className="intel-section">
              <div className="intel-section-title">新聞最常提及的股票（可能與題材相關）</div>
              <div className="intel-mentions-grid">
                {data.stock_mentions?.map((s, i) => (
                  <div key={s.symbol} className="intel-mention-card">
                    <div className="imc-header">
                      <span className="imc-rank">#{i + 1}</span>
                      <span
                        className="imc-sym"
                        onClick={() => onSelectStock(s.symbol)}
                        title="點擊看K線"
                      >{s.symbol}</span>
                      <span className="imc-name">{s.name}</span>
                      <span className="imc-count">{s.count} 次</span>
                    </div>
                    <div className="imc-headlines">
                      {s.headlines?.map((h, j) => (
                        <div key={j} className="imc-headline">▸ {h}</div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── 今日異動 ── */}
          {tab === 'movers' && (
            <div className="intel-section">
              <div className="intel-section-title">
                今日漲跌最大（對比昨收）
                <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 8 }}>
                  資料來源：yfinance，盤中可能有延遲
                </span>
              </div>
              <div className="intel-movers-grid">
                {data.movers?.map(m => {
                  const up = m.change_pct >= 0
                  // 看這支股票有沒有在新聞提及列表中
                  const mentionCount = data.stock_mentions?.find(s => s.symbol === m.symbol)?.count || 0
                  return (
                    <div
                      key={m.symbol}
                      className={`intel-mover-card ${up ? 'mover-up' : 'mover-down'}`}
                      onClick={() => onSelectStock(m.symbol)}
                      title="點擊看K線"
                    >
                      <div className="imv-sym">{m.symbol}</div>
                      <div className="imv-name">{m.name}</div>
                      <div className="imv-price">${m.price}</div>
                      <div className={`imv-chg ${up ? 'up' : 'down'}`}>
                        {up ? '+' : ''}{m.change_pct}%
                      </div>
                      {mentionCount > 0 && (
                        <div className="imv-news-tag">
                          📰 新聞 {mentionCount} 篇
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* ── 新聞列表 ── */}
          {tab === 'news' && (
            <div className="intel-section">
              <div className="intel-section-title">全部新聞（{data.articles?.length} 篇）</div>
              <div className="intel-news-list">
                {data.articles?.map((a, i) => (
                  <a key={i} href={a.link} target="_blank" rel="noreferrer"
                    className="intel-news-item">
                    <span className="ini-title">{a.title}</span>
                    {a.source && <span className="ini-source">{a.source}</span>}
                  </a>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
