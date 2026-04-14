import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        timeout: 200000,
        proxyTimeout: 200000,
      }
    },
    warmup: {
      clientFiles: ['./src/main.jsx', './src/App.jsx'],
    },
    watch: {
      ignored: ['**/node_modules/**', '**/dist/**', '**/*.py', '**/data/**'],
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'react-router-dom', 'lucide-react'],
  },
})
