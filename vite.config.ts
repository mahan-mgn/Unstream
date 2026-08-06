import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: {
      // بک‌اند FastAPI روی 8000 بالا میاد؛ فرانت با /api صداش می‌زنه
      '/api': { target: 'http://127.0.0.1:8000', changeOrigin: true },
    },
  },
})
