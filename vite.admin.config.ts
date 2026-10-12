import { fileURLToPath, URL } from 'node:url'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

const projectRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, projectRoot, '')
  return {
    root: fileURLToPath(new URL('./apps/admin', import.meta.url)),
    envDir: projectRoot,
    base: env.VITE_ADMIN_BASE_PATH || '/admin/',
    publicDir: false,
    plugins: [react()],
    build: {
      outDir: fileURLToPath(new URL('./dist/admin', import.meta.url)),
      emptyOutDir: true,
    },
    server: {
      host: '127.0.0.1',
      port: 4174,
      fs: { allow: [projectRoot] },
      watch: { ignored: ['**/.edge-*/*', '**/.edge-*/**'] },
      proxy: { '/api': 'http://127.0.0.1:8787' },
    },
  }
})
