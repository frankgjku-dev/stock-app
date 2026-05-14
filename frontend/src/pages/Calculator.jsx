import { useState, useMemo } from 'react'

const METHOD_INFO = [
  { label: '單筆最大風險 1.25–2.5%', desc: '每筆交易虧損不超過帳戶的 2.5%' },
  { label: '停損上限 7–8%',           desc: '絕對紅線，觸及立刻出場不猶豫' },
  { label: '損益比 ≥ 2:1',            desc: '平均獲利必須大於平均虧損的 2 倍' },
  { label: '漸進式建倉',              desc: '第1筆獲利→才加第2筆→逐步放大' },
]

// ── Field 必須定義在元件外部，否則每次 render 都會重新建立函式
// → React 視為全新元件 → input 被卸載/重建 → 焦點丟失
function Field({ label, value, onChange, prefix='', suffix='', hint='' }) {
  return (
    <div className="calc-field">
      <label className="calc-label">{label}</label>
      {hint && <span className="calc-hint">{hint}</span>}
      <div className="calc-input-wrap">
        {prefix && <span className="calc-affix">{prefix}</span>}
        <input className="calc-input" type="number"
          value={value} onChange={e => onChange(e.target.value)} />
        {suffix && <span className="calc-affix">{suffix}</span>}
      </div>
    </div>
  )
}

export default function Calculator() {
  const [account,   setAccount]   = useState(500000)
  const [riskPct,   setRiskPct]   = useState(1.5)
  const [entry,     setEntry]     = useState('')
  const [stopPctIn, setStopPctIn] = useState('')   // 停損 % (e.g. 7 → 7%)
  const [targetR,   setTargetR]   = useState('')   // 目標 R 倍數 (e.g. 2 → 2R)
  const [showMethod, setShowMethod] = useState(true)

  const calc = useMemo(() => {
    const e   = parseFloat(entry)
    const sp  = parseFloat(stopPctIn)           // 停損 %
    const tr  = parseFloat(targetR) || null     // 目標 R 倍
    const acc = parseFloat(account)
    const rp  = parseFloat(riskPct) / 100
    if (!e || !sp || !acc || !rp || e <= 0 || sp <= 0 || sp >= 100) return null

    const stopPrice  = e * (1 - sp / 100)                     // 停損實際價格
    const targetPrice = tr && tr > 0 ? e + (e - stopPrice) * tr : null  // 目標實際價格

    const dollarRisk    = acc * rp
    const stopDist      = e - stopPrice
    const rawShares     = dollarRisk / stopDist
    const lots          = Math.floor(rawShares / 1000)
    const shares        = lots * 1000
    const sharesOdd     = Math.floor(rawShares)
    const positionVal   = shares * e
    const positionPct   = shares > 0 ? positionVal / acc * 100 : 0
    const actualRisk    = shares * stopDist
    const actualRiskPct = shares > 0 ? actualRisk / acc * 100 : 0
    const rr            = targetPrice ? tr : null
    const targetProfit  = rr != null ? shares * (targetPrice - e) : null
    return {
      shares, lots, sharesOdd,
      stopPrice, targetPrice,
      positionVal, positionPct,
      stopDist, stopPct: sp,
      actualRisk, actualRiskPct, rr, targetProfit,
    }
  }, [account, riskPct, entry, stopPctIn, targetR])

  // Progressive Exposure 漸進式建倉
  const progressive = useMemo(() => {
    if (!calc) return null
    const acc = parseFloat(account)
    const e   = parseFloat(entry)
    if (!acc || !e || e <= 0) return null
    // 以「張」為單位計算，避免小數乘法造成 0
    const totalLots = Math.floor(acc * 0.20 / e / 1000)
    if (totalLots === 0) return null   // 帳戶買不起 1 張，不顯示漸進表

    const labels     = ['初倉 25%', '加倉至 50%', '加倉至 75%', '滿倉 100%']
    const conditions = [
      '直接進場（Pivot 突破放量）',
      '第1筆浮盈 > 2%',
      '第2筆浮盈 > 2%',
      '趨勢強勁確認',
    ]
    return [0.25, 0.50, 0.75, 1.00].map((pct, i) => {
      const stageLots = Math.max(1, Math.round(totalLots * pct))
      return {
        stage:     i + 1,
        label:     labels[i],
        lots:      stageLots,
        shares:    stageLots * 1000,
        condition: conditions[i],
      }
    })
  }, [calc, account, entry])

  return (
    <div className="calc-page">

      {/* ── 方法說明 ── */}
      <div className="method-card" style={{ marginBottom: 20 }}>
        <div className="method-header" onClick={() => setShowMethod(p => !p)}>
          <span className="method-title">📋 計算方式說明</span>
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
              ℹ️ 應買股數 = （帳戶 × 風險%）÷（進場價 − 停損價），結果取整張（1000股為單位）。<br/>
              漸進式建倉：第一筆只用 25% 部位，確認盈利後再分批加碼到滿倉，
              不順的話損失有限，順的話才逐漸加碼。
            </div>
          </>
        )}
      </div>

      <h2 className="calc-title">部位計算機</h2>

      <div className="calc-layout">
        {/* 輸入 */}
        <div className="calc-inputs">
          <Field label="帳戶資金"             value={account}   onChange={setAccount}   prefix="NT$" />
          <Field label="單筆風險上限"          value={riskPct}   onChange={setRiskPct}   suffix="%" hint="建議 1.25%–2.5%" />
          <Field label="進場價（Pivot Point）" value={entry}     onChange={setEntry}     prefix="$" />

          {/* 停損：輸入 %，自動換算成價格 */}
          <div className="calc-field">
            <label className="calc-label">停損幅度</label>
            <span className="calc-hint">建議 5–8%</span>
            <div className="calc-input-wrap">
              <input className="calc-input" type="number"
                value={stopPctIn} onChange={e => setStopPctIn(e.target.value)}
                min={0.5} max={30} step={0.5} placeholder="例：7" />
              <span className="calc-affix">%</span>
            </div>
            {calc && <div className="calc-computed">→ 停損價 ${calc.stopPrice.toFixed(2)}</div>}
          </div>

          {/* 目標：輸入 R 倍數，自動換算成價格 */}
          <div className="calc-field">
            <label className="calc-label">目標損益比（選填）</label>
            <span className="calc-hint">建議 ≥ 2R</span>
            <div className="calc-input-wrap">
              <input className="calc-input" type="number"
                value={targetR} onChange={e => setTargetR(e.target.value)}
                min={0.5} max={20} step={0.5} placeholder="例：2" />
              <span className="calc-affix">R</span>
            </div>
            {calc && calc.targetPrice && <div className="calc-computed">→ 目標價 ${calc.targetPrice.toFixed(2)}</div>}
          </div>
        </div>

        {/* 結果 */}
        <div className="calc-results">
          {!calc && <div className="calc-empty">填寫左側數字後自動計算</div>}
          {calc && (
            <>
              <div className="result-card primary">
                <div className="result-label">應買張數</div>
                {calc.lots > 0 ? (
                  <>
                    <div className="result-val">{calc.lots} 張</div>
                    <div className="result-sub">{calc.shares.toLocaleString()} 股</div>
                  </>
                ) : (
                  <>
                    <div className="result-val" style={{ color: '#e0a800', fontSize: 18 }}>不足 1 張</div>
                    <div className="result-sub">零股可買 {calc.sharesOdd.toLocaleString()} 股</div>
                  </>
                )}
              </div>
              <div className="result-card">
                <div className="result-label">部位金額</div>
                <div className="result-val">
                  NT${calc.positionVal.toLocaleString(undefined,{maximumFractionDigits:0})}
                </div>
                <div className="result-sub">佔帳戶 {calc.positionPct.toFixed(1)}%</div>
              </div>
              <div className="result-card danger">
                <div className="result-label">實際風險金額</div>
                <div className="result-val">
                  NT${calc.actualRisk.toLocaleString(undefined,{maximumFractionDigits:0})}
                </div>
                <div className="result-sub">佔帳戶 {calc.actualRiskPct.toFixed(2)}%</div>
              </div>
              <div className="result-card">
                <div className="result-label">停損幅度</div>
                <div className="result-val">{calc.stopPct.toFixed(1)}%</div>
                <div className="result-sub">每股 ${calc.stopDist.toFixed(2)}　停損價 ${calc.stopPrice.toFixed(2)}</div>
              </div>
              {calc.rr != null && (
                <div className="result-card success">
                  <div className="result-label">目標獲利 / 損益比</div>
                  <div className="result-val">
                    NT${calc.targetProfit?.toLocaleString(undefined,{maximumFractionDigits:0})}
                  </div>
                  <div className="result-sub">
                    {calc.rr.toFixed(1)}R:1　目標價 ${calc.targetPrice?.toFixed(2)}
                    {calc.rr >= 3 ? '　✅ 理想（≥3R）'
                     : calc.rr >= 2 ? '　⚠️ 可接受（≥2R）'
                     : '　❌ 偏低（<2R）'}
                  </div>
                </div>
              )}

              {/* 紀律提醒 */}
              <div className="discipline-box">
                <div className="disc-title">紀律提醒</div>
                {calc.lots === 0 &&
                  <div className="disc-warn">⚠️ 風險計算所得股數不足 1 張，考慮以零股（{calc.sharesOdd} 股）操作或擴大資金</div>}
                {calc.stopPct > 8 &&
                  <div className="disc-warn">⚠️ 停損超過 8%，Minervini 建議最大 7–8%</div>}
                {calc.lots > 0 && calc.actualRiskPct > 2.5 &&
                  <div className="disc-warn">⚠️ 風險超過 2.5%，請縮小部位</div>}
                {calc.positionPct > 30 &&
                  <div className="disc-warn">⚠️ 單一持股超過 30%，留意集中風險</div>}
                {calc.lots > 0 && calc.stopPct <= 8 && calc.actualRiskPct <= 2.5 &&
                  <div className="disc-ok">✅ 風險控制在合理範圍</div>}
                {calc.rr != null && calc.rr < 2 &&
                  <div className="disc-warn">⚠️ 損益比低於 2:1，建議調整目標或進場點</div>}
              </div>
            </>
          )}
        </div>
      </div>

      {/* 漸進式建倉 */}
      {progressive && (
        <div className="progressive-section">
          <h3 className="prog-title">漸進式建倉計畫（Progressive Exposure）</h3>
          <p className="prog-sub">假設最大部位為帳戶的 20%，分 4 個階段建倉</p>
          <div className="prog-grid">
            {progressive.map(s => (
              <div key={s.stage} className="prog-card">
                <div className="prog-stage">第 {s.stage} 筆</div>
                <div className="prog-label">{s.label}</div>
                <div className="prog-shares">{s.lots} 張</div>
                <div className="prog-cond">條件：{s.condition}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
