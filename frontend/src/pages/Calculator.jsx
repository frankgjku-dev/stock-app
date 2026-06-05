import { useState, useEffect, useMemo } from 'react'
import { API_BASE } from '../config'

const METHOD_INFO = [
  { label: '單筆最大風險 1.25–2.5%', desc: '每筆交易虧損不超過帳戶的 2.5%' },
  { label: '停損上限 7–8%',           desc: '絕對紅線，觸及立刻出場不猶豫' },
  { label: '損益比 ≥ 2:1',            desc: '平均獲利必須大於平均虧損的 2 倍' },
  { label: '漸進式建倉',              desc: '第1筆獲利→才加第2筆→逐步放大' },
]

function Field({ label, value, onChange, prefix='', suffix='', hint='', placeholder='', optional=false }) {
  return (
    <div className="calc-field">
      <label className="calc-label">
        {label}
        {optional && <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 6 }}>（選填）</span>}
      </label>
      {hint && <span className="calc-hint">{hint}</span>}
      <div className="calc-input-wrap">
        {prefix && <span className="calc-affix">{prefix}</span>}
        <input className="calc-input" type="number"
          value={value} onChange={e => onChange(e.target.value)}
          placeholder={placeholder} />
        {suffix && <span className="calc-affix">{suffix}</span>}
      </div>
    </div>
  )
}

export default function Calculator({ onAddHolding, onSwitchToHoldings }) {
  const [symbol,    setSymbol]    = useState('')
  const [name,      setName]      = useState('')
  const [account,   setAccount]   = useState('')       // 選填，預設空白
  const [riskPct,   setRiskPct]   = useState(1.5)
  const [entry,     setEntry]     = useState('')
  const [stopPctIn, setStopPctIn] = useState('')
  const [targetR,   setTargetR]   = useState('')
  const [manualLots, setManualLots] = useState('')     // 選填：手動指定張數
  const [showMethod, setShowMethod] = useState(false)
  const [added,     setAdded]     = useState(false)

  useEffect(() => {
    const sym = symbol.trim()
    if (sym.length < 4) { setName(''); return }
    fetch(`${API_BASE}/api/stocks/search?q=${sym}`)
      .then(r => r.json())
      .then(arr => {
        const found = arr.find(s => s.symbol === sym)
        if (found) setName(found.name)
      })
      .catch(() => {})
  }, [symbol])

  function handleAddHolding() {
    if (!calc || !symbol.trim()) return
    // 張數優先用：手動填的 > 公式算的 > 0
    const finalLots   = calc.manualResult?.lots ?? calc.lots ?? 0
    const finalShares = finalLots * 1000
    onAddHolding({
      symbol:     symbol.trim(),
      name:       name || symbol.trim(),
      entryDate:  new Date().toISOString().slice(0, 10),
      entryPrice: parseFloat(entry),
      stopPct:    parseFloat(stopPctIn),
      stopPrice:  calc.stopPrice,
      lots:       finalLots,
      shares:     finalShares,
      targetR:    parseFloat(targetR) || null,
      targetPrice: calc.targetPrice || null,
    })
    setAdded(true)
    setTimeout(() => setAdded(false), 2500)
  }

  const calc = useMemo(() => {
    const e   = parseFloat(entry)
    const sp  = parseFloat(stopPctIn)
    const tr  = parseFloat(targetR) || null
    const acc = parseFloat(account) || null    // 選填：空白 → null
    const rp  = parseFloat(riskPct) / 100
    const ml  = parseInt(manualLots) || null   // 選填：手動張數

    if (!e || !sp || e <= 0 || sp <= 0 || sp >= 100) return null

    const stopPrice   = e * (1 - sp / 100)
    const stopDist    = e - stopPrice
    const targetPrice = tr && tr > 0 ? e + stopDist * tr : null

    // ── 風險公式計算張數（需帳戶）──
    let lots = null, shares = null, sharesOdd = null
    let positionVal = null, positionPct = null
    let actualRisk = null, actualRiskPct = null
    let targetProfit = null

    if (acc && acc > 0 && rp > 0) {
      const rawShares = (acc * rp) / stopDist
      lots          = Math.floor(rawShares / 1000)
      shares        = lots * 1000
      sharesOdd     = Math.floor(rawShares)
      positionVal   = shares * e
      positionPct   = shares > 0 ? positionVal / acc * 100 : 0
      actualRisk    = shares * stopDist
      actualRiskPct = shares > 0 ? actualRisk / acc * 100 : 0
      targetProfit  = tr != null && targetPrice != null ? shares * (targetPrice - e) : null
    }

    // ── 手動張數反算（選填）──
    let manualResult = null
    if (ml && ml > 0) {
      const mShares    = ml * 1000
      const mPosiVal   = mShares * e
      const mRisk      = mShares * stopDist
      const mPosiPct   = acc ? mPosiVal / acc * 100 : null
      const mRiskPct   = acc ? mRisk / acc * 100 : null
      const mProfit    = targetPrice ? mShares * (targetPrice - e) : null
      manualResult = {
        lots: ml, shares: mShares,
        positionVal: mPosiVal, positionPct: mPosiPct,
        risk: mRisk, riskPct: mRiskPct,
        profit: mProfit,
        overRisk: mRiskPct != null && mRiskPct > 2.5,
        overConc: mPosiPct != null && mPosiPct > 30,
      }
    }

    return {
      hasAccount: acc != null && acc > 0,
      acc,
      shares, lots, sharesOdd,
      stopPrice, stopDist, stopPct: sp,
      targetPrice,
      positionVal, positionPct,
      actualRisk, actualRiskPct,
      rr: targetPrice ? tr : null, targetProfit,
      manualResult,
    }
  }, [account, riskPct, entry, stopPctIn, targetR, manualLots])

  // 漸進式建倉（需要帳戶資金）
  const progressive = useMemo(() => {
    if (!calc?.hasAccount) return null
    const e = parseFloat(entry)
    if (!e || e <= 0) return null
    const totalLots = Math.floor(calc.acc * 0.20 / e / 1000)
    if (totalLots === 0) return null
    const labels     = ['初倉 25%', '加倉至 50%', '加倉至 75%', '滿倉 100%']
    const conditions = [
      '直接進場（Pivot 突破放量）',
      '第1筆浮盈 > 2%',
      '第2筆浮盈 > 2%',
      '趨勢強勁確認',
    ]
    return [0.25, 0.50, 0.75, 1.00].map((pct, i) => {
      const stageLots = Math.max(1, Math.round(totalLots * pct))
      return { stage: i+1, label: labels[i], lots: stageLots, shares: stageLots*1000, condition: conditions[i] }
    })
  }, [calc, entry])

  return (
    <div className="calc-page">

      <h2 className="calc-title">部位計算機</h2>

      <div className="calc-layout">
        {/* 輸入 */}
        <div className="calc-inputs">
          <div className="calc-field">
            <label className="calc-label">股票代碼</label>
            <div className="calc-input-wrap">
              <input className="calc-input" type="text"
                value={symbol}
                onChange={e => setSymbol(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="例：2330" maxLength={6} />
            </div>
            {name && <div className="calc-computed">→ {name}</div>}
          </div>

          {/* 帳戶資金：選填 */}
          <Field
            label="帳戶資金" optional
            value={account} onChange={setAccount}
            prefix="NT$" placeholder="例：500000"
            hint="填入後可計算張數與風險金額"
          />

          {/* 單筆風險（無帳戶時灰色但仍可填）*/}
          <Field
            label="單筆風險上限"
            value={riskPct} onChange={setRiskPct}
            suffix="%" hint="建議 1.25%–2.5%"
          />

          <Field label="進場價（Pivot Point）" value={entry} onChange={setEntry} prefix="$" />

          {/* 停損 */}
          <div className="calc-field">
            <label className="calc-label">
              停損幅度
              {parseFloat(entry) > 0 && !parseFloat(stopPctIn) &&
                <span style={{ color: '#c85a50', marginLeft: 6, fontSize: 11 }}>← 請填此欄</span>
              }
            </label>
            <span className="calc-hint">建議 5–8%，輸入後自動換算停損價</span>
            <div className="calc-input-wrap">
              <input className="calc-input" type="number"
                value={stopPctIn} onChange={e => setStopPctIn(e.target.value)}
                min={0.5} max={30} step={0.5} placeholder="例：7"
                style={parseFloat(entry) > 0 && !parseFloat(stopPctIn)
                  ? { borderColor: '#c85a50', boxShadow: '0 0 0 2px rgba(200,90,80,0.2)' }
                  : {}} />
              <span className="calc-affix">%</span>
            </div>
            {calc && <div className="calc-computed">→ 停損價 ${calc.stopPrice.toFixed(2)}</div>}
          </div>

          {/* 購買張數（選填）*/}
          <div className="calc-field">
            <label className="calc-label">
              購買張數
              <span style={{ fontSize: 11, color: 'var(--text-3)', marginLeft: 6 }}>（選填）</span>
            </label>
            <span className="calc-hint">手動指定張數，反算部位金額與風險</span>
            <div className="calc-input-wrap">
              <input className="calc-input" type="number"
                value={manualLots} onChange={e => setManualLots(e.target.value.replace(/[^0-9]/g, ''))}
                min={1} step={1} placeholder="例：5" />
              <span className="calc-affix">張</span>
            </div>
            {calc?.manualResult && (
              <div className="calc-computed">→ {(calc.manualResult.shares).toLocaleString()} 股</div>
            )}
          </div>

          {/* 目標 */}
          <div className="calc-field">
            <label className="calc-label">目標損益比（選填）</label>
            <span className="calc-hint">建議 ≥ 2R</span>
            <div className="calc-input-wrap">
              <input className="calc-input" type="number"
                value={targetR} onChange={e => setTargetR(e.target.value)}
                min={0.5} max={20} step={0.5} placeholder="例：2" />
              <span className="calc-affix">R</span>
            </div>
            {calc?.targetPrice && <div className="calc-computed">→ 目標價 ${calc.targetPrice.toFixed(2)}</div>}
          </div>
        </div>

        {/* 結果 */}
        <div className="calc-results">
          {!calc && (
            <div className="calc-empty">
              {!parseFloat(entry)
                ? '① 請輸入進場價'
                : !parseFloat(stopPctIn)
                  ? '② 請輸入停損幅度（%）'
                  : '填寫完成後自動計算'}
            </div>
          )}
          {calc && (
            <>
              {/* 張數（需要帳戶）*/}
              {calc.hasAccount ? (
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
              ) : (
                <div className="result-card" style={{ opacity: 0.55 }}>
                  <div className="result-label">應買張數</div>
                  <div className="result-val" style={{ fontSize: 14, color: 'var(--text-3)' }}>填入帳戶資金後計算</div>
                </div>
              )}

              {/* 部位金額（需要帳戶）*/}
              {calc.hasAccount && (
                <div className="result-card">
                  <div className="result-label">部位金額</div>
                  <div className="result-val">
                    NT${calc.positionVal.toLocaleString(undefined,{maximumFractionDigits:0})}
                  </div>
                  <div className="result-sub">佔帳戶 {calc.positionPct.toFixed(1)}%</div>
                </div>
              )}

              {/* 停損距離（不需帳戶）*/}
              <div className="result-card danger">
                <div className="result-label">
                  {calc.hasAccount ? '實際風險金額' : '每股停損距離'}
                </div>
                <div className="result-val">
                  {calc.hasAccount
                    ? `NT$${calc.actualRisk.toLocaleString(undefined,{maximumFractionDigits:0})}`
                    : `$${calc.stopDist.toFixed(2)}`
                  }
                </div>
                <div className="result-sub">
                  {calc.hasAccount
                    ? `佔帳戶 ${calc.actualRiskPct.toFixed(2)}%`
                    : `停損 ${calc.stopPct.toFixed(1)}%`
                  }
                </div>
              </div>

              {/* 停損資訊（不需帳戶）*/}
              <div className="result-card">
                <div className="result-label">停損幅度</div>
                <div className="result-val">{calc.stopPct.toFixed(1)}%</div>
                <div className="result-sub">每股 ${calc.stopDist.toFixed(2)}　停損價 ${calc.stopPrice.toFixed(2)}</div>
              </div>

              {/* 目標（不需帳戶）*/}
              {calc.rr != null && (
                <div className="result-card success">
                  <div className="result-label">
                    {calc.hasAccount ? '目標獲利 / 損益比' : '目標損益比'}
                  </div>
                  <div className="result-val">
                    {calc.hasAccount && calc.targetProfit != null
                      ? `NT$${calc.targetProfit.toLocaleString(undefined,{maximumFractionDigits:0})}`
                      : `${calc.rr.toFixed(1)}R`
                    }
                  </div>
                  <div className="result-sub">
                    {calc.rr.toFixed(1)}R:1　目標價 ${calc.targetPrice?.toFixed(2)}
                    {calc.rr >= 3 ? '　✅ 理想（≥3R）'
                     : calc.rr >= 2 ? '　⚠️ 可接受（≥2R）'
                     : '　❌ 偏低（<2R）'}
                  </div>
                </div>
              )}

              {/* ── 手動張數反算結果 ── */}
              {calc.manualResult && (
                <div className="manual-lots-result">
                  <div className="manual-lots-title">📌 指定 {calc.manualResult.lots} 張 反算結果</div>
                  <div className="manual-lots-grid">
                    <div className="manual-lot-item">
                      <span className="mli-label">部位金額</span>
                      <span className="mli-val">NT${calc.manualResult.positionVal.toLocaleString(undefined,{maximumFractionDigits:0})}</span>
                      {calc.manualResult.positionPct != null &&
                        <span className="mli-sub">佔帳戶 {calc.manualResult.positionPct.toFixed(1)}%</span>}
                    </div>
                    <div className="manual-lot-item">
                      <span className="mli-label">風險金額</span>
                      <span className={`mli-val ${calc.manualResult.overRisk ? 'mli-danger' : ''}`}>
                        NT${calc.manualResult.risk.toLocaleString(undefined,{maximumFractionDigits:0})}
                      </span>
                      {calc.manualResult.riskPct != null &&
                        <span className={`mli-sub ${calc.manualResult.overRisk ? 'mli-danger' : ''}`}>
                          佔帳戶 {calc.manualResult.riskPct.toFixed(2)}%
                          {calc.manualResult.overRisk ? ' ⚠️超標' : ' ✅'}
                        </span>}
                    </div>
                    {calc.manualResult.profit != null && (
                      <div className="manual-lot-item">
                        <span className="mli-label">目標獲利</span>
                        <span className="mli-val mli-profit">
                          NT${calc.manualResult.profit.toLocaleString(undefined,{maximumFractionDigits:0})}
                        </span>
                        <span className="mli-sub">目標價 ${calc.targetPrice?.toFixed(2)}</span>
                      </div>
                    )}
                  </div>
                  {calc.manualResult.overRisk &&
                    <div className="manual-lots-warn">⚠️ 此張數風險超過 2.5%，建議縮減</div>}
                  {calc.manualResult.overConc &&
                    <div className="manual-lots-warn">⚠️ 部位超過帳戶 30%，留意集中風險</div>}
                </div>
              )}

              {/* 紀律提醒 */}
              <div className="discipline-box">
                <div className="disc-title">紀律提醒</div>
                {calc.hasAccount && calc.lots === 0 &&
                  <div className="disc-warn">⚠️ 風險計算所得股數不足 1 張，考慮以零股（{calc.sharesOdd} 股）操作或擴大資金</div>}
                {calc.stopPct > 8 &&
                  <div className="disc-warn">⚠️ 停損超過 8%，Minervini 建議最大 7–8%</div>}
                {calc.hasAccount && calc.lots > 0 && calc.actualRiskPct > 2.5 &&
                  <div className="disc-warn">⚠️ 風險超過 2.5%，請縮小部位</div>}
                {calc.hasAccount && calc.positionPct > 30 &&
                  <div className="disc-warn">⚠️ 單一持股超過 30%，留意集中風險</div>}
                {(!calc.hasAccount || (calc.lots > 0 && calc.stopPct <= 8 && calc.actualRiskPct <= 2.5)) &&
                  calc.stopPct <= 8 &&
                  <div className="disc-ok">✅ 停損在合理範圍</div>}
                {calc.rr != null && calc.rr < 2 &&
                  <div className="disc-warn">⚠️ 損益比低於 2:1，建議調整目標或進場點</div>}
              </div>

              {/* 加入持倉（只要有進場價 + 停損即可）*/}
              {symbol.trim() && calc && (
                <div style={{ marginTop: 8 }}>
                  {added ? (
                    <div className="hd-added-flash">✅ 已加入持倉！
                      <button className="hd-go-btn" onClick={onSwitchToHoldings}>查看持倉 →</button>
                    </div>
                  ) : (
                    <button className="hd-add-btn" onClick={handleAddHolding}>
                      📌 加入持倉
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 漸進式建倉（需帳戶）*/}
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

      {/* 方法說明 */}
      <div className="method-card">
        <div className="method-header" onClick={() => setShowMethod(p => !p)}>
          <span className="method-title">📋 計算方式說明</span>
          <span className="method-toggle">{showMethod ? '▲ 收起' : '▼ 展開'}</span>
        </div>
        {showMethod && (
          <>
            <div className="method-pills">
              {METHOD_INFO.map(p => (
                <div key={p.label} className="method-pill">
                  <span className="method-pill-label">{p.label}</span>
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

    </div>
  )
}
