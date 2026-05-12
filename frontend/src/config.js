// 本地開發：VITE_API_HOST 未設定 → 使用 Vite proxy（相對路徑）
// Render 部署：VITE_API_HOST 由 render.yaml fromService 自動注入
const host = import.meta.env.VITE_API_HOST || ''
export const API_BASE = host ? `https://${host}` : ''
