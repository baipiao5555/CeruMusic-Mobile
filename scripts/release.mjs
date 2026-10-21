#!/usr/bin/env node
/**
 * 一条命令发版：
 *   npm run release                     # 自动把 -mobile.N 加一
 *   npm run release -- --version 2.3.1-mobile.18
 *   npm run release -- --dry-run        # 只打印步骤
 *
 * 发版说明文件：docs/release-v<版本>.md
 * 可用占位符：<!-- SHA256 -->、<!-- SIZE -->，脚本会替换成真实值。
 */
import { execSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const argv = process.argv.slice(2)
const dryRun = argv.includes('--dry-run')
const explicitVersion = argv.find((arg) => !arg.startsWith('--'))

function log(message = '') {
  console.log(message)
}
function fail(message) {
  console.error('\n[release] ' + message)
  process.exit(1)
}
function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8')
}
function write(relative, content) {
  fs.writeFileSync(path.join(root, relative), content, 'utf8')
}
function capture(command, cwd = root) {
  return execSync(command, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}
function run(command, options = {}) {
  log('$ ' + command)
  if (dryRun) return ''
  return execSync(command, {
    cwd: options.cwd ?? root,
    stdio: options.capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    encoding: 'utf8',
    shell: true,
    timeout: options.timeout ?? 20 * 60 * 1000
  })
}

function nextMobileVersion(version) {
  const match = version.match(/^(.*-mobile\.)(\d+)$/)
  if (!match) {
    fail(`当前版本 ${version} 不是 x.y.z-mobile.N 格式，请用 --version 指定新版本`)
  }
  return match[1] + (Number(match[2]) + 1)
}

function segments(value) {
  return (String(value).replace(/^v/i, '').match(/\d+/g) ?? []).map(Number)
}
function compareVersions(a, b) {
  const left = segments(a)
  const right = segments(b)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index++) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function findGradle() {
  const candidates = []
  const dists = path.join(os.homedir(), '.gradle', 'wrapper', 'dists')
  if (fs.existsSync(dists)) {
    for (const dist of fs.readdirSync(dists)) {
      const distPath = path.join(dists, dist)
      if (!fs.statSync(distPath).isDirectory()) continue
      for (const hash of fs.readdirSync(distPath)) {
        const hashPath = path.join(distPath, hash)
        if (!fs.statSync(hashPath).isDirectory()) continue
        for (const name of fs.readdirSync(hashPath)) {
          if (!name.startsWith('gradle-')) continue
          const binary = path.join(
            hashPath,
            name,
            'bin',
            process.platform === 'win32' ? 'gradle.bat' : 'gradle'
          )
          if (fs.existsSync(binary)) {
            const match = name.match(/^gradle-(\d+\.\d+(?:\.\d+)?)/)
            candidates.push({ binary, version: match?.[1] ?? '0' })
          }
        }
      }
    }
  }
  if (candidates.length) {
    // 优先用本地已解压的发行版：gradlew 在这里会因证书校验重新下载而失败。
    candidates.sort((a, b) => compareVersions(b.version, a.version))
    return candidates[0].binary
  }
  const wrapper = path.join(
    root,
    'android',
    process.platform === 'win32' ? 'gradlew.bat' : 'gradlew'
  )
  if (fs.existsSync(wrapper)) return wrapper
  if (process.env.GRADLE_BIN) return process.env.GRADLE_BIN
  fail('没有找到可用的 Gradle，请设置 GRADLE_BIN 或安装 Gradle 8.8')
}

function findApksigner() {
  let sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT || ''
  if (!sdk && fs.existsSync(path.join(root, 'android', 'local.properties'))) {
    const match = read('android/local.properties').match(/sdk\.dir\s*=\s*(.+)/)
    if (match) sdk = match[1].trim().replace(/\\\\/g, '\\')
  }
  if (!sdk) fail('没有找到 Android SDK，请配置 ANDROID_HOME 或 android/local.properties')
  const buildTools = path.join(sdk.replace(/\\/g, path.sep), 'build-tools')
  if (!fs.existsSync(buildTools)) fail(`没有找到 build-tools：${buildTools}`)
  const versions = fs
    .readdirSync(buildTools)
    .sort((a, b) => compareVersions(a, b))
    .reverse()
  for (const version of versions) {
    const binary = path.join(
      buildTools,
      version,
      process.platform === 'win32' ? 'apksigner.bat' : 'apksigner'
    )
    if (fs.existsSync(binary)) return binary
  }
  fail('没有找到 apksigner，请安装 Android build-tools')
}

const pkg = JSON.parse(read('package.json'))
const currentVersion = pkg.version
const version = explicitVersion || nextMobileVersion(currentVersion)
if (compareVersions(version, currentVersion) <= 0) {
  fail(`新版本 ${version} 必须大于当前版本 ${currentVersion}`)
}
const tag = 'v' + version
const notesRelative = `docs/release-${tag}.md`

log('=== 澜音手机版发版 ===')
log(`当前版本：${currentVersion}`)
log(`目标版本：${version}（${tag}）`)
log(`发版说明：${notesRelative}`)
log('')

if (!fs.existsSync(path.join(root, notesRelative))) {
  fail(`缺少发版说明 ${notesRelative}。请先写好更新内容（可用 <!-- SHA256 --> 和 <!-- SIZE --> 占位）。`)
}

if (!dryRun) {
  const status = execSync('git status --porcelain', { cwd: root, encoding: 'utf8' })
    .split(/\r?\n/)
    .filter((line) => line.trim() && !line.includes(notesRelative))
  if (status.length) {
    fail('工作区不是干净的（发版说明除外），请先提交或还原改动：\n' + status.join('\n'))
  }
  if (capture(`git tag --list "${tag}"`).trim()) fail(`tag ${tag} 已经存在`)
}

pkg.version = version
log(`更新 package.json → ${version}`)
if (!dryRun) write('package.json', JSON.stringify(pkg, null, 2) + '\n')

let gradle = read('android/app/build.gradle')
const codeMatch = gradle.match(/versionCode\s+(\d+)/)
if (!codeMatch) fail('android/app/build.gradle 中没有 versionCode')
const versionCode = Number(codeMatch[1]) + 1
gradle = gradle
  .replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  .replace(/versionName\s+"[^"]+"/, `versionName "${version}"`)
log(`更新 build.gradle → versionCode ${versionCode} / versionName ${version}`)
if (!dryRun) write('android/app/build.gradle', gradle)

log('')
log('--- 构建 Web 资源 ---')
run('npm run build')
run('npx cap sync android')

log('')
log('--- 构建 APK ---')
const gradleBinary = findGradle()
log(`使用 Gradle：${gradleBinary}`)
run(`"${gradleBinary}" assembleRelease`, { cwd: path.join(root, 'android') })

const apk = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'release', 'app-release.apk')
if (!dryRun && !fs.existsSync(apk)) fail(`没有生成 APK：${apk}`)

log('')
log('--- 校验签名 ---')
const apksigner = findApksigner()
const certInfo = dryRun
  ? ''
  : capture(`"${apksigner}" verify --print-certs "${apk}" 2>&1`)
if (!dryRun) {
  if (!certInfo.includes('Signer #1')) fail('APK 签名校验失败')
  log(
    certInfo
      .split(/\r?\n/)
      .filter((line) => line.includes('Signer #1'))
      .slice(0, 3)
      .join('\n')
  )
}

log('')
log('--- 生成安装包与校验值 ---')
const targetApk = path.join(root, `CeruMusic-Mobile-${tag}.apk`)
let size = 0
let sha256 = ''
if (!dryRun) {
  fs.copyFileSync(apk, targetApk)
  const buffer = fs.readFileSync(targetApk)
  size = buffer.length
  sha256 = createHash('sha256').update(buffer).digest('hex')
  log(`APK：${targetApk}`)
  log(`大小：${size} 字节`)
  log(`SHA-256：${sha256}`)
}

log('')
log('--- 回填发版说明 ---')
if (!dryRun) {
  let notes = read(notesRelative)
  notes = notes
    .replace(/<!--\s*SHA256\s*-->/g, sha256)
    .replace(/<!--\s*SIZE\s*-->/g, String(size))
  write(notesRelative, notes)
}

log('')
log('--- 清理构建产物并提交 ---')
if (!dryRun) {
  const artifacts = [
    'dist',
    'public/plugin-runtime',
    'android/app/src/main/assets/public',
    'android/app/src/main/assets/capacitor.config.json',
    'android/app/src/main/assets/capacitor.plugins.json'
  ]
  for (const relative of artifacts) {
    try {
      fs.rmSync(path.join(root, relative), { recursive: true, force: true, maxRetries: 3 })
    } catch (error) {
      fail(`无法清理 ${relative}，请停止 dev server 后重试：${error.message}`)
    }
  }
}
run('git add -A')
run(`git commit -m "chore(release): ${tag}"`)
run(`git tag ${tag}`)
run('git push origin main')
run(`git push origin ${tag}`)

log('')
log('--- 创建 GitHub Release ---')
run(
  `gh release create ${tag} "${targetApk}" --title "澜音 · CeruMusic 手机版 ${tag}" --notes-file "${path.join(root, notesRelative)}"`
)

log('')
log('--- 恢复本地构建产物 ---')
run('npm run build')
run('npx cap sync android')

log('')
log(`完成：https://github.com/baipiao5555/CeruMusic-Mobile/releases/tag/${tag}`)
if (sha256) log(`SHA-256：${sha256}`)
