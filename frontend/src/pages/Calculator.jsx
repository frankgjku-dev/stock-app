import { useState, useMemo } from 'react'

export default function Calculator() {
  const [account,  setAccount]  = useState(500000)
  const [riskPct,  setRiskPct]  = useState(1.5)
  const [entry,    setEntry]    = useState('')
  const [stop,     setStop]     = useState('')
  const [target,   setTarget]   = useState('')

  const calc = useMemo(() => {
    const e = parseFloat(entry)
    const s = parseFloat(stop)
    const t = parseFloat(target) || null
    const acc = parseFloat(account)
    const rp  = parseFloat(riskPct) / 100

    if (!e || !s || e <= 0 || s <= 0 || e <= s) return null

    const dollarRisk   = acc * rp
    const stopDist     = e - s
    const stopPct      = stopDist / e * 100
    const shares       = Math.floor(dollarRisk / stopDist / 1000) * 1000  // 整張（1000股）
    const positionVal  = shares * e
    const positionPct  = positionVal / acc * 100
    const actualRisk   = shares * stopDist
    const actualRiskPct = actualRisk / acc * 100

    let targetProfit = null, rr = null
    if (t && t > e) {
      targetProfit = shares * (t - e)
      rr = (t - e) / stopDist
    }

    return {
      shares, positionVal, positionPct,
      stopDist, stopPct,
      actualRisk, actualRiskPct,
      targetProfit, rr,
    }
  }, [account, riskPct, entry, stop, target])

  function Field({ label, value, onChange, prefix = '', suffix = '', hint = '' }) {
    return (
      <div className="calc-field">
        <label className="calc-label">{label}</label>
        {hint && <span className="calc-hint">{hint}</span>}
        <div className="calc-input-wrap">
          {prefix && <span className="calc-affix">{prefix}</span>}
          <input
            className="calc-input"
            type="number"
            value={value}
            onChange={e => onChange(e.target.value)}
          />
          {suffix && <span className="calc-affix">{suffix}</span>}
        </div>
      </div>
    )
  }

  return (
    <div className="calc-page">
      <h2 className="calc-title">部位計算機</h2>
      <p className="calc-subtitle">
        依 Minervini 資金管理原則：每筆最大虧損不超過帳戶 1.25%–2.5%
      </p>

      <div className="calc-layout">
        {/* 輸入區 */}
        <div className="calc-inputs">
          <Field label="帳戶資金" value={account} onChange={setAccount} prefix="NT$" />
          <Field label="單筆風險上限" value={riskPct} onChange={setRiskPct} suffix="%"
                 hint="建議 1.25%–2.5%" />
          <Field label="進場價（Pivot Point）" value={entry} onChange={setEntry} prefix="$" />
          <Field label="停損價" value={stop} onChange={setStop} prefix="$"
                 hint="通常為 Pivot 下方 5–8%" />
          <Field label="目標價（選填）" value={target} onChange={setTarget} prefix="$" />
        </div>

        {/* 結果區 */}
        <div className="calc-results">
          {!calc && (
            <div className="calc-empty">填寫左側數字後自動計算</div>
          )}
          {calc && (
            <>
              <div className="result-card primary">
                <div className="result-label">應買張數</div>
                <div className="result-val">{(calc.shares / 1000).toFixed(0)} 張</div>
                <div className="result-sub">{calc.shares.toLocaleString()} 股</div>
              </div>

              <div className="result-card">
                <div className="result-label">部位金額</div>
                <div className="result-val">
                  NT${calc.positionVal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
                <div className="result-sub">佔帳戶 {calc.positionPct.toFixed(1)}%</div>
              </div>

              <div className="result-card danger">
                <div className="result-label">實際風險金額</div>
                <div className="result-val">
                  NT${calc.actualRisk.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </div>
                <div className="result-sub">佔帳戶 {calc.actualRiskPct.toFixed(2)}%</div>
              </div>

              <div className="result-card">
                <div className="result-label">停損幅度</div>
                <div className="result-val">{calc.stopPct.toFixed(2)}%</div>
                <div className="result-sub">每股虧損 ${calc.stopDist.toFixed(2)}</div>
              </div>

              {calc.rr !== null && (
                <>
                  <div className="result-card success">
                    <div className="result-label">目標獲利</div>
                    <div className="result-val">
                      NT${calc.targetProfit?.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                    </div>
                    <div className="result-sub">
                      損益比 R:R = 1:{calc.rr.toFixed(2)}
                      {calc.rr >= 3
                        ? ' ✅ 理想（≥3）'
                        : calc.rr >= 2
                        ? ' ⚠️ 可接受（≥2）'
                        : ' ❌ 偏低（<2）'}
                    </div>
                  </div>
                </>
              )}

              {/* Minervini 紀律提醒 */}
              <div className="discipline-box">
                <div className="disc-title">紀律提醒</div>
                {calc.stopPct > 8 && (
                  <div className="disc-warn">⚠️ 停損幅度超過 8%，Minervini 建議最大 7–8%</div>
                )}
                {calc.actualRiskPct > 2.5 && (
                  <div className="disc-warn">⚠️ 風險佔帳戶超過 2.5%，請縮小部位</div>
                )}
                {calc.positionPct > 30 && (
                  <div className="disc-warn">⚠️ 單一持股超過 30%，留意集中風險</div>
                )}
                {calc.stopPct <= 8 && calc.actualRiskPct <= 2.5 && (
                  <div className="disc-ok">✅ 風險控制在合理範圍內</div>
                )}
                {calc.rr !== null && calc.rr < 2 && (
                  <div className="disc-warn">⚠️ 損益比低於 2:1，建議尋找更好進場點或放大目標</div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
