import assert from 'node:assert/strict'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { build } from 'esbuild'

const root = path.resolve(import.meta.dirname, '..')
const checks = []

function check(name, condition, detail = '') {
  if (!condition) throw new Error(name + (detail ? ': ' + detail : ''))
  checks.push(name)
}

async function loadAutoSync() {
  const stubs = {
    '@capacitor/core': 'export const Capacitor = { isNativePlatform: () => false, getPlatform: () => "web" }\n',
    '../logs': 'export const logEvent = () => {}\n',
    '../native/syncKeepAlive': 'export const supportsSyncKeepAlive = () => false\nexport const syncKeepAliveStatus = async () => false\nexport const setSyncKeepAlive = async () => {}\n',
    './webdav': 'export const listConnections = () => []\nexport const getSyncStatus = () => ({})\nexport const syncNow = async () => ({ summary: "" })\n'
  }
  const result = await build({
    entryPoints: [path.join(root, 'src/core/sync/autoSync.ts')],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    logLevel: 'silent',
    plugins: [{
      name: 'ceru-auto-sync-test-stubs',
      setup(builder) {
        builder.onResolve({ filter: /^(\.\.\/logs|\.\.\/native\/syncKeepAlive|\.\/webdav|@capacitor\/core)$/ }, args => ({
          path: args.path,
          namespace: 'ceru-auto-sync-test-stub'
        }))
        builder.onLoad({ filter: /.*/, namespace: 'ceru-auto-sync-test-stub' }, args => ({
          contents: stubs[args.path],
          loader: 'js'
        }))
      }
    }]
  })
  const bundlePath = path.join(tmpdir(), `ceru-auto-sync-${process.pid}.mjs`)
  await writeFile(bundlePath, result.outputFiles[0].text)
  try {
    return await import(pathToFileURL(bundlePath).href + '?v=' + Date.now())
  } finally {
    await rm(bundlePath, { force: true })
  }
}

const module = await loadAutoSync()
const connection = { id: 'conn-1', name: 'NAS', origin: 'https://dav.example.com', basePath: '/ceru/', confirmed: true, allowInsecureHttp: false }
const disabled = { connectionId: 'conn-1', enabled: false, autoSyncMinutes: 3, lastAttemptAt: 90_000 }
const enabled = { connectionId: 'conn-1', enabled: true, autoSyncMinutes: 3, lastAttemptAt: 90_000 }

check('disabled auto-sync has no target', module.nextAutoSyncTarget([connection], () => disabled, 120_000) === undefined)
const first = module.nextAutoSyncTarget([connection], () => enabled, 120_000)
check('enabled target uses the configured interval', first?.dueAt === 270_000 && first?.intervalMs === 180_000)
check('target keeps the OAuth-free connection object', first?.connection.id === 'conn-1' && first?.status.enabled === true)
const unscheduled = module.nextAutoSyncTarget([connection], () => ({ ...enabled, lastAttemptAt: undefined }), 120_000)
check('a never-run connection is due immediately', unscheduled?.dueAt === 120_000)
const clampedLow = module.nextAutoSyncTarget([connection], () => ({ ...enabled, autoSyncMinutes: 0.5 }), 120_000)
const clampedHigh = module.nextAutoSyncTarget([connection], () => ({ ...enabled, autoSyncMinutes: 999 }), 120_000)
check('interval is clamped to 1–60 minutes', clampedLow?.intervalMs === 60_000 && clampedHigh?.intervalMs === 3_600_000)
const secondConnection = { ...connection, id: 'conn-2', name: 'Backup' }
const second = module.nextAutoSyncTarget([connection, secondConnection], item => item.id === 'conn-2' ? { ...enabled, connectionId: 'conn-2' } : disabled, 120_000)
check('only the enabled connection is scheduled', second?.connection.id === 'conn-2')

const main = await readFile(path.join(root, 'src/main.ts'), 'utf8')
const syncView = await readFile(path.join(root, 'src/views/SyncServices.vue'), 'utf8')
const scheduler = await readFile(path.join(root, 'src/core/sync/autoSync.ts'), 'utf8')
const plugin = await readFile(path.join(root, 'android/app/src/main/java/com/ceru/music/mobile/SyncKeepAlivePlugin.java'), 'utf8')
const service = await readFile(path.join(root, 'android/app/src/main/java/com/ceru/music/mobile/SyncKeepAliveService.java'), 'utf8')
const manifest = await readFile(path.join(root, 'android/app/src/main/AndroidManifest.xml'), 'utf8')
check('main entry installs the app-level scheduler', main.includes('app.mount') && main.indexOf('app.mount') < main.lastIndexOf('startAutoSyncScheduler'))
check('scheduler no longer depends on a mounted sync page', scheduler.includes('document.addEventListener') && scheduler.includes('setInterval(wake'))
check('sync page no longer owns a duplicate auto-sync interval', !syncView.includes('autoTimer') && !syncView.includes('setInterval(() => { void autoSyncTick()'))
check('native keep-alive is main-frame guarded', plugin.includes('MainFrameGuard') && plugin.includes('initialize') && plugin.includes('guard.require'))
check('native keep-alive exposes start, stop and status', ['start', 'stop', 'status'].every(name => plugin.includes('public void ' + name)))
check('service is a dataSync foreground service that stops with the task', service.includes('startForeground') && manifest.includes('foregroundServiceType="dataSync"') && manifest.includes('android:stopWithTask="true"'))
check('manifest declares the Android 14 data-sync permission', manifest.includes('FOREGROUND_SERVICE_DATA_SYNC'))

console.log(JSON.stringify({ checks: checks.length, pass: true }))
