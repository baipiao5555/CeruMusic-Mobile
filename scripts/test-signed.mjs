import fs from 'node:fs'
import { chromium } from 'playwright-core'
import { generateSigningKeys, signArtifact } from '@shiqianjiang/ceru-plugin-issuer'

const keys = generateSigningKeys()
const signed = signArtifact(fs.readFileSync('public/demo-plugin.js'), keys.privateKey).toString('utf8')
console.log('signed length:', signed.length)

const browser = await chromium.launch({
  executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true
})
const page = await browser.newPage()
page.on('console', (message) => console.log('[' + message.type() + ']', message.text().slice(0, 300)))
page.on('pageerror', (error) => console.log('[pageerror]', error.message))
await page.goto(process.env.CERU_URL || 'http://127.0.0.1:5181/', { waitUntil: 'networkidle' })
await page.waitForTimeout(4000)
const out = await page.evaluate(async (source) => {
  const debug = window.__ceruDebug
  try {
    const descriptor = await debug.installPlugin(source, { enable: true, grantDeclared: true })
    const providers = debug.allProviders()
    const search = await debug.invokeProvider(providers[0], 'tracks.search', [
      { query: 'city', kinds: ['track'], filters: {}, limit: 10 }
    ])
    return {
      ok: true,
      name: descriptor.name,
      version: descriptor.version,
      rows: search.items.length,
      running: descriptor.running
    }
  } catch (error) {
    return {
      ok: false,
      error: String((error && error.message) || error),
      stack: error && error.stack
    }
  }
}, signed)
console.log(JSON.stringify(out, null, 2))
await browser.close()
