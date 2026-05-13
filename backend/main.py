from fastapi import FastAPI, WebSocket, WebSocketDisconnect, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
import asyncio
from concurrent.futures import ThreadPoolExecutor
import httpx
import yfinance as yf
import pandas as pd
import numpy as np
import pytz
from datetime import datetime, timedelta
_candle_cache: dict[str, tuple[datetime, list]] = {}
CACHE_TTL_INTRADAY = timedelta(minutes=5)    # 分鐘線：5 分鐘快取
CACHE_TTL_DAILY    = timedelta(hours=2)      # 日線/週線/月線：2 小時快取

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
    從回檔清單中找「深度遞減 + 低點墊高」的最長子序列。

    Minervini VCP 兩大硬條件：
    1. 深度遞減：後一次深度 ≤ 前一次 × 0.80
       （即每次回檔至少縮小 20%，例如 25% → 20% → 16%）
       理想情況是接近減半（25% → 12% → 6%），由評分系統另行獎勵。
    2. 低點墊高：後一次低點（trough）必須 >= 前一次低點 × 0.98（允許 2% 容差）
       代表「高低點皆墊高」的多頭格局。

    兩個條件同時滿足才納入序列；最多取最近 8 次回檔中的最長合格子序列。
    """
    if not pullbacks:
        return []
    recent = pullbacks[-8:]   # 只看最近 8 次
    best = []
    for start in range(len(recent)):
        seq = [recent[start]]
        for j in range(start + 1, len(recent)):
            prev = seq[-1]
            cur  = recent[j]
            depth_ok  = cur["depth_pct"] <= prev["depth_pct"] * 0.80   # 深度縮小 ≥20%
            trough_ok = cur["trough"]    >= prev["trough"]    * 0.98   # 低點不得更低
            if depth_ok and trough_ok:
                seq.append(cur)
        if len(seq) > len(best):
            best = seq
    return best


def detect_vcp(df: pd.DataFrame, cur_close: float, ma50: float, high52: float) -> dict:
    """
    VCP 完整偵測（按 Minervini 規格）

    評分系統（100 分制，部分分由此函式計算）：
      VCP 結構 30 分 + 量能 20 分 + 突破準備 10 分 = 此函式最高 60 分
      趨勢 25 分：由 check_trend_template() 追加
      強勢 15 分：由 run_scan() 追加（RS 排名確定後）

    新增輸出欄位：
      score100   - 部分分（0-60），外層追加後會到 100
      stop_loss  - min(最後收縮低點, pivot * 0.93)
      buy_status - 等待 / 偷跑 / 正式突破 / 過度延伸 / 整理中
      base_days  - base 長度（交易日）
      higher_lows - 低點是否墊高
    """
    empty = {
        "score": 0, "score100": 0, "label": "",
        "pivot": 0.0, "pivot_date": "",
        "base_high": 0.0, "base_high_date": "",
        "dist_pivot": 0.0,
        "atr_ratio": None, "days_below_pivot": 0, "details": [],
        "contractions": 0, "contraction_depths": [], "vol_contracting": False,
        "last_depth_pct": 0.0, "stop_loss": 0.0,
        "buy_status": "—", "base_days": 0, "higher_lows": False,
    }
    if len(df) < 60:
        return empty

    h     = df["High"].values.astype(float)
    l     = df["Low"].values.astype(float)
    c_arr = df["Close"].values.astype(float)
    v     = df["Volume"].values.astype(float)

    # ══ 回檔序列偵測 ═══════════════════════════════════════════
    all_pbs  = _find_pullback_sequence(h, l, v)
    vcp_seq  = _best_contraction_sequence(all_pbs)
    num_cont = len(vcp_seq)
    depths   = [pb["depth_pct"] for pb in vcp_seq]
    max_depth  = max(depths) if depths else 0.0
    last_depth = depths[-1]  if depths else 100.0

    # 最大回檔 > 35% → 不符合 VCP 規格，整個序列作廢
    if max_depth > 35:
        vcp_seq = []; num_cont = 0; depths = []; max_depth = 0.0; last_depth = 100.0

    # ── Base 長度 ──────────────────────────────────────────────
    base_days = 0
    if vcp_seq:
        base_days = int(vcp_seq[-1]["trough_idx"] - vcp_seq[0]["peak_idx"])
    base_valid = 15 <= base_days <= 65

    # ── 低點墊高（已在序列建構時強制執行，這裡做確認記錄）──────
    higher_lows = False
    if num_cont >= 2:
        troughs = [pb["trough"] for pb in vcp_seq]
        higher_lows = all(troughs[i] >= troughs[i-1] * 0.98
                          for i in range(1, len(troughs)))

    # ── ATR ───────────────────────────────────────────────────
    atr10     = float(np.mean(h[-10:] - l[-10:])) if len(h) >= 10 else 0.0
    atr50     = float(np.mean(h[-50:] - l[-50:])) if len(h) >= 50 else atr10
    atr_ratio = round(atr10 / atr50, 2) if atr50 > 0 else 1.0

    # ── 量能統計 ──────────────────────────────────────────────
    vol5  = float(np.mean(v[-5:]))  if len(v) >= 5  else float(np.mean(v))
    vol20 = float(np.mean(v[-20:])) if len(v) >= 20 else float(np.mean(v))
    vol50 = float(np.mean(v[-50:])) if len(v) >= 50 else vol20
    vol5_ratio = round(vol5 / vol50, 2) if vol50 > 0 else 1.0

    # 後半段 vs 前半段量
    vol_second_half_lt_first = False
    if num_cont >= 2:
        mid    = max(1, num_cont // 2)
        fh_vol = float(np.mean([pb["avg_vol"] for pb in vcp_seq[:mid]]))
        sh_vol = float(np.mean([pb["avg_vol"] for pb in vcp_seq[mid:]]))
        vol_second_half_lt_first = sh_vol < fh_vol
    elif len(v) >= 40:
        vol_second_half_lt_first = float(np.mean(v[-20:])) < float(np.mean(v[-40:-20]))

    # 下跌日量縮（近10日黑K均量 < 50日均量）
    down_day_vol_ok = False
    if len(df) >= 10 and vol50 > 0:
        recent10  = df.iloc[-10:]
        down_days = recent10[recent10["Close"] < recent10["Open"]]
        if not down_days.empty:
            down_day_vol_ok = float(down_days["Volume"].mean()) < vol50

    # ══ 100 分制（部分：VCP結構30 + 量能20 + 突破準備10 = 60）═══
    s100    = 0
    details = []

    # ── VCP 結構（30 分）──────────────────────────────────────
    struct = 0
    if 2 <= num_cont <= 6:                            # 2–6 次收縮：8分
        struct += 8
        details.append(f"收縮{num_cont}次({'>'.join(str(d)+'%' for d in depths)})")
    if num_cont >= 2:
        # 減半規則：每次深度 ≤ 前次 × 0.55（≈減半，例如 25%→12%→6%）
        halving    = all(depths[i] <= depths[i-1] * 0.55  for i in range(1, len(depths)))
        # 良好：每次深度 ≤ 前次 × 0.75（縮小 25% 以上）
        good_dec   = all(depths[i] <= depths[i-1] * 0.75  for i in range(1, len(depths)))
        # 可接受：嚴格遞減（每次比前次小，但縮減比例不限）
        strict_dec = all(depths[i] <  depths[i-1]          for i in range(1, len(depths)))
        if halving:
            struct += 10; details.append(f"深度減半({'>'.join(str(d)+'%' for d in depths)})")
        elif good_dec:
            struct +=  7; details.append(f"回檔遞減良好({'>'.join(str(d)+'%' for d in depths)})")
        elif strict_dec:
            struct +=  4; details.append(f"回檔遞減({'>'.join(str(d)+'%' for d in depths)})")
    if higher_lows:                                   # 低點墊高（硬條件已通過）：6分
        struct += 6; details.append("低點墊高 ✓")
    if last_depth < 8:                                # 最後收縮深度：6分
        struct += 6; details.append(f"末段收縮{last_depth:.1f}%(<8%理想)")
    elif last_depth < 10:
        struct += 4; details.append(f"末段收縮{last_depth:.1f}%(<10%)")
    elif last_depth < 12:
        struct += 2; details.append(f"末段收縮{last_depth:.1f}%(<12%)")
    if base_valid:                                    # Base 長度加成：2分
        struct = min(struct + 2, 30)
    s100 += min(struct, 30)

    # ── 量能（20 分）──────────────────────────────────────────
    vol_s = 0
    if vol_second_half_lt_first:                      # 後半段量縮：7分
        vol_s += 7; details.append("後半段量縮")
    if vol5_ratio <= 0.50:                            # 最後5日量乾：8分
        vol_s += 8; details.append(f"量極乾({vol5_ratio:.0%})")
    elif vol5_ratio <= 0.70:
        vol_s += 5; details.append(f"量乾({vol5_ratio:.0%})")
    elif vol5_ratio <= 0.85:
        vol_s += 2
    if down_day_vol_ok:                               # 下跌日量縮：5分
        vol_s += 5; details.append("下跌日量縮")
    s100 += min(vol_s, 20)

    vol_contracting = vol_second_half_lt_first

    # ══ 輔助：peak_idx → df 日期字串 ══════════════════════════
    def _peak_date(pb_entry):
        lb  = min(252, len(df))
        row = len(df) - lb + pb_entry["peak_idx"]
        try:
            idx = df.index
            if hasattr(idx, 'tz') or hasattr(idx, 'freq'):
                return str(idx[row])[:10]
            elif "Date" in df.columns:
                return str(df["Date"].iloc[row])[:10]
            elif "Datetime" in df.columns:
                return str(df["Datetime"].iloc[row])[:10]
        except Exception:
            return ""
        return ""

    # ══ 兩個關鍵價位分開計算 ════════════════════════════════════
    #
    # 基準點（Base High）= VCP 整理區起始高點
    #   → vcp_seq 中峰值最高的那一個（整理開始前的波段高點）
    #   → 只要股價未突破此點，皆屬同一段 VCP
    #
    # 樞紐點（Pivot）= 買入觸發點
    #   → 最後一次收縮的高點（最緊縮區的高點）
    #   → 收盤突破此點 + 放量 = 有效買入訊號
    #
    base_high = 0.0;  base_high_date = ""
    pivot     = 0.0;  pivot_date     = ""

    if vcp_seq:
        # 基準點：整個序列的最高峰
        base_pb        = max(vcp_seq, key=lambda pb: pb["peak"])
        base_high      = round(base_pb["peak"], 2)
        base_high_date = _peak_date(base_pb)

        # 樞紐點：最後一次收縮的峰值
        last_pb    = vcp_seq[-1]
        pivot      = round(last_pb["peak"], 2)
        pivot_date = _peak_date(last_pb)
    else:
        # 無 VCP 序列時，以近期45日高點估算
        ph_start   = max(len(h) - 45, 0)
        ph_end     = max(len(h) - 5,  1)
        pivot_h    = h[ph_start:ph_end]
        pivot      = round(float(max(pivot_h)) if len(pivot_h) > 0 else cur_close, 2)
        base_high  = pivot

    dist_piv = round((pivot - cur_close) / pivot * 100, 1) if pivot > 0 else 0.0

    # ── 突破準備評分（10 分）──────────────────────────────────
    break_s = 0
    if 0 <= dist_piv <= 3:
        break_s += 5; details.append(f"距樞紐點 {dist_piv}%")
    elif 0 <= dist_piv <= 5:
        break_s += 3
    if atr_ratio < 0.70:
        break_s += 5; details.append(f"ATR收縮({atr_ratio})")
    elif atr_ratio < 0.80:
        break_s += 3; details.append(f"ATR收縮({atr_ratio})")
    s100 += min(break_s, 10)

    stop_loss = 0.0

    # ══ days_below_pivot ═══════════════════════════════════════
    recent_c         = c_arr[-20:] if len(c_arr) >= 20 else c_arr
    days_below_pivot = int(sum(1 for x in recent_c if float(x) < pivot))

    # ══ 買點狀態（以樞紐點為基準）════════════════════════════════
    today_close = float(c_arr[-1])
    vol_today   = float(v[-1])

    if today_close > pivot * 1.05:
        buy_status = "過度延伸"         # 突破樞紐點超過 5%，不追
    elif today_close >= pivot and vol50 > 0 and vol_today >= vol50 * 1.5:
        buy_status = "放量突破"         # 收盤≥樞紐點 + 量≥50日均×1.5
    elif today_close >= pivot:
        buy_status = "突破(量不足)"     # 收盤≥樞紐點但量不足
    elif 0 <= dist_piv <= 5 and num_cont >= 2:
        buy_status = "等待突破"         # 距樞紐點 0~5%
    elif num_cont >= 2:
        buy_status = "整理中"
    else:
        buy_status = "—"

    # ══ 5 分制標籤（向後兼容，後續 run_scan 會更新）════════════
    # 此時 s100 最高 60，等外層追加趨勢(25)+RS(15)後才是完整 100 分
    if s100 >= 50 and num_cont >= 2:
        score5 = 5
    elif s100 >= 38 and num_cont >= 2:
        score5 = 4
    elif s100 >= 25 and num_cont >= 2:
        score5 = 3
    elif s100 >= 15 and num_cont >= 1:
        score5 = 2
    else:
        score5 = 1 if (atr_ratio < 0.80 or vol5_ratio < 0.75) else 0

    label = ("VCP強" if score5 >= 4 else
             "VCP中" if score5 >= 3 else
             "VCP弱" if score5 >= 2 else "")

    return {
        "score":              score5,
        "score100":           s100,
        "label":              label,
        "pivot":              pivot,          # 樞紐點：最後收縮高點（買入觸發）
        "pivot_date":         pivot_date,     # 樞紐點日期
        "base_high":          base_high,      # 基準點：VCP 整理起始高點
        "base_high_date":     base_high_date, # 基準點日期
        "dist_pivot":         dist_piv,       # 距樞紐點 %
        "atr_ratio":          atr_ratio,
        "days_below_pivot":   days_below_pivot,
        "details":            details,
        "contractions":       num_cont,
        "contraction_depths": depths,
        "vol_contracting":    vol_contracting,
        "last_depth_pct":     last_depth,
        "stop_loss":          stop_loss,
        "buy_status":         buy_status,
        "base_days":          base_days,
        "higher_lows":        higher_lows,
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

    # ── 追加趨勢分 25 分到 vcp.score100 ─────────────────────────
    trend_score = (
        (5 if c > m50           else 0) +
        (5 if m50  > m150       else 0) +
        (5 if m150 > m200       else 0) +
        (5 if ma200_up          else 0) +
        (5 if c >= high52 * 0.85 else 0)   # 接近 52 週高點
    )
    vcp["score100"]    += trend_score
    vcp["trend_score"]  = trend_score

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
    vcp_score100     = vcp.get("score100", 0)
    days_below_pivot = vcp.get("days_below_pivot", 0)
    contractions     = vcp.get("contractions", 0)
    depths           = vcp.get("contraction_depths", [])
    vol_contracting  = vcp.get("vol_contracting", False)
    last_depth_pct   = vcp.get("last_depth_pct", 0.0)
    buy_status       = vcp.get("buy_status", "—")
    higher_lows      = vcp.get("higher_lows", False)
    base_days        = vcp.get("base_days", 0)

    # 組合 VCP 描述文字（用於 reason）
    vcp_desc = (f"VCP{vcp_score100}分，{contractions}次收縮({'>'.join(str(d)+'%' for d in depths)})"
                f"{'，量能遞減' if vol_contracting else ''}"
                f"{'，低點墊高' if higher_lows else ''}"
                if contractions >= 2
                else f"VCP{vcp_score100}分")

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

    # ── 1. 放量突破基準點（最高優先）────────────────────────
    if buy_status == "放量突破" and contractions >= 2 and rs >= 60:
        entry = pivot * 1.003
        return make(
            "buy_now", "🟢 放量突破，可進場", "high",
            f"放量突破基準點 {pivot}！{vcp_desc}，RS {rs:.0f}。"
            f"買入區間 {pivot}–{round(pivot*1.05,2)}，超過 +5% 不追。",
            setup=f"VCP放量突破({vcp_score100}分)",
            entry=entry,
        )

    # ── 2. Pocket Pivot ──────────────────────────────────
    if pp and contractions >= 2 and rs >= 65 and days_below_pivot >= 8:
        return make(
            "buy_now", "🚀 Pocket Pivot", "high",
            f"今日紅K量超過過去10日所有黑K最大量。{vcp_desc}，RS {rs:.0f}，"
            f"末段收縮 {last_depth_pct:.1f}%，整理{days_below_pivot}/20天。",
            setup=f"Pocket Pivot({vcp_score100}分)",
            entry=close,
        )

    # ── 3. 即將突破（距樞紐 0–3%）──────────────────────────
    if (pivot and dist_piv is not None and 0 <= dist_piv <= 3
            and vcp_score100 >= 55 and contractions >= 2 and rs >= 60 and days_below_pivot >= 8):
        entry = pivot * 1.003
        return make(
            "breakout", "🔔 即將突破，等放量", "high",
            f"距樞紐點 {pivot} 僅 {dist_piv}%，整理{days_below_pivot}/20天。"
            f"{vcp_desc}，RS {rs:.0f}，末段收縮 {last_depth_pct:.1f}%。"
            f"等放量（≥50日均量×1.5）突破後進場 ≤ {round(pivot*1.005,2)}。",
            setup=f"VCP等待突破({vcp_score100}分)",
            entry=entry,
        )

    # ── 4. 設置提醒（距樞紐 3–8%）──────────────────────────
    if (pivot and dist_piv is not None and 3 < dist_piv <= 8
            and vcp_score100 >= 45 and contractions >= 2 and rs >= 55):
        entry = pivot * 1.003
        return make(
            "set_alert", "⏰ 設置突破提醒", "medium",
            f"距樞紐點 {pivot} 約 {dist_piv}%，{vcp_desc}，RS {rs:.0f}。"
            f"設 {round(pivot*1.005,2)} 價格提醒，放量突破後進場。",
            setup=f"VCP({vcp_score100}分)",
            entry=entry,
        )

    # ── 5. 整理觀察（距樞紐 8–25%）──────────────────────────
    if pivot and dist_piv is not None and 8 < dist_piv <= 25 and contractions >= 2:
        return make(
            "watch", "👀 整理觀察", "low",
            f"VCP 整理中，距樞紐點 {dist_piv}%，{vcp_desc}，RS {rs:.0f}，距MA50 {from_ma50:.1f}%。",
            setup=f"VCP({vcp_score100}分)",
        )

    # ── 6. 已突破過遠（> 5%）─────────────────────────────
    if pivot and dist_piv is not None and dist_piv < -5:
        return make(
            "extended", "⚠️ 突破後勿追高", "low",
            f"已突破樞紐 {pivot}（超出進場窗口5%），距高 {from_high}%。等回測整理。",
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
    """單支股票 K 線（K線圖端點使用）"""
    try:
        df = yf.Ticker(f"{code}.TW").history(
            period="1y", interval="1d", auto_adjust=True
        )
        return df if not df.empty else None
    except Exception:
        return None


def _fetch_batch(codes: list) -> dict:
    """
    批量下載一組股票的一年日K（選股掃描使用）。
    yf.download() 一次請求取得多支，大幅減少 API 呼叫次數。
    回傳 {code: DataFrame}
    """
    import time, random
    if not codes:
        return {}
    tickers = [f"{c}.TW" for c in codes]
    for attempt in range(3):
        try:
            raw = yf.download(
                tickers=tickers,
                period="1y",
                interval="1d",
                auto_adjust=True,
                group_by="ticker",
                threads=True,
                progress=False,
            )
            result = {}
            if len(codes) == 1:
                # 單支時 yf.download 回傳扁平欄位
                if not raw.empty:
                    result[codes[0]] = raw
            else:
                for code, ticker in zip(codes, tickers):
                    try:
                        df = raw[ticker].dropna(how="all")
                        if not df.empty:
                            result[code] = df
                    except (KeyError, TypeError):
                        pass
            return result
        except Exception:
            if attempt < 2:
                time.sleep(3 + random.uniform(0, 2))
    return {}


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

    # ── 批量下載：50 支一批，一次 API → 約 38 次請求取代 1900 次 ──
    BATCH_SIZE = 50
    batches = [codes[i:i + BATCH_SIZE] for i in range(0, len(codes), BATCH_SIZE)]

    for batch_idx, batch in enumerate(batches):
        # 在 executor 中批量下載（blocking IO 不阻塞 event loop）
        batch_data = await loop.run_in_executor(executor, _fetch_batch, batch)
        # 分析每支股票（CPU bound，但量少可直接跑）
        for code in batch:
            df = batch_data.get(code)
            if df is not None and not df.empty:
                r = check_trend_template(df, code, pool[code])
                if r:
                    raw_results.append(r)
        scan_cache["progress"] = min((batch_idx + 1) * BATCH_SIZE, len(codes))
        await asyncio.sleep(0.5)   # 批次間短暫讓出（不是每支都等）

    # RS Rating: percentile rank across all results
    if raw_results:
        raws = np.array([r["rs_raw"] for r in raw_results])
        for r in raw_results:
            pct = float(np.sum(raws <= r["rs_raw"]) / len(raws) * 99)
            r["rs_rating"] = round(pct, 1)

        # ── 追加 RS 強勢分 15 分，更新 score100 + label ──────────
        for r in raw_results:
            rs  = r["rs_rating"]
            vcp = r.get("vcp", {})
            strength_score = 15 if rs >= 80 else (8 if rs >= 70 else 0)
            s100 = min(vcp.get("score100", 0) + strength_score, 100)
            vcp["score100"]       = s100
            vcp["strength_score"] = strength_score

            # 以完整 100 分重新決定 label / score（0-5）
            nc = vcp.get("contractions", 0)
            if s100 >= 85 and nc >= 2:
                vcp["score"] = 5; vcp["label"] = "VCP強"
            elif s100 >= 70 and nc >= 2:
                vcp["score"] = 4; vcp["label"] = "VCP中"
            elif s100 >= 55 and nc >= 2:
                vcp["score"] = 3; vcp["label"] = "VCP弱"
            elif s100 < 40 or nc < 2:
                vcp["score"] = min(vcp.get("score", 0), 1)
                vcp["label"] = ""
            r["vcp"] = vcp

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
        df = yf.Ticker("^TWII").history(
            period="1y", interval="1d", auto_adjust=True
        )
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

    # FTD 偵測（包 try/except 避免邊界 case 讓整個 API 掛掉）
    try:
        ftd = _detect_ftd(df)
    except Exception as e:
        print(f"[ftd] error: {e}")
        ftd = {"has_ftd": False, "status": "偵測失敗"}

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
        async with httpx.AsyncClient(timeout=8.0, headers=headers) as client:
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
        async with httpx.AsyncClient(timeout=8.0, headers=headers) as client:
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


async def _load_universe_bg():
    """背景非同步載入全台股清單，不阻塞 startup"""
    global STOCK_UNIVERSE, SCREENER_LIST
    try:
        universe = await _fetch_tw_stock_universe()
        if len(universe) >= 100:
            STOCK_UNIVERSE = universe
            SCREENER_LIST  = dict(universe)
            print(f"[universe] updated to {len(universe)} stocks")
        else:
            STOCK_UNIVERSE = dict(STOCK_LIST)
            print("[universe] fallback to built-in list")
    except Exception as e:
        print(f"[universe] load failed: {e}")


@app.on_event("startup")
async def startup_event():
    """startup 立刻回傳，股票清單在背景載入，不阻塞 HF health check"""
    asyncio.create_task(_load_universe_bg())


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


@app.get("/api/stocks/list")
async def stock_list_all():
    """回傳完整股票清單（前端本地搜尋用，只需呼叫一次）"""
    pool = STOCK_UNIVERSE if STOCK_UNIVERSE else STOCK_LIST
    return [{"symbol": k, "name": v} for k, v in pool.items()]


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

        cache_key = f"{symbol}:{interval}:{period}"
        now = datetime.now()
        is_intraday = interval not in ("1d", "1wk", "1mo")
        ttl = CACHE_TTL_INTRADAY if is_intraday else CACHE_TTL_DAILY
        if cache_key in _candle_cache:
            cached_at, cached_candles = _candle_cache[cache_key]
            if now - cached_at < ttl and cached_candles:
                return {"symbol": symbol, "name": STOCK_LIST.get(symbol, symbol),
                        "candles": cached_candles}

        loop = asyncio.get_event_loop()
        df = await loop.run_in_executor(
            executor,
            lambda: yf.Ticker(to_yf(symbol)).history(
                period=period, interval=interval, auto_adjust=True
            )
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

        _candle_cache[cache_key] = (now, candles)
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


# ══════════════════════════════════════════════════════════
#  回測 API
# ══════════════════════════════════════════════════════════
@app.get("/api/stocks/{symbol}/backtest")
async def run_backtest(
    symbol:     str,
    stop_pct:   float = 8.0,
    target_pct: float = 20.0,
    hold_days:  int   = 60,
    period:     str   = "3y",
    conditions: str   = "",   # 要求通過的條件編號（逗號分隔），空=不限
):
    """
    VCP 突破策略回測（逐日 walk-forward）
      買入：VCP 放量突破 + 選用 Trend Template 條件篩選
      停損/停利/時間停損：依參數設定
      conditions: "1,2,3,4,5,6,7,8" 各代表一個 Trend Template 條件
        1. 收盤 > MA150
        2. 收盤 > MA200
        3. MA150 > MA200
        4. MA200 向上（20日）
        5. MA50 > MA150 且 > MA200
        6. 收盤 > MA50
        7. 距52週低點 +30% 以上
        8. 距52週高點 75% 以內
    """
    loop = asyncio.get_event_loop()
    df_raw = await loop.run_in_executor(
        executor,
        lambda: yf.Ticker(to_yf(symbol)).history(period=period, interval="1d", auto_adjust=True)
    )
    if df_raw is None or df_raw.empty or len(df_raw) < 120:
        return {"error": "歷史資料不足（至少需要 120 個交易日）"}

    df_raw = df_raw.reset_index()
    date_col = "Date" if "Date" in df_raw.columns else "Datetime"
    dates  = [str(d)[:10] for d in df_raw[date_col]]
    closes = df_raw["Close"].values.astype(float)
    highs  = df_raw["High"].values.astype(float)
    lows   = df_raw["Low"].values.astype(float)
    vols   = df_raw["Volume"].values.astype(float)

    # ── 解析需要的條件編號 ───────────────────────────────────
    req_conds = set()
    for x in conditions.split(","):
        x = x.strip()
        if x.isdigit():
            req_conds.add(int(x))

    # ── 向量化預計算 MA / 52週高低（避免迴圈內重複計算）─────
    cs = pd.Series(closes)
    hs = pd.Series(highs)
    ls = pd.Series(lows)
    ma50_a   = cs.rolling(50,  min_periods=1).mean().values
    ma150_a  = cs.rolling(150, min_periods=1).mean().values
    ma200_a  = cs.rolling(200, min_periods=1).mean().values
    high52_a = hs.rolling(252, min_periods=1).max().values
    low52_a  = ls.rolling(252, min_periods=1).min().values

    def trend_ok(i: int) -> bool:
        """回傳此 bar 是否通過所有選定的 Trend Template 條件"""
        if not req_conds:
            return True
        c    = closes[i]
        m50  = ma50_a[i];  m150 = ma150_a[i];  m200 = ma200_a[i]
        h52  = high52_a[i]; l52  = low52_a[i]
        ma200_up = bool(i >= 20 and m200 > ma200_a[i - 20])
        cmap = {
            1: c    > m150,
            2: c    > m200,
            3: m150 > m200,
            4: ma200_up,
            5: m50  > m150 and m50 > m200,
            6: c    > m50,
            7: c    >= l52 * 1.30,
            8: c    >= h52 * 0.75,
        }
        return all(cmap.get(r, True) for r in req_conds)

    LOOKBACK = min(252, len(df_raw) // 3)

    # ── 在 executor 中跑逐日計算（blocking）──────────────────
    trades_out = []
    equity_out = []

    def _worker():
        equity      = 100.0
        in_trade    = False
        entry_price = 0.0
        entry_date  = ""
        entry_idx   = 0
        entry_pivot = 0.0

        for i in range(LOOKBACK, len(closes)):
            cur_close = float(closes[i])
            cur_vol   = float(vols[i])

            if in_trade:
                days_held    = i - entry_idx
                stop_price   = entry_price * (1 - stop_pct   / 100)
                target_price = entry_price * (1 + target_pct / 100)

                exit_reason = None
                exit_price  = cur_close
                if cur_close <= stop_price:
                    exit_reason = "停損"
                    exit_price  = stop_price
                elif cur_close >= target_price:
                    exit_reason = "停利"
                elif days_held >= hold_days:
                    exit_reason = "時間停損"

                if exit_reason:
                    pnl = (exit_price - entry_price) / entry_price * 100
                    equity *= (1 + pnl / 100)
                    trades_out.append({
                        "entry_date":  entry_date,
                        "exit_date":   dates[i],
                        "entry_price": round(entry_price, 2),
                        "exit_price":  round(exit_price,  2),
                        "pivot":       round(entry_pivot,  2),
                        "pnl_pct":     round(pnl, 2),
                        "exit_reason": exit_reason,
                        "days_held":   days_held,
                    })
                    in_trade = False

            else:
                # 每 3 天偵測一次（降低運算量）
                if i % 3 == 0 and trend_ok(i):
                    win_df = df_raw.iloc[max(0, i - LOOKBACK): i + 1]
                    vcp    = detect_vcp(win_df, cur_close, float(ma50_a[i]), float(high52_a[i]))
                    pivot  = vcp.get("pivot", 0)
                    vol50  = float(np.mean(vols[max(0, i - 50): i])) if i >= 50 else float(np.mean(vols[:i + 1]))

                    is_breakout = (
                        pivot > 0
                        and cur_close >= pivot
                        and cur_close <= pivot * 1.05
                        and cur_vol   >= vol50 * 1.5
                        and vcp.get("contractions", 0) >= 2
                    )
                    if is_breakout:
                        in_trade    = True
                        entry_price = cur_close
                        entry_date  = dates[i]
                        entry_idx   = i
                        entry_pivot = pivot

            equity_out.append({"date": dates[i], "value": round(equity, 2)})

        # 若回測結束時仍在倉，以最後收盤平倉
        if in_trade:
            last = float(closes[-1])
            pnl  = (last - entry_price) / entry_price * 100
            equity *= (1 + pnl / 100)
            trades_out.append({
                "entry_date":  entry_date,
                "exit_date":   dates[-1],
                "entry_price": round(entry_price, 2),
                "exit_price":  round(last, 2),
                "pivot":       round(entry_pivot, 2),
                "pnl_pct":     round(pnl, 2),
                "exit_reason": "持倉中",
                "days_held":   len(closes) - 1 - entry_idx,
            })
        return equity

    final_equity = await loop.run_in_executor(executor, _worker)

    # ── 統計 ──────────────────────────────────────────────
    total = len(trades_out)
    if total > 0:
        wins  = [t for t in trades_out if t["pnl_pct"] > 0]
        loses = [t for t in trades_out if t["pnl_pct"] <= 0]
        avg_win  = sum(t["pnl_pct"] for t in wins)  / max(len(wins),  1)
        avg_loss = sum(t["pnl_pct"] for t in loses) / max(len(loses), 1)
        gross_p  = sum(t["pnl_pct"] for t in wins)
        gross_l  = abs(sum(t["pnl_pct"] for t in loses))
        pf       = round(gross_p / gross_l, 2) if gross_l > 0 else 99.0
        peak, max_dd = 100.0, 0.0
        for pt in equity_out:
            if pt["value"] > peak:
                peak = pt["value"]
            dd = (peak - pt["value"]) / peak * 100
            if dd > max_dd:
                max_dd = dd
    else:
        avg_win = avg_loss = pf = max_dd = 0.0

    stats = {
        "total_trades":  total,
        "win_count":     len([t for t in trades_out if t["pnl_pct"] > 0]),
        "loss_count":    len([t for t in trades_out if t["pnl_pct"] <= 0]),
        "win_rate":      round(len([t for t in trades_out if t["pnl_pct"] > 0]) / total * 100, 1) if total else 0,
        "avg_gain":      round(avg_win,  2),
        "avg_loss":      round(avg_loss, 2),
        "total_return":  round(final_equity - 100, 2),
        "max_drawdown":  round(-max_dd, 2),
        "profit_factor": pf,
    }

    return {"symbol": symbol, "trades": trades_out, "stats": stats, "equity_curve": equity_out}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=True)
