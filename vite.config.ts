import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { readFileSync } from 'node:fs'
import { fileURLToPath, URL } from 'node:url'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version)
  },
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
