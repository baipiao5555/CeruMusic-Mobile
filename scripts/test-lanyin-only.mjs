import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright-core'

const root = path.resolve(import.meta.dirname, '..')
const base = process.env.CERU_TEST_URL || 'http://127.0.0.1:5199'
const checks = []
const errors = []

function check(name, condition, detail = '') {
  if (!condition) throw new Error(name + (detail ? ': ' + detail : ''))
  checks.push(name)
}

async function missing(relative) {
  try {
    await access(path.join(root, relative))
    return false
  } catch {
    return true
  }
}

const removed = [
  'src/components/PlatformLoginSheet.vue',
  'src/components/PlatformPlaylistSheet.vue',
  'src/core/platformAccounts.ts',
  'src/core/platformPlaylists.ts',
  'src/core/native/platformLogin.ts',
  'android/app/src/main/java/com/ceru/music/mobile/PlatformLoginPlugin.java',
  'android/app/src/main/res/layout/platform_login.xml',
  'android/app/src/main/res/raw/platform_auth_mobile.css',
  'android/app/src/main/res/raw/platform_portal_login.js'
]
for (const file of removed) check('removed ' + file, await missing(file))

const mainActivity = await readFile(path.join(root, 'android/app/src/main/java/com/ceru/music/mobile/MainActivity.java'), 'utf8')
const app = await readFile(path.join(root, 'src/App.vue'), 'utf8')
const settings = await readFile(path.join(root, 'src/views/Settings.vue'), 'utf8')
const library = await readFile(path.join(root, 'src/views/Library.vue'), 'utf8')
const main = await readFile(path.join(root, 'src/main.ts'), 'utf8')
check('native platform login plugin is unregistered', !mainActivity.includes('PlatformLoginPlugin'))
check('platform login sheet is not mounted', !app.includes('PlatformLoginSheet') && !app.includes('platformLoginVisible'))
check('platform login setting is gone', !settings.includes('音乐平台登录') && !settings.includes('platformLoginVisible'))
check('library profile opens Lanyin account', library.includes("router.push('/cloud')") && !library.includes('platformLoginVisible'))
check('legacy platform cookies are cleaned once', main.includes('cleanupLegacyPlatformSessions'))

const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
page.on('pageerror', error => errors.push(error.message))
try {
  await page.route('**/*', route => {
    const url = new URL(route.request().url())
    return ['127.0.0.1', 'localhost'].includes(url.hostname) ? route.continue() : route.abort()
  })
  await page.addInitScript(() => {
    if (window.top !== window) return
    localStorage.clear()
    localStorage.setItem('ceru.update.v1', JSON.stringify({ autoCheck: false }))
  })

  await page.goto(base + '/#/library', { waitUntil: 'networkidle' })
  const profile = page.getByRole('button', { name: '登录澜音账号与云端歌单', exact: true })
  await profile.waitFor()
  check('library exposes only the Lanyin account entry', await page.getByText('音乐平台登录', { exact: true }).count() === 0)
  await profile.click()
  await page.waitForURL(/#\/cloud$/)
  check('library entry opens the Lanyin cloud page', page.url().endsWith('#/cloud'))
  check('cloud page offers Lanyin login', await page.getByText('登录澜音账号', { exact: true }).count() === 1)

  await page.goto(base + '/#/settings', { waitUntil: 'networkidle' })
  await page.getByText('澜音云歌单账号', { exact: true }).waitFor()
  check('settings account section is Lanyin-only', await page.getByText('音乐平台登录', { exact: true }).count() === 0)

  await page.goto(base + '/#/accounts', { waitUntil: 'networkidle' })
  await page.waitForURL(/#\/cloud$/)
  check('legacy accounts route redirects to Lanyin cloud', page.url().endsWith('#/cloud'))
  check('no platform login text remains in the rendered app', await page.getByText('登录音乐平台', { exact: true }).count() === 0)
  check('no browser page errors', errors.length === 0, errors.join('; '))
} finally {
  await browser.close()
}

console.log(JSON.stringify({ checks: checks.length, pass: true }))
