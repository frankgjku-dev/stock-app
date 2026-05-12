from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
import asyncio
import httpx
import yfinance as yf
import pandas as pd
import pytz

app = FastAPI(title="台股分析平台")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

TAIWAN_TZ = pytz.timezone("Asia/Taipei")

STOCK_LIST = {
    "0050": "元大台灣50",
    "0056": "元大高股息",
    "2330": "台積電",
    "2317": "鴻海",
    "2454": "聯發科",
    "2382": "廣達",
    "2308": "台達電",
    "2881": "富邦金",
    "2882": "國泰金",
    "2886": "兆豐金",
    "2884": "玉山金",
    "2891": "中信金",
    "2885": "元大金",
    "2883": "開發金",
    "2880": "華南金",
    "2887": "台新金",
    "2892": "第一金",
    "5880": "合庫金",
    "1301": "台塑",
    "1303": "南亞",
    "1326": "台化",
    "6505": "台塑化",
    "2002": "中鋼",
    "2412": "中華電",
    "4904": "遠傳",
    "3008": "大立光",
    "2303": "聯電",
    "2357": "華碩",
    "2395": "研華",
    "1216": "統一",
    "2912": "統一超",
    "9910": "豐泰",
    "3711": "日月光投控",
    "2379": "瑞昱",
    "2408": "南亞科",
    "2345": "智邦",
    "6669": "緯穎",
    "3034": "聯詠",
    "4938": "和碩",
    "2377": "微星",
}


def to_yf(symbol: str) -> str:
    return f"{symbol}.TW"


@app.get("/")
async def root():
    return {"message": "台股分析平台 API v1.0"}


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
        # intraday period limits
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

            candles.append({
                "time": time_val,
                "open": round(o, 2),
                "high": round(h, 2),
                "low": round(l, 2),
                "close": round(c, 2),
                "volume": v,
            })

        return {"symbol": symbol, "name": STOCK_LIST.get(symbol, symbol), "candles": candles}

    except Exception as e:
        return {"symbol": symbol, "candles": [], "error": str(e)}


@app.get("/api/stocks/{symbol}/quote")
async def get_quote(symbol: str):
    # Try TWSE real-time first (try TSE then OTC)
    for market in ("tse", "otc"):
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                url = (
                    f"https://mis.twse.com.tw/stock/api/getStockInfo.jsp"
                    f"?ex_ch={market}_{symbol}.tw&json=1&delay=0"
                )
                resp = await client.get(url)
                data = resp.json()
                arr = data.get("msgArray", [])
                if arr:
                    item = arr[0]
                    z = item.get("z", "-")
                    y = item.get("y", "0") or "0"
                    prev = float(y)
                    price = float(z) if z and z != "-" else prev
                    return {
                        "symbol": symbol,
                        "name": item.get("n", STOCK_LIST.get(symbol, symbol)),
                        "price": price,
                        "prev_close": prev,
                        "open": float(item.get("o", 0) or 0),
                        "high": float(item.get("h", 0) or 0),
                        "low": float(item.get("l", 0) or 0),
                        "volume": int(float(item.get("v", 0) or 0)),
                        "change": round(price - prev, 2),
                        "change_pct": round((price - prev) / prev * 100, 2) if prev else 0,
                    }
        except Exception:
            continue

    # Fallback: yfinance fast_info
    try:
        fi = yf.Ticker(to_yf(symbol)).fast_info
        price = round(float(fi.last_price), 2)
        prev = round(float(fi.previous_close), 2)
        return {
            "symbol": symbol,
            "name": STOCK_LIST.get(symbol, symbol),
            "price": price,
            "prev_close": prev,
            "open": round(float(fi.open), 2),
            "high": round(float(fi.day_high), 2),
            "low": round(float(fi.day_low), 2),
            "volume": 0,
            "change": round(price - prev, 2),
            "change_pct": round((price - prev) / prev * 100, 2) if prev else 0,
        }
    except Exception as e:
        return {"symbol": symbol, "error": str(e), "price": 0, "change": 0, "change_pct": 0}


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
