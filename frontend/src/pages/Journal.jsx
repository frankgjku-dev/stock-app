import { useState, useMemo } from 'react'

const METHOD_INFO = [
  { label: '紀錄每筆進出場', desc: '進場價、停損價、出場價、理由' },
  { label: 'R 數統計',       desc: '計算每筆實際獲利/虧損的 R 倍數' },
  { label: '勝率 & 期望值',  desc: 'E = 勝率×平均R − 敗率×平均R' },
  { label: '紀律檢核',       desc: '是否遵守停損、是否攤平、是否依計畫操作' },
]

const EMPTY_FORM = {
  date: new Date().toISOString().slice(0,10),
  symbol: '', name: '', action: 'buy',
  entry: '', stop: '', exit: '', shares: '',
  reason: '', discipline: true, note: '', result: 'open',
}

// ── 必須定義在元件外部，否則每次 render 建立新函式 → input 失焦
function F({ label, name, type = 'text', options, form, setForm, ...rest }) {
  return (
    <div className="jf-field">
      <label className="jf-label">{label}</label>
      {options
        ? <select className="calc-input" value={form[name]}
            onChange={e => setForm(p => ({ ...p, [name]: e.target.value }))}>
            {options.map(o => <option key={o.v} value={o.v}>{o.l}</option>)}
          </select>
        : <input className="calc-input" type={type} value={form[name]}
            onChange={e => setForm(p => ({ ...p, [name]: e.target.value }))}
            {...rest} />}
    </div>
  )
}

export default function Journal({ trades, onAdd, onUpdate, onDelete }) {
  const [showForm, setShowForm] = useState(false)
  const [form,     setForm]     = useState(EMPTY_FORM)
  const [editId,   setEditId]   = useState(null)
  const [showMethod, setShowMethod] = useState(true)
  const skipSaveRef = useRef(false)

  // 連續虧損偵測
  const consecutiveLosses = useMemo(() => {
    let count = 0
    for (const t of trades) {
      if (t.result === 'loss') count++
      else if (t.result === 'win') break
    }
    return count
  }, [trades])

  // 統計
  const stats = useMemo(() => {
    const closed = trades.filter(t => t.result !== 'open' && t.r_multiple != null)
    if (!closed.length) return null
    const wins   = closed.filter(t => t.r_multiple > 0)
    const losses = closed.filter(t => t.r_multiple <= 0)
    const winRate = wins.length / closed.length
    const avgWin  = wins.length   ? wins.reduce((s, t)   => s + t.r_multiple, 0) / wins.length   : 0
    const avgLoss = losses.length ? losses.reduce((s, t) => s + Math.abs(t.r_multiple), 0) / losses.length : 0
    const expectancy = winRate * avgWin - (1 - winRate) * avgLoss
    return {
      total: closed.length, wins: wins.length,
      winRate: (winRate * 100).toFixed(1),
      avgWin: avgWin.toFixed(2), avgLoss: avgLoss.toFixed(2),
      expectancy: expectancy.toFixed(2),
      totalR: closed.reduce((s, t) => s + t.r_multiple, 0).toFixed(2),
    }
  }, [trades])

  function calcR(entry, stop, exit) {
    const e = parseFloat(entry), s = parseFloat(stop), x = parseFloat(exit)
    if (!e || !s || !x || e === s) return null
    return parseFloat(((x - e) / (e - s)).toFixed(2))
  }

  function handleSubmit(e) {
    e.preventDefault()
    const r = calcR(form.entry, form.stop, form.exit)
    const trade = {
      ...form,
      id: editId ?? Date.now(),
      r_multiple: r,
      result: r == null ? 'open' : r > 0 ? 'win' : 'loss',
    }
    if (editId) {
      onUpdate(editId, trade)
      setEditId(null)
    } else {
      onAdd(trade)
    }
    setForm(EMPTY_FORM); setShowForm(false)
  }

  function startEdit(t) {
    setForm({ ...t }); setEditId(t.id); setShowForm(true)
  }

  function deleteTrade(id) {
    if (confirm('確認刪除這筆交易？')) onDelete(id)
  }

  const resultColor = r => r === 'win' ? '#4caf50' : r === 'loss' ? '#ef5350' : '#787b86'

  return (
    <div className="journal-page">

      {/* ── 方法說明 ── */}
      <div className="method-card">
        <div className="method-header" onClick={() => setShowMethod(p => !p)}>
          <span className="method-title">📋 此功能說明</span>
          <span className="method-toggle">{showMethod ? '▲ 收起' : '▼ 展開'}</span>
        </div>
        {showMethod && (
          <>
            <div className="method-pills">
              {METHOD_INFO.map(p => (
                <div key={p.label} className="method-pill" style={{ borderColor: '#455a64' }}>
                  <span className="method-pill-label" style={{ color: '#90caf9' }}>{p.label}</span>
                  <span className="method-pill-desc">{p.desc}</span>
                </div>
              ))}
            </div>
            <div className="method-note">
              ℹ️ Minervini 強調：每筆交易都要紀錄，才能統計出自己的真實勝率與期望值。
              連續虧損 3–5 筆請縮小部位或暫停。<br />
              期望值公式：E = (勝率 × 平均賺) − (敗率 × 平均賠)，只要 E &gt; 0 長期就能獲利。
            </div>
          </>
        )}
      </div>

      {/* ── 連續虧損警示 ── */}
      {consecutiveLosses >= 3 && (
        <div className="consec-loss-warn">
          <span className="consec-icon">⚠️</span>
          <div>
            <strong>連續虧損 {consecutiveLosses} 筆！</strong>
            <span> Minervini 建議：立刻縮小部位至 50% 以下，暫停新進場，
            先找出虧損原因再恢復操作。</span>
          </div>
        </div>
      )}
      {consecutiveLosses >= 5 && (
        <div className="consec-loss-warn danger">
          <span className="consec-icon">🚨</span>
          <div>
            <strong>連續虧損 {consecutiveLosses} 筆，建議完全暫停！</strong>
            <span> 回到紙上交易練習，重新審視進場條件是否符合 SEPA 規則。</span>
          </div>
        </div>
      )}

      {/* ── 統計 ── */}
      {stats && (
        <div className="stats-row">
          {[
            { l: '交易筆數', v: stats.total },
            { l: '勝率',     v: `${stats.winRate}%`, c: parseFloat(stats.winRate) >= 50 ? '#4caf50' : '#ff9800' },
            { l: '平均獲利', v: `+${stats.avgWin}R`,  c: '#4caf50' },
            { l: '平均虧損', v: `-${stats.avgLoss}R`, c: '#ef5350' },
            { l: '期望值',   v: `${stats.expectancy}R`,
              c: parseFloat(stats.expectancy) > 0 ? '#4caf50' : '#ef5350' },
            { l: '累計 R',   v: `${parseFloat(stats.totalR) >= 0 ? '+' : ''}${stats.totalR}R`,
              c: parseFloat(stats.totalR) >= 0 ? '#4caf50' : '#ef5350' },
          ].map(s => (
            <div key={s.l} className="stat-card">
              <div className="stat-label">{s.l}</div>
              <div className="stat-val" style={{ color: s.c || '#e0e3eb' }}>{s.v}</div>
            </div>
          ))}
        </div>
      )}

      {/* ── 新增按鈕 ── */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <button className="scan-btn" onClick={() => { setShowForm(p => !p); setEditId(null); setForm(EMPTY_FORM) }}>
          {showForm ? '取消' : '+ 新增交易'}
        </button>
        {trades.length === 0 && !showForm && (
          <span style={{ color: '#5d6673', fontSize: 13 }}>尚無交易紀錄，點擊新增第一筆</span>
        )}
      </div>

      {/* ── 新增/編輯表單 ── */}
      {showForm && (
        <form className="journal-form" onSubmit={handleSubmit}>
          <div className="jf-row">
            <F label="日期"   name="date"   type="date"   form={form} setForm={setForm} />
            <F label="股票代碼" name="symbol" placeholder="2330" form={form} setForm={setForm} />
            <F label="名稱"   name="name"   placeholder="台積電" form={form} setForm={setForm} />
            <F label="方向"   name="action" options={[{v:'buy',l:'做多 Buy'},{v:'sell',l:'做空 Sell'}]} form={form} setForm={setForm} />
          </div>
          <div className="jf-row">
            <F label="進場價" name="entry"  type="number" step="0.01" placeholder="進場點位"  form={form} setForm={setForm} />
            <F label="停損價" name="stop"   type="number" step="0.01" placeholder="止損設定"  form={form} setForm={setForm} />
            <F label="出場價" name="exit"   type="number" step="0.01" placeholder="留空=未出場" form={form} setForm={setForm} />
            <F label="股數"   name="shares" type="number" placeholder="股數"                   form={form} setForm={setForm} />
          </div>
          <div className="jf-row">
            <div className="jf-field" style={{ flex: 2 }}>
              <label className="jf-label">進場理由</label>
              <input className="calc-input" value={form.reason}
                onChange={e => setForm(p => ({ ...p, reason: e.target.value }))}
                placeholder="例：VCP突破、RS>80、大盤多頭" />
            </div>
            <div className="jf-field" style={{ flex: 2 }}>
              <label className="jf-label">備註</label>
              <input className="calc-input" value={form.note}
                onChange={e => setForm(p => ({ ...p, note: e.target.value }))}
                placeholder="情緒、反省、其他" />
            </div>
            <div className="jf-field">
              <label className="jf-label">
                <input type="checkbox" checked={form.discipline}
                  onChange={e => setForm(p => ({ ...p, discipline: e.target.checked }))} />
                &nbsp;遵守紀律？
              </label>
            </div>
          </div>
          {form.entry && form.stop && form.exit && (
            <div className="r-preview">
              預估 R 數：
              <strong style={{
                color: calcR(form.entry, form.stop, form.exit) > 0 ? '#4caf50' : '#ef5350'
              }}>
                {calcR(form.entry, form.stop, form.exit)}R
              </strong>
            </div>
          )}
          <button type="submit" className="scan-btn" style={{ width: 'fit-content' }}>
            {editId ? '更新' : '儲存'}
          </button>
        </form>
      )}

      {/* ── 交易清單 ── */}
      {trades.length > 0 && (
        <div className="table-wrap">
          <table className="screener-table">
            <thead>
              <tr>
                <th>日期</th><th>代碼</th><th>名稱</th><th>方向</th>
                <th>進場</th><th>停損</th><th>出場</th><th>股數</th>
                <th>R數</th><th>結果</th><th>紀律</th><th>理由</th><th>操作</th>
              </tr>
            </thead>
            <tbody>
              {trades.map(t => (
                <tr key={t.id} className="data-row">
                  <td style={{ fontSize: 12 }}>{t.date}</td>
                  <td className="sym">{t.symbol}</td>
                  <td>{t.name}</td>
                  <td style={{ color: t.action === 'buy' ? '#ef5350' : '#26a69a' }}>
                    {t.action === 'buy' ? '多' : '空'}
                  </td>
                  <td>{t.entry}</td>
                  <td style={{ color: '#ef5350' }}>{t.stop}</td>
                  <td>{t.exit || '—'}</td>
                  <td>{t.shares ? (+t.shares / 1000).toFixed(1) + '張' : '—'}</td>
                  <td>
                    {t.r_multiple != null
                      ? <strong style={{ color: t.r_multiple > 0 ? '#4caf50' : '#ef5350' }}>
                          {t.r_multiple > 0 ? '+' : ''}{t.r_multiple}R
                        </strong>
                      : '—'}
                  </td>
                  <td>
                    <span style={{ color: resultColor(t.result), fontWeight: 600 }}>
                      {t.result === 'win' ? '✓ 獲利' : t.result === 'loss' ? '✗ 虧損' : '進行中'}
                    </span>
                  </td>
                  <td>{t.discipline ? '✓' : <span style={{ color: '#ef5350' }}>✗</span>}</td>
                  <td style={{ fontSize: 12, color: '#787b86', maxWidth: 120 }}>{t.reason}</td>
                  <td>
                    <button className="detail-btn" onClick={() => startEdit(t)}>編輯</button>
                    <button className="detail-btn" style={{ color: '#ef5350', marginLeft: 4 }}
                      onClick={() => deleteTrade(t.id)}>刪</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
