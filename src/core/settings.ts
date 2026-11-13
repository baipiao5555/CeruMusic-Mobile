import { reactive } from 'vue'
import { registerHostHooks } from './plugin/manager'
import { logEvent, setLoggingEnabled, setVerboseConsoleCapture } from './logs'

export type AccentColor = 'green' | 'blue' | 'purple' | 'orange'

/** 全应用字体：默认跟随系统，其余会替换界面与歌词的字体族。 */
export type AppFont = 'system' | 'wenkai' | 'smiley' | 'serif' | 'mono'

export interface AppSettings {
  theme: 'system' | 'light' | 'dark'
  accent: AccentColor
  /** Multiplier applied to the player lyric font size. */
  lyricScale: number
  /** Font family used by the whole app (UI and lyrics). */
  fontFamily: AppFont
  playbackRate: number
  downloadFilenameTemplate: string
  /** Show translation lines under the original lyric text. */
  showLyricTranslation: boolean
  /** Positive values delay the lyric highlight (milliseconds). */
  lyricOffsetMs: number
  /** Empty means automatic: use the highest quality the current track offers. */
  quality: string
  showLyrics: boolean
  /** Search LrcLib / QQ Music / NetEase when the plugin provides no lyrics. */
  cloudLyrics: boolean
  keepScreenOn: boolean
  /** Pause when wired headphones or Bluetooth audio disconnect. */
  playOnHeadset: boolean
  /** Try another enabled provider when the current one cannot play a track. */
  autoSourceFallback: boolean
  /** Swipe left/right on the player page to change tracks. */
  swipePlayer: boolean
  /** Swipe left/right between the four main tabs. */
  swipeTabs: boolean
  /** Publish the current lyric line to the system / lyricon consumers. */
  systemLyrics: boolean
  /** Include translations in the shared lyrics. */
  systemLyricsTranslation: boolean
  /** Master switch for the in-app run log. */
  logsEnabled: boolean
  /** Capture console.log/info/debug into the run log. */
  verboseLogs: boolean
  /** Re-download URL-installed plugins when a newer version is published. */
  pluginAutoUpdate: boolean
  /** Keep played audio on disk so replaying a song costs no traffic. */
  playbackCache: boolean
  /** Empty means follow the playback quality. */
  downloadQuality: string
  /** How many downloads run at the same time (1-3). */
  downloadConcurrency: number
  version?: number
}

const KEY = 'ceru.settings.v1'

export const settingsState = reactive<AppSettings>({
  theme: 'system',
  accent: 'green',
  lyricScale: 1,
  fontFamily: 'system',
  playbackRate: 1,
  downloadFilenameTemplate: '%t - %s',
  showLyricTranslation: true,
  lyricOffsetMs: 0,
  quality: '',
  showLyrics: true,
  cloudLyrics: true,
  keepScreenOn: true,
  playOnHeadset: true,
  autoSourceFallback: true,
  swipePlayer: true,
  swipeTabs: true,
  systemLyrics: true,
  systemLyricsTranslation: true,
  logsEnabled: true,
  verboseLogs: true,
  pluginAutoUpdate: true,
  playbackCache: true,
  downloadQuality: '',
  downloadConcurrency: 2,
  version: 2
})

export function restoreSettings(): void {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const saved = JSON.parse(raw)
      if (saved && saved.version !== 2) {
        // v1 defaulted to 128k, which made plugins with higher tiers feel low.
        if (saved.quality === '128k') saved.quality = ''
        saved.version = 2
      }
      // 旧版本只有歌词字体；升级后沿用为全局字体
      if (!saved.fontFamily && saved.lyricFont) {
        saved.fontFamily = saved.lyricFont
        delete saved.lyricFont
      }
      if (saved.fontFamily === 'kai' || saved.fontFamily === 'round') saved.fontFamily = 'wenkai'
      Object.assign(settingsState, saved)
      delete (settingsState as unknown as Record<string, unknown>).lyricFont
      if (!FONT_STACKS[settingsState.fontFamily]) settingsState.fontFamily = 'system'
    }
  } catch {}
  applyTheme()
  applyLoggingEnabled()
  applyVerboseLogs()
  persist()
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settingsState))
  } catch {}
}

export function updateSettings(patch: Partial<AppSettings>): void {
  const verboseChanged =
    patch.verboseLogs !== undefined && patch.verboseLogs !== settingsState.verboseLogs
  const logsChanged =
    patch.logsEnabled !== undefined && patch.logsEnabled !== settingsState.logsEnabled
  Object.assign(settingsState, patch)
  persist()
  if (patch.theme || patch.accent || patch.lyricScale !== undefined) applyTheme()
  if (patch.fontFamily !== undefined) applyFontFamily()
  if (logsChanged) applyLoggingEnabled()
  if (verboseChanged) applyVerboseLogs()
  try {
    const changed = Object.entries(patch)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join('，')
    logEvent('info', 'SETTINGS', `设置已更新：${changed}`, fontProbe())
  } catch {}
}

/** 记录当前字体令牌，用来判断「选了字体但界面没变」到底卡在哪一层。 */
function fontProbe(): string {
  try {
    const style = getComputedStyle(document.documentElement)
    const body = document.body ? getComputedStyle(document.body).fontFamily : 'no-body'
    return [
      `fontFamily=${settingsState.fontFamily}`,
      `--sans=${style.getPropertyValue('--sans').trim().slice(0, 90)}`,
      `--serif=${style.getPropertyValue('--serif').trim().slice(0, 90)}`,
      `body=${body.slice(0, 90)}`
    ].join('；')
  } catch {
    return ''
  }
}

export function applyLoggingEnabled(): void {
  setLoggingEnabled(settingsState.logsEnabled)
}

/**
 * Re-applies the verbose console capture. Debug builds wire this at startup
 * so the switch can be flipped without reinstalling a separate APK.
 */
export function applyVerboseLogs(): void {
  setVerboseConsoleCapture(settingsState.verboseLogs)
}

const ACCENTS: Record<AccentColor, { brand: string; strong: string; soft: string; softer: string }> = {
  green: {
    brand: '#00b578',
    strong: '#009c68',
    soft: 'rgba(0, 181, 120, 0.12)',
    softer: 'rgba(0, 181, 120, 0.06)'
  },
  blue: {
    brand: '#2f7cf6',
    strong: '#1f66d8',
    soft: 'rgba(47, 124, 246, 0.12)',
    softer: 'rgba(47, 124, 246, 0.06)'
  },
  purple: {
    brand: '#7c5cff',
    strong: '#6848e8',
    soft: 'rgba(124, 92, 255, 0.13)',
    softer: 'rgba(124, 92, 255, 0.06)'
  },
  orange: {
    brand: '#f08a24',
    strong: '#d97706',
    soft: 'rgba(240, 138, 36, 0.14)',
    softer: 'rgba(240, 138, 36, 0.07)'
  }
}

function applyAccent(): void {
  const accent = ACCENTS[settingsState.accent] ?? ACCENTS.green
  const root = document.documentElement
  root.style.setProperty('--brand', accent.brand)
  root.style.setProperty('--brand-strong', accent.strong)
  root.style.setProperty('--brand-soft', accent.soft)
  root.style.setProperty('--brand-softer', accent.softer)
}

function applyLyricScale(): void {
  const scale = Math.max(0.8, Math.min(1.4, Number(settingsState.lyricScale) || 1))
  document.documentElement.style.setProperty('--lyric-scale', String(scale))
}

/**
 * 字体：系统默认 / 全衬线 / 楷体 / 等宽。
 *
 * 直接覆盖 --sans 与 --serif 两个根令牌，界面和歌词一起换。
 * 每个字体栈末尾都落到 CSS 通用族（serif / monospace / sans-serif），
 * 所以手机上即便没有里面列的具体字体，观感也一定跟系统默认不同，
 * 不会出现「选了没反应」。
 */
// 跟随系统：只留平台自带的通用名，绝不引用随包内置的字体，
// 这样「系统默认」在任何机型上都是手机本来的 UI 字体。
const SANS_STACK =
  "system-ui, -apple-system, 'Roboto', 'Noto Sans SC', 'Noto Sans CJK SC', 'PingFang SC', 'HarmonyOS Sans SC', 'Microsoft YaHei', sans-serif"
const SYSTEM_SERIF_STACK =
  "Georgia, 'Times New Roman', 'Songti SC', STSong, SimSun, serif"
const SERIF_STACK =
  "'Ceru Serif', Georgia, 'Times New Roman', 'Songti SC', STSong, 'Source Han Serif SC', 'Noto Serif SC', 'Noto Serif CJK SC', SimSun, serif"
const KAI_STACK =
  "'Ceru WenKai', 'Kaiti SC', STKaiti, KaiTi, 'Songti SC', STSong, 'Noto Serif CJK SC', SimSun, serif"
const SMILEY_STACK =
  "'Ceru Smiley', 'PingFang SC', 'HarmonyOS Sans SC', 'Noto Sans SC', 'Microsoft YaHei', sans-serif"
const MONO_STACK =
  "'JetBrains Mono', 'SF Mono', ui-monospace, 'Cascadia Mono', Consolas, 'Noto Sans Mono CJK SC', monospace"

const FONT_STACKS: Record<AppFont, { sans: string; serif: string }> = {
  system: { sans: SANS_STACK, serif: SYSTEM_SERIF_STACK },
  wenkai: { sans: KAI_STACK, serif: KAI_STACK },
  smiley: { sans: SMILEY_STACK, serif: SMILEY_STACK },
  serif: { sans: SERIF_STACK, serif: SERIF_STACK },
  mono: { sans: MONO_STACK, serif: MONO_STACK }
}

function applyFontFamily(): void {
  const stack = FONT_STACKS[settingsState.fontFamily] ?? FONT_STACKS.system
  const root = document.documentElement
  root.style.setProperty('--sans', stack.sans)
  root.style.setProperty('--serif', stack.serif)
  // 歌词跟着同一个字体走，除非将来单独开放歌词字体
  root.style.setProperty('--lyric-font', stack.serif)
}

/** Android reports night mode through the SystemBars plugin; WebView media queries lag. */
let nativeDarkOverride: boolean | null = null

export function setNativeDarkOverride(dark: boolean | null): void {
  nativeDarkOverride = dark
}

export function applyTheme(): void {
  const systemDark =
    nativeDarkOverride ?? window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false
  const dark = settingsState.theme === 'dark' || (settingsState.theme === 'system' && systemDark)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.classList.toggle('dark', dark)
  applyAccent()
  applyLyricScale()
  applyFontFamily()
}

export function registerSettingsHostHooks(): void {
  registerHostHooks({
    settings: {
      get: () => ({ ...settingsState }),
      update: (patch: Record<string, any>) => {
        const allowed: Partial<AppSettings> = {}
        if (patch.theme === 'light' || patch.theme === 'dark' || patch.theme === 'system')
          allowed.theme = patch.theme
        if (typeof patch.showLyrics === 'boolean') allowed.showLyrics = patch.showLyrics
        if (typeof patch.cloudLyrics === 'boolean') allowed.cloudLyrics = patch.cloudLyrics
        if (typeof patch.keepScreenOn === 'boolean') allowed.keepScreenOn = patch.keepScreenOn
        if (typeof patch.playOnHeadset === 'boolean') allowed.playOnHeadset = patch.playOnHeadset
        if (typeof patch.autoSourceFallback === 'boolean') {
          allowed.autoSourceFallback = patch.autoSourceFallback
        }
        if (typeof patch.systemLyrics === 'boolean') allowed.systemLyrics = patch.systemLyrics
        if (typeof patch.systemLyricsTranslation === 'boolean') {
          allowed.systemLyricsTranslation = patch.systemLyricsTranslation
        }
        updateSettings(allowed)
        return { ...settingsState }
      }
    }
  })
}
