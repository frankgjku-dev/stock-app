// 優先使用環境變數 VITE_API_HOST
// 未設定時預設使用 HuggingFace 後端
const host = import.meta.env.VITE_API_HOST || 'frankgjku-twstock-api.hf.space'
export const API_BASE = `https://${host}`
console.log('[API] 後端位址:', API_BASE)

// ── 版本號（每次功能更新時遞增）──
export const APP_VERSION = 'v3.5'
