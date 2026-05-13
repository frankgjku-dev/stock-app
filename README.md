---
title: Twstock Api
emoji: 📈
colorFrom: blue
colorTo: green
sdk: docker
app_port: 7860
pinned: false
---

# 台股分析平台

TradingView 風格的台股 K 線分析工具。

## 功能
- K 線圖（日/週/月/分鐘）
- MA 均線：MA5、MA10、MA20、MA60、MA120、MA240（可點擊開關）
- 成交量柱狀圖
- 畫線工具：趨勢線、水平線、垂直線、矩形、斐波那契回調
- 台股即時報價（TWSE API，盤中每 5 秒刷新）
- 股票搜尋（支援代碼/名稱）

## 快速啟動

### 1. 後端
```bash
cd backend
pip install -r requirements.txt
python main.py
# 後端運行於 http://localhost:8000
```

### 2. 前端
```bash
cd frontend
npm install
npm run dev
# 前端運行於 http://localhost:5173
```

## 畫線操作
| 工具 | 操作 |
|------|------|
| 趨勢線 | 點第一點 → 點第二點（自動延伸） |
| 水平線 | 單擊一點即完成 |
| 垂直線 | 單擊一點即完成 |
| 矩形 | 點第一角 → 點對角 |
| 斐波那契 | 點高點 → 點低點 |
| 右鍵 | 取消繪製中 / 刪除最後一條線 |

## 台股顏色慣例
- 🔴 紅色 = 漲
- 🟢 綠色 = 跌
