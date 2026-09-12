import { defineConfig } from 'vite'

// Production-preview fixture for the isolated browser reliability test. It
// serves the already-built SPA without Vite's filesystem watcher and proxies
// API/SSE traffic to the disposable dual-instance gateway.
export default defineConfig({
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: ['live-test-frontend'],
    proxy: { '/api': { target: 'http://gateway:8060', changeOrigin: true } },
  },
})
