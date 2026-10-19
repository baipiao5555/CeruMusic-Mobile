import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      'node:crypto': fileURLToPath(new URL('./src/shims/crypto.ts', import.meta.url)),
      'node:stream/promises': fileURLToPath(new URL('./src/shims/node-stream.ts', import.meta.url)),
      'node:stream': fileURLToPath(new URL('./src/shims/node-stream.ts', import.meta.url))
    }
  },
  optimizeDeps: {
    include: [
      '@shiqianjiang/ceru-plugin-core',
      '@shiqianjiang/ceru-plugin-sdk',
      'ajv',
      'acorn'
    ]
  },
  build: {
    target: 'es2020',
    minify: 'esbuild',
    chunkSizeWarningLimit: 2000
  },
  server: {
    port: 5180
  }
})
