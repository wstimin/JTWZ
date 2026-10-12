import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  root: fileURLToPath(new URL('./apps/public', import.meta.url)),
  envDir: projectRoot,
  publicDir: false,
  plugins: [react()],
  build: {
    outDir: fileURLToPath(new URL('./dist/public', import.meta.url)),
    emptyOutDir: true,
  },
  server: {
    host: '127.0.0.1',
    port: 4173,
    fs: { allow: [projectRoot] },
    watch: { ignored: ['**/.edge-*/*', '**/.edge-*/**'] },
    proxy: { '/api': 'http://127.0.0.1:8787' },
  },
})
