import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import ts from 'typescript'

// No server, cloud, downloads, build, or source writes. Use the real stylesheet,
// installed Vue runtime, and sheet-focus helper in a small browser fixture.
// --baseline records and verifies the original animation replay, instead of
// claiming that the unfixed source passed the regression requirements.
const args = process.argv.slice(2)
const valueOf = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined
const baseline = args.includes('--baseline')
const root = resolve(valueOf('--source-root') || resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const reportPath = valueOf('--report') && resolve(valueOf('--report'))
const css = readFileSync(resolve(root, 'src/styles/main.css'), 'utf8')
const vue = readFileSync(resolve(root, 'node_modules/vue/dist/vue.global.prod.js'), 'utf8')
const focusSource = readFileSync(resolve(root, 'src/core/ui/sheetFocus.ts'), 'utf8')
const focusScript = ts.transpileModule(focusSource, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext }
}).outputText.replace(/^export /gm, '')
const hash = (text) => createHash('sha256').update(text).digest('hex')
const report = {
  mode: baseline ? 'baseline-replay-observation' : 'regression',
  command: [process.execPath, ...process.argv.slice(1)],
  workingDirectory: process.cwd(),
  testSha256: hash(readFileSync(fileURLToPath(import.meta.url), 'utf8')),
  sourceRoot: root,
  sourceVersion: JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).version,
  cssSha256: hash(css),
  vueRuntimeSha256: hash(vue),
  focusHelperSha256: hash(focusSource),
  startedAt: new Date().toISOString(),
  scope: 'Standalone Vue fixture with current source CSS and focus helper; not a device or business-action test.',
  scenarios: [],
  errors: []
}

function check(result, label, test) {
  try {
    test()
    result.checks.push({ label, passed: true })
  } catch (error) {
    result.checks.push({ label, passed: false, error: error.message })
  }
}

async function makePage(browser, reducedMotion = 'no-preference') {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion })
  await page.route('**/*', (route) => route.abort('blockedbyclient'))
  page.on('pageerror', (error) => report.errors.push(error.message))
  await page.setContent(`<style>${css}</style><div id="app"></div>`)
  await page.addScriptTag({ content: vue })
  await page.evaluate(({ bareClass }) => {
    const events = []
    let insertions = 0
    let maxMaskCount = 0
    let clicks = 0
    let start = 0
    let frames = []
    let sampleId = 0
    let phase = ''
    let durations = {}
    for (const type of ['animationstart', 'animationend', 'transitionrun', 'transitionend', 'transitioncancel']) {
      document.addEventListener(type, (event) => {
        if (!(event.target instanceof Element) || !event.target.closest('.audit-mask')) return
        const style = getComputedStyle(event.target)
        events.push({
          t: Math.round(performance.now() - start), phase, type,
          target: event.target.classList.contains('sheet-mask') ? 'mask' : event.target.classList.contains('sheet') ? 'sheet' : 'scrim',
          animation: event.animationName, property: event.propertyName,
          classes: event.target.className,
          y: new DOMMatrix(style.transform).m42, opacity: Number(style.opacity)
        })
      }, true)
    }
    const observer = new MutationObserver((changes) => {
      for (const change of changes) for (const node of change.addedNodes) {
        if (node instanceof Element && node.matches('.audit-mask')) insertions++
      }
      maxMaskCount = Math.max(maxMaskCount, document.querySelectorAll('.audit-mask').length)
    })
    observer.observe(document.body, { childList: true, subtree: true })
    const begin = (nextPhase) => {
      phase = nextPhase
      start = performance.now()
      events.length = 0
      frames = []
      durations = {}
      const id = ++sampleId
      const sample = () => {
        if (id !== sampleId) return
        const mask = document.querySelector('.audit-mask')
        const sheet = mask?.querySelector('.sheet')
        const rootStyle = mask && getComputedStyle(mask)
        const sheetStyle = sheet && getComputedStyle(sheet)
        if (mask && mask.matches('.sheet-pop-enter-active, .sheet-pop-leave-active')) {
          durations = { mask: rootStyle.transitionDuration, sheet: sheetStyle.transitionDuration }
        }
        frames.push({
          t: Math.round(performance.now() - start), present: Boolean(mask),
          classes: mask?.className, y: sheet ? new DOMMatrix(sheetStyle.transform).m42 : null,
          opacity: rootStyle ? Number(rootStyle.opacity) : null,
          maskAnimation: rootStyle?.animationName, sheetAnimation: sheetStyle?.animationName
        })
        if (performance.now() - start < 700) requestAnimationFrame(sample)
      }
      requestAnimationFrame(sample)
    }
    const snapshot = () => {
      let lastY = null
      let lastOpacity = null
      let maxBackwardsJump = 0
      let maxOpacityDrop = 0
      const leaving = phase.includes('leave')
      for (const frame of frames) {
        if (!frame.present || frame.classes.includes('sheet-pop-enter-from')) continue
        if (lastY !== null) maxBackwardsJump = Math.max(maxBackwardsJump, leaving ? lastY - frame.y : frame.y - lastY)
        if (lastOpacity !== null) maxOpacityDrop = Math.max(maxOpacityDrop, leaving ? frame.opacity - lastOpacity : lastOpacity - frame.opacity)
        lastY = frame.y
        lastOpacity = frame.opacity
      }
      return {
        phase, clicks, insertions, maxMaskCount, events: [...events], frames: [...frames], durations,
        maxBackwardsJump, maxOpacityDrop,
        maskCount: document.querySelectorAll('.audit-mask').length,
        finalY: document.querySelector('.audit-mask .sheet') ? new DOMMatrix(getComputedStyle(document.querySelector('.audit-mask .sheet')).transform).m42 : null
      }
    }
    Vue.createApp({
      setup() {
        const open = Vue.ref(false)
        const bareOpen = Vue.ref(false)
        const show = () => { clicks++; open.value = true }
        const showBare = () => { clicks++; bareOpen.value = true }
        const close = () => { open.value = false; bareOpen.value = false }
        window.sheetAudit = { begin, snapshot, show, showBare, close }
        return { open, bareOpen, show, showBare, close, bareClass }
      },
      template: `<button id="trigger" @click="show">Open managed</button><button id="bare-trigger" @click="showBare">Open standalone</button>
        <Transition name="sheet-pop"><div v-if="open" class="sheet-mask audit-mask" @click.self="close"><div class="scrim" @click="close"></div><section class="sheet" role="dialog" aria-modal="true" aria-label="Managed fixture"><button id="close" @click="close">Close</button></section></div></Transition>
        <div v-if="bareOpen" :class="['sheet-mask', 'audit-mask', bareClass]" @click.self="close"><div class="scrim" @click="close"></div><section class="sheet" role="dialog" aria-modal="true" aria-label="Standalone fixture"><button id="bare-close" @click="close">Close</button></section></div>`
    }).mount('#app')
  }, { bareClass: baseline ? '' : 'sheet-standalone' })
  await page.addScriptTag({ content: `${focusScript}\nwindow.disposeAuditFocus = installSheetFocusRestore();` })
  return page
}

const motionEvents = (result, type, target, property) => result.events.filter((event) =>
  event.type === type && (!target || event.target === target) && (!property || event.property === property))
const keyframes = (result) => result.events.filter((event) => event.type === 'animationstart')

function checkManagedOpen(result, reduced = false, interrupted = false) {
  check(result, 'exactly one mounted mask', () => assert.equal(result.maskCount, 1))
  if (baseline) {
    check(result, 'baseline actually replays sheet-up after the Vue transition', () => {
      const replay = result.events.findIndex((event) => event.type === 'animationstart' && event.animation === 'sheet-up')
      const rootEnd = result.events.findIndex((event) => event.type === 'transitionend' && event.target === 'mask')
      assert.ok(rootEnd >= 0 && replay > rootEnd, 'expected a new sheet-up after the first root transition ends')
      // Frame sampling can miss the jump if the browser is busy. The ordered
      // transitionend -> new animationstart events prove replay independently.
    })
    return
  }
  check(result, 'no inherited keyframe starts in managed sheet or scrim', () => assert.equal(keyframes(result).length, 0))
  check(result, 'no second upward-animation reset', () => assert.ok(result.maxBackwardsJump < 0.8, `${result.maxBackwardsJump} px backward jump`))
  check(result, 'mask does not fade back out after opening', () => assert.ok(result.maxOpacityDrop < 0.04, `opacity drop ${result.maxOpacityDrop}`))
  check(result, 'settles at resting position', () => assert.ok(Math.abs(result.finalY) < 0.01))
  if (!interrupted) {
    check(result, 'one mask opacity transition', () => assert.equal(motionEvents(result, 'transitionrun', 'mask', 'opacity').length, 1))
    check(result, reduced ? 'no transform transition in reduced motion' : 'one sheet transform transition', () =>
      assert.equal(motionEvents(result, 'transitionrun', 'sheet', 'transform').length, reduced ? 0 : 1))
  }
  if (reduced) check(result, 'no vertical motion in reduced mode', () => assert.ok(result.frames.every((frame) => frame.y === null || Math.abs(frame.y) < 0.01)))
}

let browser
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true
  })
  for (const reduced of [false, true]) {
    const page = await makePage(browser, reduced ? 'reduce' : 'no-preference')
    await page.evaluate(() => sheetAudit.begin('open'))
    await page.locator('#trigger').click()
    await page.waitForTimeout(750)
    const opening = { name: reduced ? 'managed-reduced-motion' : 'managed-open', ...await page.evaluate(() => sheetAudit.snapshot()), checks: [] }
    check(opening, 'one trigger click and one DOM insertion', () => { assert.equal(opening.clicks, 1); assert.equal(opening.insertions, 1) })
    checkManagedOpen(opening, reduced)
    await page.keyboard.press('Tab')
    const tabInside = await page.evaluate(() => Boolean(document.activeElement?.closest('.audit-mask')))
    check(opening, 'Tab enters the sheet', () => assert.equal(tabInside, true))
    report.scenarios.push(opening)

    await page.evaluate(() => sheetAudit.begin('leave'))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(40)
    const leavingDuring = await page.locator('.audit-mask').evaluate((mask) => ({ present: true, active: mask.classList.contains('sheet-pop-leave-active') }))
    await page.waitForTimeout(320)
    const leaving = { name: reduced ? 'managed-reduced-leave-keyboard' : 'managed-leave-keyboard', ...await page.evaluate(() => sheetAudit.snapshot()), during: leavingDuring, checks: [] }
    check(leaving, 'Escape keeps the mask mounted during leave then removes it', () => { assert.equal(leaving.during.active, true); assert.equal(leaving.maskCount, 0) })
    check(leaving, 'one leaving root transition', () => assert.equal(motionEvents(leaving, 'transitionrun', 'mask', 'opacity').length, 1))
    if (!baseline) {
      check(leaving, 'leave never starts keyframes', () => assert.equal(keyframes(leaving).length, 0))
      check(leaving, 'one leaving sheet transition', () => assert.equal(motionEvents(leaving, 'transitionrun', 'sheet', reduced ? 'opacity' : 'transform').length, 1))
      check(leaving, 'leave has no reversed motion or fade reset', () => { assert.ok(leaving.maxBackwardsJump < 0.8); assert.ok(leaving.maxOpacityDrop < 0.04) })
      check(leaving, 'root duration does not truncate the nested transition', () => assert.ok(parseFloat(leaving.durations.mask) >= parseFloat(leaving.durations.sheet)))
    }
    const restored = await page.evaluate(() => document.activeElement?.id === 'trigger')
    check(leaving, 'closing restores focus to the trigger', () => assert.equal(restored, true))
    report.scenarios.push(leaving)

    await page.evaluate(() => sheetAudit.begin('standalone-open'))
    await page.locator('#bare-trigger').click()
    await page.waitForTimeout(750)
    const bare = { name: reduced ? 'standalone-reduced-motion' : 'standalone-keyframes', ...await page.evaluate(() => sheetAudit.snapshot()), checks: [] }
    check(bare, 'unwrapped shell still opens once', () => { assert.equal(bare.maskCount, 1); assert.equal(bare.insertions, 2); assert.equal(bare.clicks, 2) })
    check(bare, 'unwrapped shell has no Vue transitions', () => assert.equal(motionEvents(bare, 'transitionrun').length, 0))
    if (!reduced || baseline) {
      check(bare, 'standalone mask fades once and sheet slides once', () => {
        assert.equal(keyframes(bare).filter((event) => event.target === 'mask' && event.animation === 'fade-in').length, 1)
        assert.equal(keyframes(bare).filter((event) => event.target === 'sheet' && event.animation === 'sheet-up').length, 1)
      })
    } else {
      check(bare, 'standalone reduced mode has no keyframes or vertical motion', () => {
        assert.equal(keyframes(bare).length, 0)
        assert.ok(bare.frames.every((frame) => frame.y === null || Math.abs(frame.y) < 0.01))
      })
    }
    check(bare, 'unwrapped shell does not replay', () => assert.ok(bare.maxBackwardsJump < 0.8))
    await page.keyboard.press('Escape')
    await page.waitForTimeout(80)
    const bareClosed = await page.locator('.audit-mask').count() === 0
    check(bare, 'unwrapped Escape still dismisses immediately', () => assert.equal(bareClosed, true))
    report.scenarios.push(bare)
    await page.close()
  }

  const page = await makePage(browser)
  await page.locator('#trigger').click()
  await page.waitForTimeout(750)
  await page.evaluate(() => { sheetAudit.begin('interrupted-leave'); sheetAudit.close() })
  await page.waitForTimeout(40)
  const beforeReopen = await page.locator('.audit-mask').evaluate((mask) => mask.classList.contains('sheet-pop-leave-active'))
  await page.evaluate(() => { sheetAudit.begin('quick-reopen'); sheetAudit.show() })
  await page.waitForTimeout(750)
  const reopening = { name: 'quick-reopen-during-leave', ...await page.evaluate(() => sheetAudit.snapshot()), beforeReopen, checks: [] }
  check(reopening, 'reopen actually interrupts a still-mounted leaving sheet', () => assert.equal(reopening.beforeReopen, true))
  // Vue may replace the leaving vnode when the v-if reverses. Two total
  // insertions across two opens are valid; two concurrent masks are not.
  check(reopening, 'reopen has at most one insertion per open and no concurrent duplicate mask', () => {
    assert.ok(reopening.insertions <= reopening.clicks)
    assert.equal(reopening.maxMaskCount, 1)
    assert.equal(reopening.maskCount, 1)
  })
  checkManagedOpen(reopening, false, true)
  report.scenarios.push(reopening)
  await page.close()
} catch (error) {
  report.errors.push(error.stack || error.message)
} finally {
  await browser?.close()
  report.finishedAt = new Date().toISOString()
  report.failedChecks = report.scenarios.flatMap((scenario) => scenario.checks.filter((item) => !item.passed).map((item) => ({ scenario: scenario.name, ...item })))
  report.passed = report.errors.length === 0 && report.failedChecks.length === 0
  if (reportPath) writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8')
  for (const scenario of report.scenarios) {
    console.log(`${scenario.checks.every((item) => item.passed) ? 'PASS' : 'FAIL'} ${scenario.name}: keyframes=${keyframes(scenario).length}, backwardsJump=${scenario.maxBackwardsJump.toFixed(3)}px, maskCount=${scenario.maskCount}`)
  }
  for (const failure of report.failedChecks) console.error(`${failure.scenario}: ${failure.label}: ${failure.error}`)
  for (const error of report.errors) console.error(error)
  console.log(`${report.passed ? (baseline ? 'BASELINE CONFIRMED' : 'REGRESSION PASS') : 'FAIL'}; cssSha256=${report.cssSha256}${reportPath ? '; report=' + reportPath : ''}`)
  process.exitCode = report.passed ? 0 : 1
}
