import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const source = path.join(root, 'node_modules', '@shiqianjiang', 'ceru-plugin-core', 'assets')
const destination = path.join(root, 'public', 'plugin-runtime')
const files = ['sandbox.js', 'node-globals.js', 'catalog.json']

if (!fs.existsSync(source)) {
  console.error('未找到 @shiqianjiang/ceru-plugin-core，请先运行 npm install')
  process.exit(1)
}

fs.mkdirSync(destination, { recursive: true })
for (const file of files) {
  fs.copyFileSync(path.join(source, file), path.join(destination, file))
  console.log('plugin runtime:', file)
}
