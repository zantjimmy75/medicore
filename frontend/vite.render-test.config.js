import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Builds the whole SPA as a single IIFE bundle so it can be executed inside
// jsdom (which cannot run <script type="module">). Used only by
// tests/render-smoke.test.mjs — never for deployment.
export default defineConfig({
  plugins: [react()],
  // lib-mode builds do not get Vite's usual env replacement automatically.
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env': '{}',
  },
  build: {
    outDir: 'dist-render-test',
    emptyOutDir: true,
    minify: false,
    lib: {
      entry: 'src/main.jsx',
      formats: ['iife'],
      name: 'MediCoreApp',
      fileName: () => 'app.js',
    },
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
})
