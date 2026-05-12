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

# ── 篩選用的股票池（可展開）────────────────────────────────
SCREENER_LIST = {k: v for k, v in STOCK_LIST.items() if k not in ("0050", "0056")}

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
#  Trend Template 計算
# ══════════════════════════════════════════════════════════
# ══════════════════════════════════════════════════════════
#  VCP 偵測（Volatility Contraction Pattern）
# ══════════════════════════════════════════════════════════
def detect_vcp(df: pd.DataFrame, cur_close: float, ma50: float, high52: float) -> dict:
    """
    VCP 量化評分（0–5 分）
    5 項指標各 1 分，>= 4 為強、3 為中、2 為弱
    """
    empty = {"score": 0, "label": "", "pivot": 0.0, "dist_pivot": 0.0,
             "atr_ratio": None, "details": []}
    if len(df) < 60:
        return empty

    h = df["High"].values.astype(float)
    l = df["Low"].values.astype(float)
    v = df["Volume"].values.astype(float)

    score   = 0
    details = []

    # 1. 高位整理：股價在 MA50 以上且距52週高點 < 25%
    near_high = cur_close >= ma50 and cur_close >= high52 * 0.75
    if near_high:
        score += 1
        details.append("高位整理")

    # 2. 波動收縮：ATR(20) / ATR(60) < 0.80
    atr20 = float(np.mean(h[-20:] - l[-20:])) if len(h) >= 20 else 0.0
    atr60 = float(np.mean(h[-60:] - l[-60:])) if len(h) >= 60 else atr20
    atr_ratio = round(atr20 / atr60, 2) if atr60 > 0 else 1.0
    if atr60 > 0 and atr_ratio < 0.80:
        score += 1
        details.append(f"波動收縮 ({atr_ratio})")

    # 3. 量能萎縮：近20日均量 < 近50日均量 × 0.75
    vol20 = float(np.mean(v[-20:])) if len(v) >= 20 else 0.0
    vol50 = float(np.mean(v[-50:])) if len(v) >= 50 else vol20
    if vol50 > 0 and vol20 / vol50 < 0.75:
        score += 1
        details.append("量能萎縮")

    # 4. 近10日緊密整理：(最高 - 最低) / 收盤 < 8%
    if len(h) >= 10:
        tight = (float(max(h[-10:])) - float(min(l[-10:]))) / cur_close
        if tight < 0.08:
            score += 1
            details.append(f"緊密整理 ({tight*100:.1f}%)")

    # 5. 合理回檔深度：近30日高低差 3%–15%（有收縮空間但未崩跌）
    if len(h) >= 30:
        pb = (float(max(h[-30:])) - float(min(l[-30:]))) / float(max(h[-30:]))
        if 0.03 < pb < 0.15:
            score += 1
            details.append(f"健康回檔 ({pb*100:.1f}%)")

    # Pivot Point = 近20日最高點
    pivot     = round(float(max(h[-20:])) if len(h) >= 20 else cur_close, 2)
    dist_piv  = round((pivot - cur_close) / pivot * 100, 1)
    label     = ("VCP強" if score >= 4 else
                 "VCP中" if score >= 3 else
                 "VCP弱" if score >= 2 else "")

    return {
        "score":      score,
        "label":      label,
        "pivot":      pivot,
        "dist_pivot": dist_piv,   # 正數=距突破點%，負數=已突破
        "atr_ratio":  atr_ratio,
        "details":    details,
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
    from_high  = r.get("from_high", -100)

    pivot      = vcp.get("pivot")
    dist_piv   = vcp.get("dist_pivot")   # 正=距突破點%, 負=已突破
    vcp_score  = vcp.get("score", 0)

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

    # ── 1. Pocket Pivot（最高優先） ──────────────────────
    if pp and vcp_score >= 2 and rs >= 65:
        stop   = close * 0.925
        tgt    = close + (close - stop) * 2.5
        return make(
            "buy_now", "🚀 可考慮進場", "high",
            f"Pocket Pivot 訊號！量能突破過去 10 日黑K最大量，VCP {vcp_score}/5，RS {rs:.0f}。"
            f"建議進場價 {close}，停損 {round(stop,2)}（{round((close-stop)/close*100,1)}%），"
            f"目標 {round(tgt,2)}（損益比 2.5:1）",
            setup=f"Pocket Pivot + VCP{vcp_score}",
            entry=close, stop=stop, target=tgt, rr=2.5,
        )

    # ── 2. 已突破樞紐點（-5% 以內）──────────────────────
    if pivot and dist_piv is not None and dist_piv < 0 and dist_piv >= -5:
        entry = pivot * 1.003
        stop  = pivot * 0.925
        tgt   = entry + (entry - stop) * 2.5
        return make(
            "buy_now", "🟢 剛突破進場", "high",
            f"剛突破樞紐點 {pivot}（距高 {from_high}%），量能確認後可進場。"
            f"建議進場 ≤ {round(entry,2)}，停損 {round(stop,2)}（{round((entry-stop)/entry*100,1)}%），"
            f"目標 {round(tgt,2)}。",
            setup=f"VCP突破 ({vcp_score}/5)",
            entry=entry, stop=stop, target=tgt, rr=2.5,
        )

    # ── 3. 距樞紐點 0–2%（即將突破）──────────────────────
    if pivot and dist_piv is not None and 0 <= dist_piv <= 2:
        entry = pivot * 1.003
        stop  = pivot * 0.925
        tgt   = entry + (entry - stop) * 2.5
        return make(
            "breakout", "🔔 即將突破", "high",
            f"距樞紐點 {pivot} 僅 {dist_piv}%，突破後量能確認即可進場。"
            f"建議掛單 {round(entry,2)}，停損設 {round(stop,2)}（{round((entry-stop)/entry*100,1)}%），"
            f"目標 {round(tgt,2)}（損益比 2.5:1）。",
            setup=f"VCP ({vcp_score}/5)",
            entry=entry, stop=stop, target=tgt, rr=2.5,
        )

    # ── 4. 距樞紐點 2–6%（設置提醒）──────────────────────
    if pivot and dist_piv is not None and 2 < dist_piv <= 6:
        entry = pivot * 1.003
        stop  = pivot * 0.925
        tgt   = entry + (entry - stop) * 2.5
        return make(
            "set_alert", "⏰ 設置突破提醒", "medium",
            f"距樞紐點 {pivot} 約 {dist_piv}%，整理接近尾聲。"
            f"建議設 {round(entry,2)} 價格提醒，突破放量後進場，"
            f"停損 {round(stop,2)}，目標 {round(tgt,2)}（2.5:1）。",
            setup=f"VCP ({vcp_score}/5)",
            entry=entry, stop=stop, target=tgt, rr=2.5,
        )

    # ── 5. 距樞紐點 6–20%（整理觀察）─────────────────────
    if pivot and dist_piv is not None and 6 < dist_piv <= 20:
        entry = pivot * 1.003
        stop  = pivot * 0.925
        tgt   = entry + (entry - stop) * 2.5
        return make(
            "watch", "👀 整理觀察", "low",
            f"VCP 整理中，距樞紐點 {dist_piv}%，尚未到進場時機。"
            f"耐心等待波動收縮完成，目標進場點 {round(entry,2)}。",
            setup=f"VCP ({vcp_score}/5)",
            entry=entry, stop=stop, target=tgt, rr=2.5,
        )

    # ── 6. 已超漲（突破超過 5%）──────────────────────────
    if pivot and dist_piv is not None and dist_piv < -5:
        ma20_proxy = close * 0.93   # 粗估回測支撐
        return make(
            "extended", "⚠️ 已突破勿追高", "low",
            f"已突破樞紐點 {pivot}（距高 {from_high}%），股價可能延伸過大。"
            f"等待回測 MA20 / 10週線附近（約 {round(ma20_proxy,2)}）再評估。",
            setup="突破後延伸",
        )

    # ── 7. Trend Template 良好但無 VCP ─────────────────
    if passed >= 7 and rs >= 75:
        return make(
            "watch", "📊 趨勢佳，等整理", "low",
            f"Trend Template {passed}/8，RS {rs:.0f}，Stage 2 上升趨勢確認。"
            f"尚未形成 VCP 整理型態，耐心等待量縮整理後再找進場點。",
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
    codes = list(SCREENER_LIST.keys())
    scan_cache.update({"status": "running", "results": [], "progress": 0,
                       "total": len(codes), "error": None})

    loop = asyncio.get_event_loop()
    raw_results = []

    # fetch & analyse in groups of 6
    sem = asyncio.Semaphore(6)

    async def process(code):
        async with sem:
            df = await loop.run_in_executor(executor, _fetch_df, code)
            if df is None:
                return None
            return check_trend_template(df, code, SCREENER_LIST[code])

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
    vol  = df["Volume"].dropna()
    dist = 0
    recent = df.tail(25)
    for i in range(1, len(recent)):
        row  = recent.iloc[i]
        prev = recent.iloc[i - 1]
        if row["Close"] < prev["Close"] and row["Volume"] > prev["Volume"]:
            dist += 1

    trend = "多頭" if c > m50 > 0 and c > m200 else ("震盪" if c > m200 else "空頭")
    return {
        "index": round(c, 2),
        "ma50":  round(m50, 2),
        "ma200": round(m200, 2),
        "above_ma50":  c > m50,
        "above_ma200": c > m200,
        "distribution_days": dist,
        "trend": trend,
        "suggestion": "滿倉" if trend == "多頭" and dist < 4 else
                      ("半倉" if dist < 6 else "空倉/觀望"),
    }


# ══════════════════════════════════════════════════════════
#  API 路由
# ══════════════════════════════════════════════════════════
def to_yf(symbol: str) -> str:
    return f"{symbol}.TW"


@app.get("/")
async def root():
    return {"message": "台股分析平台 API v2.0"}


@app.get("/api/stocks/search")
async def search_stocks(q: str = ""):
    q = q.strip()
    if not q:
        return [{"symbol": k, "name": v} for k, v in list(STOCK_LIST.items())[:20]]
    q_lower = q.lower()
    return [
        {"symbol": code, "name": name}
        for code, name in STOCK_LIST.items()
        if q_lower in code or q_lower in name
    ][:20]


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
