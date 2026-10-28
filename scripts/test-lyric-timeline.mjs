import { build } from 'esbuild'
import { readFileSync, rmSync } from 'node:fs'

// 逐字时间归一化 / 偏移平移的纯函数测试（不依赖浏览器）。
const outfile = new URL('../.tmp-timeline.mjs', import.meta.url).pathname.replace(/^\//, '')
await build({
  entryPoints: ['src/core/lyrics/timeline.ts'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  outfile,
  logLevel: 'silent'
})
const { normalizeTimedWords, shiftTimedLyrics, toNativeLyricLines } = await import('file://' + outfile)

const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok })
  console.log((ok ? 'PASS' : 'FAIL') + '  ' + name + (detail ? '  — ' + detail : ''))
}

// 1) 正常逐字：绝对时间保留，缺 end 的用下一字补
const lineText = '晴天忽然下雨'
const words = normalizeTimedWords(
  [
    { startTimeMs: 1000, endTimeMs: 1400, text: '晴天' },
    { startTimeMs: 1400, text: '忽然' },
    { startTimeMs: 1800, endTimeMs: 2400, text: '下雨' }
  ],
  1000,
  3000,
  lineText
)
check(
  '逐字时间被保留并补全 end',
  Boolean(words) && words.length === 3 && words[1].endTimeMs === 1800 && words[2].endTimeMs === 2400,
  JSON.stringify(words)
)

// 2) 文字对不上就丢弃（否则变色会高亮错字）
const mismatched = normalizeTimedWords(
  [
    { startTimeMs: 1000, endTimeMs: 1400, text: '别的' },
    { startTimeMs: 1400, endTimeMs: 2000, text: '歌词' }
  ],
  1000,
  3000,
  lineText
)
check('逐字文字与整行不一致时不使用', mismatched === undefined, String(mismatched))

// 3) 少于两个字 → 视为没有逐字
const single = normalizeTimedWords([{ startTimeMs: 1000, endTimeMs: 2000, text: lineText }], 1000, 3000, lineText)
check('只有一条时不启用逐字', single === undefined, String(single))

// 4) 起点早于行起点时按行起点裁剪
const clamped = normalizeTimedWords(
  [
    { startTimeMs: 0, endTimeMs: 1200, text: '晴天' },
    { startTimeMs: 1200, endTimeMs: 3000, text: '忽然下雨' }
  ],
  1000,
  3000,
  lineText
)
check('逐字起点被裁剪到行起点', Boolean(clamped) && clamped[0].startTimeMs === 1000, JSON.stringify(clamped))

// 5) 偏移平移：行与逐字一起平移
const shifted = shiftTimedLyrics(
  [{ startTimeMs: 1000, endTimeMs: 3000, text: lineText, words }],
  -400
)
const shiftedWords = shifted[0].words ?? []
check(
  '歌词偏移会同时平移行与逐字',
  shifted[0].startTimeMs === 600 &&
    shifted[0].endTimeMs === 2600 &&
    shiftedWords[0].startTimeMs === 600 &&
    shiftedWords[2].endTimeMs === 2000,
  JSON.stringify(shifted)
)

// 6) 负偏移不会出现负数时间
const clampedShift = shiftTimedLyrics([{ startTimeMs: 100, endTimeMs: 900, text: '测试' }], -500)
check('负偏移不会产生负数时间', clampedShift[0].startTimeMs === 0 && clampedShift[0].endTimeMs === 400, JSON.stringify(clampedShift))

// 7) 交给原生的结构与键名
const nativeLines = toNativeLyricLines(
  [
    { startTimeMs: 1000, endTimeMs: 3000, text: lineText, translation: 'sunny rain', words },
    { startTimeMs: 3000, text: '下一句' }
  ],
  0
)
check(
  '原生结构带 start/end/text/translation/words',
  nativeLines.length === 2 &&
    nativeLines[0].words?.length === 3 &&
    nativeLines[0].words?.[0].start === 1000 &&
    nativeLines[0].translation === 'sunny rain' &&
    nativeLines[1].end === 8000,
  JSON.stringify(nativeLines)
)
check(
  '缺行尾时用下一行开头',
  nativeLines[0].end === 3000 && nativeLines[1].start === 3000,
  JSON.stringify(nativeLines.map((line) => [line.start, line.end]))
)

rmSync(outfile, { force: true })
const passed = checks.filter((item) => item.ok).length
console.log(`\n${passed}/${checks.length} passed`)
process.exit(passed === checks.length ? 0 : 1)
