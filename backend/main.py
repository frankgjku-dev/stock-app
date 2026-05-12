from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import asyncio
from concurrent.futures import ThreadPoolExecutor
import httpx
import yfinance as yf
import pandas as pd
import numpy as np
import pytz
from datetime import datetime

app = FastAPI(title="台股分析平台")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

TAIWAN_TZ = pytz.timezone("Asia/Taipei")
executor = ThreadPoolExecutor(max_workers=6)

# ── 股票清單 ──────────────────────────────────────────────
STOCK_LIST = {
    "0050": "元大台灣50",   "0056": "元大高股息",
    "2330": "台積電",       "2317": "鴻海",         "2454": "聯發科",
    "2382": "廣達",         "2308": "台達電",        "3008": "大立光",
    "2303": "聯電",         "2357": "華碩",          "2395": "研華",
    "2379": "瑞昱",         "2408": "南亞科",        "2345": "智邦",
    "6669": "緯穎",         "3034": "聯詠",          "4938": "和碩",
    "2377": "微星",         "3711": "日月光投控",    "2327": "國巨",
    "3017": "奇鋐",         "5269": "祥碩",          "8299": "群聯",
    "6415": "矽力-KY",      "2376": "技嘉",          "3231": "緯創",
    "2324": "仁寶",         "2356": "英業達",        "2301": "光寶科",
    "2353": "宏碁",         "6230": "超眾",          "6488": "環球晶",
    "3037": "欣興",         "2881": "富邦金",        "2882": "國泰金",
    "2886": "兆豐金",       "2884": "玉山金",        "2891": "中信金",
    "2885": "元大金",       "2883": "開發金",        "2880": "華南金",
    "2887": "台新金",       "2892": "第一金",        "5880": "合庫金",
    "1301": "台塑",         "1303": "南亞",          "1326": "台化",
    "6505": "台塑化",       "2002": "中鋼",          "1101": "台泥",
    "1216": "統一",         "2912": "統一超",        "9910": "豐泰",
    "2207": "和泰車",       "2412": "中華電",        "4904": "遠傳",
    "2618": "長榮航",       "2603": "長榮",          "2610": "華航",
    "5871": "中租-KY",      "2823": "中壽",          "4966": "譜瑞-KY",
    "6452": "康普",         "3045": "台灣大",
}

# ── 篩選用的股票池（啟動時會被動態股票清單取代）──────────────
SCREENER_LIST = {k: v for k, v in STOCK_LIST.items() if k not in ("0050", "0056")}

# ── 動態股票宇宙（啟動後從 TWSE/TPEX 抓取）──────────────────
# 初始為空，startup 後填入；搜尋 / 選股皆優先使用此表
STOCK_UNIVERSE: dict[str, str] = {}

# ── 掃描快取 ─────────────────────────────────────────────
scan_cache = {
    "status": "idle",   # idle | running | done | error
    "results": [],
    "progress": 0,
    "total": 0,
    "last_updated": None,
    "error": None,
}

# ══════════════════════════════════════════════════════════
#  VCP 回檔序列偵測（Volatility Contraction Pattern）
# ══════════════════════════════════════════════════════════

def _find_pullback_sequence(h_arr, l_arr, v_arr, lookback=100, window=5, min_depth_pct=3.0):
    """
    在 lookback 根 K 棒內，找出真正的 VCP 回檔序列。

    算法：
    1. 以 window 根為鄰域找局部高點（swing high）與低點（swing low）
    2. 每個高點 → 往後找第一個深度 >= min_depth_pct 的低點，組成一次「回檔」
    3. 去除重疊，建立時序排序的回檔清單

    回傳 list[dict]：
      peak / trough：價格
      depth_pct：回檔深度（%）
      avg_vol：回檔區間均量
    """
    n   = min(lookback, len(h_arr))
    h   = h_arr[-n:].astype(float)
    l   = l_arr[-n:].astype(float)
    v   = v_arr[-n:].astype(float)
    N   = len(h)
    if N < window * 2 + 4:
        return []

    peaks, troughs = [], []
    for i in range(window, N - window):
        # 局部高點：自身 >= 左右各 window 根的最高
        if h[i] >= np.max(h[i - window: i + window + 1]) - 1e-6:
            if not peaks or i - peaks[-1][0] >= window:
                peaks.append((i, float(h[i])))
            elif h[i] > peaks[-1][1]:          # 同一區塊取最高
                peaks[-1] = (i, float(h[i]))
        # 局部低點
        if l[i] <= np.min(l[i - window: i + window + 1]) + 1e-6:
            if not troughs or i - troughs[-1][0] >= window:
                troughs.append((i, float(l[i])))
            elif l[i] < troughs[-1][1]:
                troughs[-1] = (i, float(l[i]))

    raw = []
    for pidx, ph in peaks:
        # 找 peak 後 40 根以內最早的低點
        nxt = [(ti, tl) for ti, tl in troughs if pidx < ti <= pidx + 40]
        if not nxt:
            continue
        tidx, tl = nxt[0]                          # 第一個自然低點
        depth = (ph - tl) / ph * 100
        if depth >= min_depth_pct:
            raw.append({
                "peak_idx":   pidx,
                "trough_idx": tidx,
                "peak":       round(ph, 2),
                "trough":     round(tl, 2),
                "depth_pct":  round(depth, 1),
                "avg_vol":    float(np.mean(v[pidx: tidx + 1])),
            })

    if not raw:
        return []

    # 去除重疊（同一區間保留深度最大的）
    raw.sort(key=lambda x: x["peak_idx"])
    deduped = [raw[0]]
    for pb in raw[1:]:
        if pb["peak_idx"] > deduped[-1]["trough_idx"]:
            deduped.append(pb)
        elif pb["depth_pct"] > deduped[-1]["depth_pct"]:
            deduped[-1] = pb

    return deduped


def _best_contraction_sequence(pullbacks):
    """
    從回檔清單中找「深度遞減」的最長子序列。
    每次回檔深度必須小於前次 × 0.85（至少縮小 15%）。
    回傳最長子序列（list[dict]）。
    """
    if not pullbacks:
        return []
    recent = pullbacks[-8:]   # 只看最近 8 次
    best = []
    for start in range(len(recent)):
        seq = [recent[start]]
        for j in range(start + 1, len(recent)):
            if recent[j]["depth_pct"] < seq[-1]["depth_pct"] * 0.85:
                seq.append(recent[j])
        if len(seq) > len(best):
            best = seq
    return best


def detect_vcp(df: pd.DataFrame, cur_close: float, ma50: float, high52: float) -> dict:
    """
    VCP 完整偵測：
    ① 5 項量化指標評分（0–5 分）
    ② 真正的回檔序列偵測（2–6 次深度遞減）
    ③ Pivot Point = 最後一次收縮的高點（最精確定義）
    """
    empty = {
        "score": 0, "label": "", "pivot": 0.0, "dist_pivot": 0.0,
        "atr_ratio": None, "days_below_pivot": 0, "details": [],
        "contractions": 0, "contraction_depths": [], "vol_contracting": False,
        "last_depth_pct": 0.0,
    }
    if len(df) < 60:
        return empty

    h = df["High"].values.astype(float)
    l = df["Low"].values.astype(float)
    v = df["Volume"].values.astype(float)

    score, details = 0, []

    # ① 高位整理
    if cur_close >= ma50 and cur_close >= high52 * 0.75:
        score += 1; details.append("高位整理")

    # ② ATR 波動收縮
    atr20     = float(np.mean(h[-20:] - l[-20:])) if len(h) >= 20 else 0.0
    atr60     = float(np.mean(h[-60:] - l[-60:])) if len(h) >= 60 else atr20
    atr_ratio = round(atr20 / atr60, 2) if atr60 > 0 else 1.0
    if atr60 > 0 and atr_ratio < 0.80:
        score += 1; details.append(f"波動收縮({atr_ratio})")

    # ③ 量能萎縮（近20日均量 < 近50日 × 0.75）
    vol20 = float(np.mean(v[-20:])) if len(v) >= 20 else 0.0
    vol50 = float(np.mean(v[-50:])) if len(v) >= 50 else vol20
    if vol50 > 0 and vol20 / vol50 < 0.75:
        score += 1; details.append("量能萎縮")

    # ④ 近10日緊密整理（高低差 < 8%）
    if len(h) >= 10:
        tight = (float(max(h[-10:])) - float(min(l[-10:]))) / cur_close
        if tight < 0.08:
            score += 1; details.append(f"緊密整理({tight*100:.1f}%)")

    # ⑤ 健康回檔（近30日高低差 3–15%）
    if len(h) >= 30:
        pb30 = (float(max(h[-30:])) - float(min(l[-30:]))) / float(max(h[-30:]))
        if 0.03 < pb30 < 0.15:
            score += 1; details.append(f"健康回檔({pb30*100:.1f}%)")

    # ══ 真正的回檔序列偵測 ══════════════════════════════════
    all_pbs  = _find_pullback_sequence(h, l, v)
    vcp_seq  = _best_contraction_sequence(all_pbs)
    num_cont = len(vcp_seq)
    depths   = [pb["depth_pct"] for pb in vcp_seq]

    # 量能是否也逐步遞減
    vol_contracting = (
        num_cont >= 2 and
        all(vcp_seq[i]["avg_vol"] >= vcp_seq[i + 1]["avg_vol"]
            for i in range(num_cont - 1))
    )

    # 回檔序列評分加成（最高仍 5 分）
    if 2 <= num_cont <= 6:
        details.append(f"回檔序列{num_cont}次({'>'.join(str(d)+'%' for d in depths)})")
        score = min(score + 1, 5)
    if vol_contracting:
        details.append("量能逐步遞減"); score = min(score + 1, 5)

    last_depth_pct = vcp_seq[-1]["depth_pct"] if vcp_seq else 0.0

    # ══ Pivot Point ════════════════════════════════════════
    # 優先使用最後一次收縮的高點（Minervini 定義）
    # 次之：5–45 日前最高點（保底）
    if vcp_seq:
        pivot = round(vcp_seq[-1]["peak"], 2)
    else:
        ph_start = max(len(h) - 45, 0)
        ph_end   = max(len(h) - 5,  1)
        pivot_h  = h[ph_start:ph_end]
        pivot    = round(float(max(pivot_h)) if len(pivot_h) > 0 else cur_close, 2)

    dist_piv         = round((pivot - cur_close) / pivot * 100, 1)
    recent_c         = df["Close"].values[-20:] if len(df) >= 20 else df["Close"].values
    days_below_pivot = int(sum(1 for x in recent_c if float(x) < pivot))
    label            = ("VCP強" if score >= 4 else "VCP中" if score >= 3 else
                        "VCP弱" if score >= 2 else "")

    return {
        "score":             score,
        "label":             label,
        "pivot":             pivot,
        "dist_pivot":        dist_piv,
        "atr_ratio":         atr_ratio,
        "days_below_pivot":  days_below_pivot,
        "details":           details,
        "contractions":      num_cont,
        "contraction_depths": depths,
        "vol_contracting":   vol_contracting,
        "last_depth_pct":    last_depth_pct,
    }


def _calc_rs_raw(close: pd.Series) -> float:
    """計算未排名的 RS 原始分數（Minervini 加權公式）"""
    def ret(days):
        if len(close) >= days:
            return float(close.iloc[-1] / close.iloc[-days] - 1) * 100
        return 0.0
    return 0.4 * ret(63) + 0.2 * ret(126) + 0.2 * ret(189) + 0.2 * ret(252)


def check_trend_template(df: pd.DataFrame, code: str, name: str) -> dict | None:
    if len(df) < 210:
        return None
    close = df["Close"].dropna()
    if len(close) < 210:
        return None

    ma50  = close.rolling(50).mean()
    ma150 = close.rolling(150).mean()
    ma200 = close.rolling(200).mean()

    c    = float(close.iloc[-1])
    m50  = float(ma50.iloc[-1])
    m150 = float(ma150.iloc[-1])
    m200 = float(ma200.iloc[-1])

    # MA200 至少向上 20 個交易日
    ma200_up = float(ma200.iloc[-1]) > float(ma200.iloc[-20])

    # 52 週高低（約 252 交易日）
    window = close.iloc[-252:] if len(close) >= 252 else close
    high52 = float(window.max())
    low52  = float(window.min())

    conds = {
        "c1": c > m150,
        "c2": c > m200,
        "c3": m150 > m200,
        "c4": ma200_up,
        "c5": m50 > m150 and m50 > m200,
        "c6": c > m50,
        "c7": c >= low52 * 1.30,
        "c8": c >= high52 * 0.75,
    }
    passed = sum(conds.values())
    rs_raw  = _calc_rs_raw(close)
    vcp     = detect_vcp(df, c, m50, high52)
    pp      = detect_pocket_pivot(df)

    return {
        "symbol":    code,
        "name":      name,
        "close":     round(c, 2),
        "ma50":      round(m50, 2),
        "ma150":     round(m150, 2),
        "ma200":     round(m200, 2),
        "high52":    round(high52, 2),
        "low52":     round(low52, 2),
        "from_high": round((c / high52 - 1) * 100, 1),
        "from_low":  round((c / low52  - 1) * 100, 1),
        "from_ma50":  round((c / m50  - 1) * 100, 1),
        "from_ma200": round((c / m200 - 1) * 100, 1),
        "rs_raw":    round(rs_raw, 2),
        "rs_rating": 0,
        "conditions":     conds,
        "passed":         passed,
        "vcp":            vcp,
        "pocket_pivot":   pp,
    }


# ══════════════════════════════════════════════════════════
#  選股建議引擎（Trade Setup Generator）
# ══════════════════════════════════════════════════════════
def generate_recommendation(r: dict) -> dict:
    """
    依據 VCP / Pocket Pivot / RS / 趨勢 產生進場建議。
    在 run_scan() 為每筆結果補上 rs_rating 後呼叫。
    """
    close      = r["close"]
    vcp        = r.get("vcp") or {}
    pp         = r.get("pocket_pivot", False)
    rs         = r.get("rs_rating", 0)
    passed     = r.get("passed", 0)
    from_high  = r.get("from_high", -100)     # 距52週高點%（負=低於高點）
    from_ma50  = r.get("from_ma50",  0)        # 距MA50% （正=高於MA50）
    from_ma200 = r.get("from_ma200", 0)        # 距MA200%

    pivot            = vcp.get("pivot")
    dist_piv         = vcp.get("dist_pivot")
    vcp_score        = vcp.get("score", 0)
    days_below_pivot = vcp.get("days_below_pivot", 0)
    contractions     = vcp.get("contractions", 0)        # 實際回檔次數
    depths           = vcp.get("contraction_depths", []) # 各次深度清單
    vol_contracting  = vcp.get("vol_contracting", False)
    last_depth_pct   = vcp.get("last_depth_pct", 0.0)
    # 組合 VCP 描述文字（用於 reason）
    vcp_desc = (f"VCP{vcp_score}/5，{contractions}次收縮({'>'.join(str(d)+'%' for d in depths)})"
                f"{'，量能遞減' if vol_contracting else ''}"
                if contractions >= 2
                else f"VCP{vcp_score}/5")

    def make(action, label, urgency, reason, setup="",
             entry=None, stop=None, target=None, rr=None):
        return {
            "action":       action,
            "action_label": label,
            "urgency":      urgency,   # high / medium / low / none
            "setup_type":   setup,
            "reason":       reason,
            "entry":        round(entry,  2) if entry  else None,
            "stop":         round(stop,   2) if stop   else None,
            "target":       round(target, 2) if target else None,
            "rr":           round(rr,     2) if rr     else None,
        }

    # ── 0. 距均線延伸過大 → 直接標記，不進任何進場分析 ────
    # Minervini 原則：超過MA50的20%以上或MA200的50%以上，
    # 代表已在漲幅末段，追高風險極高
    is_extended = from_ma50 > 20 or from_ma200 > 50
    if is_extended:
        support_proxy = round(close / (1 + from_ma50 / 100) * 1.05, 2)   # 粗估MA50+5%緩衝
        return make(
            "extended", "⚠️ 延伸過大，等回測", "none",
            f"股價已在MA50上方 {from_ma50:.1f}%（MA200上方 {from_ma200:.1f}%），"
            f"屬突破後延伸行情，不宜追高。"
            f"等待回測均線整理（MA50附近 {support_proxy}）量縮後再重新評估。",
            setup="過度延伸",
        )

    # ── 1. Pocket Pivot（最高優先）──────────────────────────
    # 需要：PP + VCP ≥ 3 + 實際回檔序列 ≥ 2 次 + RS ≥ 65 + 整理 ≥ 8 天
    if pp and vcp_score >= 3 and contractions >= 2 and rs >= 65 and days_below_pivot >= 8:
        stop = close * 0.925
        tgt  = close + (close - stop) * 2.5
        return make(
            "buy_now", "🚀 可考慮進場", "high",
            f"Pocket Pivot！量能突破過去10日黑K最大量。"
            f"{vcp_desc}，RS {rs:.0f}，整理{days_below_pivot}/20天，距MA50 {from_ma50:.1f}%。"
            f"最後收縮深度 {last_depth_pct:.1f}%（規格 < 10%）。"
            f"進場 {close}，停損 {round(stop,2)}（{round((close-stop)/close*100,1)}%），"
            f"目標 {round(tgt,2)}（2.5:1）。",
            setup=f"Pocket Pivot + {vcp_desc}",
            entry=close, stop=stop, target=tgt, rr=2.5,
        )

    # ── 2. 剛突破樞紐點（pivot 上方 0–5%）──────────────────
    # 需要：VCP ≥ 3 + 回檔 ≥ 2 次 + RS ≥ 60 + 整理 ≥ 8 天
    if (pivot and dist_piv is not None and -5 <= dist_piv < 0
            and vcp_score >= 3 and contractions >= 2 and rs >= 60 and days_below_pivot >= 8):
        entry = pivot * 1.003
        stop  = pivot * 0.925
        tgt   = entry + (entry - stop) * 2.5
        return make(
            "buy_now", "🟢 剛突破，可進場", "high",
            f"剛突破樞紐 {pivot}（超出 {abs(dist_piv):.1f}%）。"
            f"{vcp_desc}，RS {rs:.0f}，整理{days_below_pivot}/20天。"
            f"最後收縮深度 {last_depth_pct:.1f}%（規格 < 10%）。"
            f"進場 ≤ {round(entry,2)}，停損 {round(stop,2)}（{round((entry-stop)/entry*100,1)}%），目標 {round(tgt,2)}。",
            setup=f"VCP突破({vcp_score}/5)",
            entry=entry, stop=stop, target=tgt, rr=2.5,
        )

    # ── 3. 即將突破（距樞紐 0–3%）──────────────────────────
    # 需要：VCP ≥ 3 + 回檔 ≥ 2 次 + RS ≥ 60 + 整理 ≥ 8 天
    if (pivot and dist_piv is not None and 0 <= dist_piv <= 3
            and vcp_score >= 3 and contractions >= 2 and rs >= 60 and days_below_pivot >= 8):
        entry = pivot * 1.003
        stop  = pivot * 0.925
        tgt   = entry + (entry - stop) * 2.5
        return make(
            "breakout", "🔔 即將突破", "high",
            f"距樞紐點 {pivot} 僅 {dist_piv}%，整理{days_below_pivot}/20天。"
            f"{vcp_desc}，RS {rs:.0f}，最後收縮深度 {last_depth_pct:.1f}%。"
            f"突破放量（≥50日均量×1.5）後掛單 {round(entry,2)}，"
            f"停損 {round(stop,2)}，目標 {round(tgt,2)}（2.5:1）。",
            setup=f"VCP({vcp_score}/5)",
            entry=entry, stop=stop, target=tgt, rr=2.5,
        )

    # ── 4. 設置提醒（距樞紐 3–8%）──────────────────────────
    if (pivot and dist_piv is not None and 3 < dist_piv <= 8
            and vcp_score >= 2 and rs >= 55):
        entry = pivot * 1.003
        stop  = pivot * 0.925
        tgt   = entry + (entry - stop) * 2.5
        cont_note = f"，回檔序列{contractions}次" if contractions >= 2 else "，尚未形成完整VCP序列"
        return make(
            "set_alert", "⏰ 設置突破提醒", "medium",
            f"距樞紐點 {pivot} 約 {dist_piv}%，VCP{vcp_score}/5{cont_note}，RS {rs:.0f}，整理接近尾聲。"
            f"設 {round(entry,2)} 價格提醒，突破放量後進場，停損 {round(stop,2)}，目標 {round(tgt,2)}。",
            setup=f"VCP({vcp_score}/5)",
            entry=entry, stop=stop, target=tgt, rr=2.5,
        )

    # ── 5. 整理觀察（距樞紐 8–25%）──────────────────────────
    if pivot and dist_piv is not None and 8 < dist_piv <= 25 and vcp_score >= 2:
        entry = pivot * 1.003
        stop  = pivot * 0.925
        tgt   = entry + (entry - stop) * 2.5
        return make(
            "watch", "👀 整理觀察", "low",
            f"VCP 整理中，距樞紐點 {dist_piv}%。{vcp_desc}，RS {rs:.0f}，距MA50 {from_ma50:.1f}%。"
            f"耐心等待波動收縮完成（目標進場 {round(entry,2)}）。",
            setup=f"VCP({vcp_score}/5)",
            entry=entry, stop=stop, target=tgt, rr=2.5,
        )

    # ── 6. 已突破過遠（> 5% 以上）────────────────────────
    if pivot and dist_piv is not None and dist_piv < -5:
        ma50_price = round(close / (1 + from_ma50 / 100), 2)
        return make(
            "extended", "⚠️ 突破後勿追高", "low",
            f"已突破樞紐 {pivot}（距高 {from_high}%），超出進場窗口。"
            f"等待回測 MA50（約 {ma50_price}）量縮整理後再評估。",
            setup="突破後延伸",
        )

    # ── 7. Trend Template 良好但無 VCP ─────────────────
    if passed >= 7 and rs >= 75:
        return make(
            "watch", "📊 趨勢佳，等整理", "low",
            f"Trend Template {passed}/8，RS {rs:.0f}，距MA50 {from_ma50:.1f}%。"
            f"Stage 2 上升趨勢確認，但尚未形成 VCP 整理型態，耐心等待量縮整理。",
            setup="Stage 2",
        )

    # ── 8. 條件不足 ──────────────────────────────────────
    return make(
        "not_ready", "📋 條件不足", "none",
        f"Trend Template {passed}/8，RS {rs:.0f}，尚未達到進場標準。",
        setup="觀察名單",
    )


def detect_pocket_pivot(df: pd.DataFrame) -> bool:
    """
    Pocket Pivot：今日收紅K，且今日量 > 過去10日所有黑K中的最大量
    """
    if len(df) < 12:
        return False
    today = df.iloc[-1]
    if float(today["Close"]) <= float(today["Open"]):
        return False          # 今日非紅K
    past10    = df.iloc[-11:-1]
    down_days = past10[past10["Close"] < past10["Open"]]
    if down_days.empty:
        return True           # 近10日無黑K，非常強勢
    max_down_vol = float(down_days["Volume"].max())
    return float(today["Volume"]) > max_down_vol


def _fetch_df(code: str) -> pd.DataFrame | None:
    try:
        df = yf.Ticker(f"{code}.TW").history(period="1y", interval="1d", auto_adjust=True)
        return df if not df.empty else None
    except Exception:
        return None


async def run_scan():
    global scan_cache
    # 使用動態股票宇宙（啟動後已更新），若未更新則用內建清單
    pool  = SCREENER_LIST if SCREENER_LIST else {k: v for k, v in STOCK_LIST.items() if k not in ("0050","0056")}
    codes = list(pool.keys())
    scan_cache.update({"status": "running", "results": [], "progress": 0,
                       "total": len(codes), "error": None,
                       "pool_source": "TWSE+TPEX" if len(codes) > 100 else "built-in"})

    loop = asyncio.get_event_loop()
    raw_results = []

    # fetch & analyse in groups of 6
    sem = asyncio.Semaphore(6)

    async def process(code):
        async with sem:
            df = await loop.run_in_executor(executor, _fetch_df, code)
            if df is None:
                return None
            return check_trend_template(df, code, pool[code])

    tasks = [process(c) for c in codes]
    for i, coro in enumerate(asyncio.as_completed(tasks)):
        result = await coro
        if result:
            raw_results.append(result)
        scan_cache["progress"] = i + 1
        await asyncio.sleep(0)   # yield to event loop

    # RS Rating: percentile rank across all results
    if raw_results:
        raws = np.array([r["rs_raw"] for r in raw_results])
        for r in raw_results:
            pct = float(np.sum(raws <= r["rs_raw"]) / len(raws) * 99)
            r["rs_rating"] = round(pct, 1)
        # 生成選股建議（rs_rating 已確定後才呼叫）
        for r in raw_results:
            r["recommendation"] = generate_recommendation(r)

    scan_cache.update({
        "status": "done",
        "results": sorted(raw_results, key=lambda x: x["rs_rating"], reverse=True),
        "last_updated": datetime.now().isoformat(),
    })


# ══════════════════════════════════════════════════════════
#  大盤狀態
# ══════════════════════════════════════════════════════════
def _detect_ftd(df: pd.DataFrame) -> dict:
    """
    Follow-Through Day (FTD) 偵測。
    定義：大盤修正後，出現「反彈嘗試」，
    在反彈第 4–7 天，收盤漲幅 > 1.7% 且量能大於前一日 → FTD 確認。

    回傳：
      has_ftd: bool
      ftd_gain_pct: 當日漲幅
      days_since_ftd: 距今幾個交易日
      rally_day: 反彈第幾天觸發
      status: 描述字串
    """
    if len(df) < 20:
        return {"has_ftd": False, "status": "資料不足"}

    c = df["Close"].values[-40:].astype(float)
    v = df["Volume"].values[-40:].astype(float)
    n = len(c)

    # 1. 找最近一次「修正低點」：從近 30 日找最低點，且須比前期高點低 5%+
    window = min(30, n)
    sub_c  = c[-window:]
    low_offset = int(np.argmin(sub_c))          # 在 sub_c 中的位置
    low_idx    = (n - window) + low_offset       # 在 c 中的絕對位置
    low_price  = c[low_idx]

    # 找低點前的高點（往前最多 15 根）
    pre_high = float(max(c[max(0, low_idx - 15): low_idx])) if low_idx > 0 else low_price
    if pre_high == 0 or low_price / pre_high > 0.95:
        # 修正幅度不到 5%，不算有意義的修正
        return {"has_ftd": False, "status": "近期無明顯修正"}

    # 2. 找反彈 Day 1 = 低點後第一個收高於前日的交易日
    rally_start = None
    for i in range(low_idx + 1, n):
        if c[i] > c[i - 1]:
            rally_start = i
            break
    if rally_start is None:
        return {"has_ftd": False, "status": "尚未開始反彈"}

    # 3. 在 Day 4–7 找 FTD（漲 > 1.7% + 量 > 前日）
    for d in range(3, 8):
        idx = rally_start + d
        if idx >= n:
            break
        # 確認低點未被跌破（否則反彈嘗試失敗，重置）
        if c[idx] < low_price:
            return {"has_ftd": False, "status": "反彈失敗，低點被跌破"}
        gain_pct = (c[idx] - c[idx - 1]) / c[idx - 1] * 100
        if gain_pct > 1.7 and v[idx] > v[idx - 1]:
            days_since = n - 1 - idx
            return {
                "has_ftd":      True,
                "ftd_gain_pct": round(gain_pct, 2),
                "rally_day":    d + 1,         # 人類可讀：第幾天
                "days_since_ftd": int(days_since),
                "status":       (f"✅ FTD 確認（反彈第{d+1}天，+{gain_pct:.1f}%放量）"
                                  if days_since == 0
                                  else f"✅ FTD 已確認（{days_since}天前，反彈第{d+1}天）"),
            }

    # 還在 Day 1–3，尚未到可觀察窗口
    days_in_rally = n - 1 - rally_start
    if days_in_rally < 3:
        return {
            "has_ftd": False,
            "status":  f"反彈嘗試第{days_in_rally + 1}天，等待第4天確認FTD",
        }
    return {"has_ftd": False, "status": "Day 4–7 未出現放量大漲，反彈嘗試中"}


async def _get_index_status_async():
    loop = asyncio.get_event_loop()
    def _fetch():
        df = yf.Ticker("^TWII").history(period="1y", interval="1d", auto_adjust=True)
        return df
    df = await loop.run_in_executor(executor, _fetch)
    if df.empty or len(df) < 60:
        return None

    close = df["Close"].dropna()
    c    = float(close.iloc[-1])
    m50  = float(close.rolling(50).mean().iloc[-1])
    m200 = float(close.rolling(200).mean().iloc[-1])

    # Distribution Days (近 25 個交易日，量增收黑)
    dist   = 0
    recent = df.tail(25)
    for i in range(1, len(recent)):
        row  = recent.iloc[i]
        prev = recent.iloc[i - 1]
        if row["Close"] < prev["Close"] and row["Volume"] > prev["Volume"]:
            dist += 1

    # FTD 偵測
    ftd = _detect_ftd(df)

    trend = "多頭" if c > m50 > 0 and c > m200 else ("震盪" if c > m200 else "空頭")
    return {
        "index": round(c, 2),
        "ma50":  round(m50, 2),
        "ma200": round(m200, 2),
        "above_ma50":  c > m50,
        "above_ma200": c > m200,
        "distribution_days": dist,
        "trend": trend,
        "ftd":   ftd,
        "suggestion": "滿倉" if trend == "多頭" and dist < 4 else
                      ("半倉" if dist < 6 else "空倉/觀望"),
    }


# ══════════════════════════════════════════════════════════
#  API 路由
# ══════════════════════════════════════════════════════════
def to_yf(symbol: str) -> str:
    return f"{symbol}.TW"


async def _fetch_tw_stock_universe() -> dict[str, str]:
    """
    從 TWSE（上市）+ TPEX（上櫃）公開 API 取得全台股清單。
    只保留 4 位數字代碼的普通股，ETF / 特別股 / 認購權證排除。
    回傳 {代碼: 名稱}，失敗時回傳空 dict（呼叫端使用 fallback）。
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "application/json",
    }
    result: dict[str, str] = {}

    # ── 上市（TWSE）──────────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=20.0, headers=headers) as client:
            r = await client.get(
                "https://openapi.twse.com.tw/v1/exchangeReport/BWIBBU_d"
            )
            if r.status_code == 200:
                for item in r.json():
                    code = str(item.get("Code", "")).strip()
                    name = str(item.get("Name", "")).strip()
                    # 只要 4 碼純數字（普通股），跳過 ETF(0開頭4碼)
                    if len(code) == 4 and code.isdigit() and code[0] != "0" and name:
                        result[code] = name
    except Exception as e:
        print(f"[universe] TWSE fetch failed: {e}")

    # ── 上櫃（TPEX）──────────────────────────────────────
    try:
        async with httpx.AsyncClient(timeout=20.0, headers=headers) as client:
            r = await client.get(
                "https://www.tpex.org.tw/openapi/v1/tpex_mainboard_peratio_analysis"
            )
            if r.status_code == 200:
                for item in r.json():
                    code = str(item.get("SecuritiesCompanyCode", "")).strip()
                    name = str(item.get("CompanyName", "")).strip()
                    if len(code) == 4 and code.isdigit() and code[0] != "0" and name:
                        result[code] = name
    except Exception as e:
        print(f"[universe] TPEX fetch failed: {e}")

    print(f"[universe] loaded {len(result)} stocks (TWSE+TPEX)")
    return result


@app.on_event("startup")
async def startup_event():
    """啟動時非同步抓取全台股清單，失敗不影響服務啟動"""
    global STOCK_UNIVERSE, SCREENER_LIST
    universe = await _fetch_tw_stock_universe()
    if len(universe) >= 100:          # 確保資料有效才切換
        STOCK_UNIVERSE = universe
        # 選股池 = 全市場（排除 ETF 0 開頭的已在上面過濾）
        SCREENER_LIST  = dict(universe)
    else:
        # 抓取失敗，沿用內建清單
        STOCK_UNIVERSE = dict(STOCK_LIST)
        print("[universe] using built-in fallback list")


@app.get("/")
async def root():
    return {
        "message":      "台股分析平台 API v2.0",
        "universe_size": len(STOCK_UNIVERSE),
    }


@app.get("/api/stocks/search")
async def search_stocks(q: str = ""):
    # 優先用動態完整清單，否則用內建清單
    pool = STOCK_UNIVERSE if STOCK_UNIVERSE else STOCK_LIST
    q    = q.strip()
    if not q:
        return [{"symbol": k, "name": v} for k, v in list(pool.items())[:20]]
    q_lower = q.lower()
    return [
        {"symbol": code, "name": name}
        for code, name in pool.items()
        if q_lower in code or q_lower in name
    ][:20]


@app.get("/api/screener/universe")
async def screener_universe():
    """回傳目前選股池的股票數與清單（前端顯示用）"""
    pool = STOCK_UNIVERSE if STOCK_UNIVERSE else STOCK_LIST
    return {
        "count":  len(SCREENER_LIST),
        "source": "TWSE+TPEX" if len(STOCK_UNIVERSE) >= 100 else "built-in",
        "sample": list(SCREENER_LIST.items())[:5],
    }


@app.get("/api/stocks/{symbol}/candles")
async def get_candles(symbol: str, interval: str = "1d", period: str = "1y"):
    try:
        if interval == "1m":
            period = "7d"
        elif interval in ("5m", "15m", "30m", "60m", "90m") and period in ("1y", "5y", "max"):
            period = "60d"

        df = yf.Ticker(to_yf(symbol)).history(
            period=period, interval=interval, auto_adjust=True
        )
        if df.empty:
            return {"symbol": symbol, "candles": [], "error": "No data"}

        df = df.reset_index()
        candles = []
        is_intraday = interval not in ("1d", "1wk", "1mo")

        for _, row in df.iterrows():
            dt = row.get("Datetime") or row.get("Date")
            if dt is None:
                continue
            if is_intraday:
                if hasattr(dt, "tzinfo") and dt.tzinfo:
                    dt = dt.astimezone(TAIWAN_TZ)
                time_val = int(pd.Timestamp(dt).timestamp())
            else:
                time_val = str(dt)[:10] if not hasattr(dt, "date") else str(dt.date())

            o, h, l, c = (float(row[k]) for k in ("Open", "High", "Low", "Close"))
            if any(pd.isna(x) for x in (o, h, l, c)):
                continue
            v = int(row["Volume"]) if not pd.isna(row.get("Volume", float("nan"))) else 0
            candles.append({"time": time_val, "open": round(o,2), "high": round(h,2),
                            "low": round(l,2), "close": round(c,2), "volume": v})

        return {"symbol": symbol, "name": STOCK_LIST.get(symbol, symbol), "candles": candles}
    except Exception as e:
        return {"symbol": symbol, "candles": [], "error": str(e)}


@app.get("/api/stocks/{symbol}/quote")
async def get_quote(symbol: str):
    for market in ("tse", "otc"):
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                url = (f"https://mis.twse.com.tw/stock/api/getStockInfo.jsp"
                       f"?ex_ch={market}_{symbol}.tw&json=1&delay=0")
                resp = await client.get(url)
                arr  = resp.json().get("msgArray", [])
                if arr:
                    item = arr[0]
                    z, y = item.get("z", "-"), item.get("y", "0") or "0"
                    prev  = float(y)
                    price = float(z) if z and z != "-" else prev
                    return {
                        "symbol": symbol, "name": item.get("n", STOCK_LIST.get(symbol, symbol)),
                        "price": price, "prev_close": prev,
                        "open":  float(item.get("o", 0) or 0),
                        "high":  float(item.get("h", 0) or 0),
                        "low":   float(item.get("l", 0) or 0),
                        "volume": int(float(item.get("v", 0) or 0)),
                        "change": round(price - prev, 2),
                        "change_pct": round((price - prev) / prev * 100, 2) if prev else 0,
                    }
        except Exception:
            continue
    try:
        fi = yf.Ticker(to_yf(symbol)).fast_info
        price = round(float(fi.last_price), 2)
        prev  = round(float(fi.previous_close), 2)
        return {
            "symbol": symbol, "name": STOCK_LIST.get(symbol, symbol),
            "price": price, "prev_close": prev,
            "open":  round(float(fi.open), 2),
            "high":  round(float(fi.day_high), 2),
            "low":   round(float(fi.day_low), 2),
            "volume": 0,
            "change": round(price - prev, 2),
            "change_pct": round((price - prev) / prev * 100, 2) if prev else 0,
        }
    except Exception as e:
        return {"symbol": symbol, "error": str(e), "price": 0, "change": 0, "change_pct": 0}


# ── Screener ────────────────────────────────────────────
@app.post("/api/screener/start")
async def start_screener(background_tasks: BackgroundTasks):
    if scan_cache["status"] == "running":
        return {"status": "already_running", "message": "掃描中，請稍候"}
    background_tasks.add_task(run_scan)
    return {"status": "started"}


@app.get("/api/screener/status")
async def screener_status():
    return scan_cache


# ── Market ──────────────────────────────────────────────
@app.get("/api/market/status")
async def market_status():
    result = await _get_index_status_async()
    if result is None:
        return {"error": "無法取得大盤資料"}
    return result


# ── WebSocket ───────────────────────────────────────────
@app.websocket("/ws/quote/{symbol}")
async def ws_quote(ws: WebSocket, symbol: str):
    await ws.accept()
    try:
        while True:
            q = await get_quote(symbol)
            await ws.send_json(q)
            await asyncio.sleep(3)
    except WebSocketDisconnect:
        pass
    except Exception:
        pass


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
