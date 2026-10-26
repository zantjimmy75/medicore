import { writeFileSync } from 'node:fs'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// A build stamp lets an already-open tab notice that the server is serving a
// newer bundle and reload itself instead of running stale code. This is what
// turned "blank page / expired session" reports into false alarms while the
// app itself was fine.
const BUILD_ID = process.env.BUILD_ID || new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)

function buildStampPlugin() {
  return {
    name: 'medicore-build-stamp',
    apply: 'build',
    closeBundle() {
      try {
        writeFileSync('dist/version.json', JSON.stringify({ build: BUILD_ID }, null, 2))
      } catch {
        /* non-fatal */
      }
    },
  }
}

// The API is proxied so the browser only ever talks to one origin. This keeps
// cookies/CSRF out of the picture and lets the app run behind the sandbox
// preview proxy without CORS surprises.
const proxy = {
  '/api': {
    target: process.env.VITE_API_TARGET || 'http://127.0.0.1:8000',
    changeOrigin: true,
    secure: false,
  },
}

export default defineConfig({
  plugins: [react(), buildStampPlugin()],

  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },

  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy,
    // Dev mode serves every source file as its own request (≈80 round trips on
    // first paint). Pre-bundling the heavy libraries and warming the entry
    // graph keeps a cold start usable when the browser is far away from the
    // dev server (e.g. through a preview proxy).
    warmup: {
      clientFiles: ['./src/main.jsx', './src/App.jsx', './src/pages/Dashboard.jsx'],
    },
  },

  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'react-dom/client',
      'react-router-dom',
      'axios',
      'clsx',
      'lucide-react',
      'recharts',
      'jsqr',
    ],
  },

  // `vite preview` serves the production build on the same port with the same
  // /api proxy. This is what the hosted preview runs: a handful of hashed
  // assets instead of a module graph, so the app mounts immediately.
  preview: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: true,
    proxy,
  },

  build: {
    outDir: 'dist',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
})
