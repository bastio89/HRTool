import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
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

function readGitBuildVersion() {
  const injectedVersion = process.env.FRONTEND_APP_VERSION?.trim()
  if (injectedVersion) {
    return injectedVersion
  }

  try {
    const branch = readGitBranch().replace(/[^a-zA-Z0-9._-]+/g, '-')
    const runNumber = execSync('git rev-list --count HEAD', { encoding: 'utf8' }).trim()
    if (branch && runNumber) {
      return `${branch}-${runNumber}`
    }
  } catch {
  }

  try {
    return execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim() || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

const appVersion = readGitBuildVersion()

export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    // tests/e2e holds Playwright specs. Vitest picks them up by default and
    // fails on Playwright's test() - run them with `npm run test:e2e` instead.
    exclude: [...configDefaults.exclude, 'tests/e2e/**'],
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
