import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const BACKEND = 'https://frankgjku-twstock-api.hf.space'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': { target: BACKEND, changeOrigin: true },
      '/ws':  { target: BACKEND.replace('https','wss'), ws: true, changeOrigin: true },
    },
  },
})
