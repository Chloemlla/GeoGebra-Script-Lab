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

  return {
    base: normalizeBase(env.VITE_BASE_PATH),
    plugins: [react()],
    server: {
      port: 5173,
      open: true,
    },
    build: {
      target: 'esnext',
      minify: 'terser',
    },
  }
})
