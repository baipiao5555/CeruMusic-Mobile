#!/usr/bin/env node
/**
 * 检查桌面版澜音是否有更新，并给出需要移植的范围。
 * 用法：npm run check:upstream
 * 可选环境变量：CERU_UPSTREAM_DIR（桌面源码目录，默认 D:/LX/CeruMusic-src）
 */
import fs from 'node:fs'
import path from 'node:path'
import { execSync } from 'node:child_process'

const root = path.resolve(import.meta.dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
const upstreamVersion = String(pkg.upstreamVersion ?? '2.3.1')
const upstreamDir = process.env.CERU_UPSTREAM_DIR || 'D:/LX/CeruMusic-src'
const feedUrl = `https://update.cerumusic.top/update/win32/x64/${upstreamVersion}`

function line(text = '') {
  console.log(text)
}

async function checkFeed() {
  line(`桌面版更新源：${feedUrl}`)
  try {
    const response = await fetch(feedUrl, {
      headers: { 'User-Agent': 'CeruMusic-Mobile-UpstreamCheck' }
    })
    if (response.status === 204) {
      line('  → 已是最新（HTTP 204）')
      return null
    }
    if (!response.ok) {
      line(`  → 请求失败 HTTP ${response.status}`)
      return null
    }
    const data = await response.json()
    line(`  → 发现新版本：${data.name ?? '未知'}（${data.url ?? '无下载地址'}）`)
    return data
  } catch (error) {
    line(`  → 无法连接更新源：${error.message}`)
    return null
  }
}

async function checkGitHub() {
  const url = 'https://api.github.com/repos/timeshiftsauce/CeruMusic/releases/latest'
  line(`GitHub Release：${url}`)
  // Prefer gh: it already has auth and proxy settings, and avoids rate limits.
  try {
    const output = execSync(`gh api repos/timeshiftsauce/CeruMusic/releases/latest`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000
    })
    const data = JSON.parse(output)
    line(`  → 最新为 ${data.tag_name}（${data.published_at}）`)
    return data
  } catch {}
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'CeruMusic-Mobile-UpstreamCheck'
      }
    })
    if (!response.ok) {
      line(`  → 请求失败 HTTP ${response.status}`)
      return null
    }
    const data = await response.json()
    line(`  → 最新为 ${data.tag_name}（${data.published_at}）`)
    return data
  } catch (error) {
    line(`  → 无法连接 GitHub（gh 与 fetch 都失败）：${error.message}`)
    return null
  }
}

function checkGitLog() {
  if (!fs.existsSync(upstreamDir)) {
    line(`桌面源码目录不存在：${upstreamDir}（跳过提交对比）`)
    return
  }
  line(`本地桌面源码：${upstreamDir}`)
  try {
    execSync('git fetch origin --tags --prune', {
      cwd: upstreamDir,
      stdio: 'ignore',
      timeout: 120_000
    })
    const tag = `v${upstreamVersion}`
    const commits = execSync(`git log --oneline ${tag}..origin/main`, {
      cwd: upstreamDir,
      encoding: 'utf8',
      stdio: 'pipe'
    }).trim()
    if (!commits) {
      line(`  → ${tag}..origin/main 没有新提交`)
      return
    }
    const list = commits.split(/\r?\n/)
    line(`  → ${tag}..origin/main 有 ${list.length} 个提交：`)
    line(list.slice(0, 20).map((item) => '     ' + item).join('\n'))
    if (list.length > 20) line(`     … 其余 ${list.length - 20} 个`)
    const stat = execSync(`git diff --stat ${tag}..origin/main`, {
      cwd: upstreamDir,
      encoding: 'utf8',
      stdio: 'pipe'
    }).trim()
    const lines = stat.split(/\r?\n/)
    line('  → 变更文件（末尾为汇总）：')
    line(lines.slice(-25).map((item) => '     ' + item).join('\n'))
  } catch (error) {
    line(`  → 对比失败：${String(error.message).split('\n')[0]}`)
  }
}

line('=== 澜音上游同步检查 ===')
line(`手机版基于桌面版 v${upstreamVersion}（package.json → upstreamVersion）`)
line()
const feed = await checkFeed()
line()
const release = await checkGitHub()
line()
checkGitLog()
line()

const feedVersion = feed?.name ? String(feed.name).replace(/^v/i, '') : ''
const releaseVersion = release?.tag_name ? String(release.tag_name).replace(/^v/i, '') : ''
const newer =
  (feedVersion && feedVersion !== upstreamVersion) ||
  (releaseVersion && releaseVersion !== upstreamVersion)

if (newer) {
  line('结论：上游有更新。按 docs/upstream-sync.md 的清单逐项移植，完成后把 package.json 的')
  line('      upstreamVersion 改成新版本，再跑 npm run release。')
  process.exitCode = 2
} else {
  line('结论：上游没有新版本，不需要移植。')
}
