import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { execSync } from 'node:child_process'

function readGitBranch() {
  try {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim() || 'unknown'
  } catch {
    return 'unknown'
  }
}

function readAppVersion() {
  try {
    const packageJson = JSON.parse(execSync('node -p "JSON.stringify(require(\'./package.json\'))"', { encoding: 'utf8' }))
    return packageJson.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const appVersion = readAppVersion()
const gitBranch = readGitBranch()

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __GIT_BRANCH__: JSON.stringify(gitBranch),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        timeout: 200000,
        proxyTimeout: 200000,
      },
      '/graphrag-api': {
        target: 'http://localhost:8002',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/graphrag-api/, ''),
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
