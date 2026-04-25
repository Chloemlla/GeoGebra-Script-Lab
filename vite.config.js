import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const normalizeBase = (rawBase) => {
  if (!rawBase || rawBase === '/') {
    return '/'
  }

  const withLeadingSlash = rawBase.startsWith('/') ? rawBase : `/${rawBase}`
  return withLeadingSlash.endsWith('/') ? withLeadingSlash : `${withLeadingSlash}/`
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const proxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:3001'
  const useLocalProxy = !env.VITE_API_BASE_URL

  return {
    base: normalizeBase(env.VITE_BASE_PATH),
    plugins: [react()],
    server: {
      port: 5173,
      open: true,
      proxy: useLocalProxy ? {
        '/health': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/api': {
          target: proxyTarget,
          changeOrigin: true,
        },
        '/assets': {
          target: proxyTarget,
          changeOrigin: true,
        },
      } : undefined,
    },
    build: {
      target: 'esnext',
      minify: 'terser',
      assetsDir: '_assets',
    },
  }
})
