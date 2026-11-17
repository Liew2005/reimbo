import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev: run `npm run dev:api` (wrangler, :8787) and `npm run dev:web` (vite, :5173).
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:8787' },
  },
})
