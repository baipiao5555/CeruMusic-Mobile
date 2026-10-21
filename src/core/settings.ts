import { reactive } from 'vue'
import { registerHostHooks } from './plugin/manager'

export type AccentColor = 'green' | 'blue' | 'purple' | 'orange'

export interface AppSettings {
  theme: 'system' | 'light' | 'dark'
  accent: AccentColor
  /** Multiplier applied to the player lyric font size. */
  lyricScale: number
  playbackRate: number
  downloadFilenameTemplate: string
  /** Empty means automatic: use the highest quality the current track offers. */
  quality: string
  showLyrics: boolean
  /** Search LrcLib / QQ Music / NetEase when the plugin provides no lyrics. */
  cloudLyrics: boolean
  keepScreenOn: boolean
  /** Pause when wired headphones or Bluetooth audio disconnect. */
  playOnHeadset: boolean
  /** Swipe left/right on the player page to change tracks. */
  swipePlayer: boolean
  /** Swipe left/right between the four main tabs. */
  swipeTabs: boolean
  /** Publish the current lyric line to the system / lyricon consumers. */
  systemLyrics: boolean
  /** Include translations in the shared lyrics. */
  systemLyricsTranslation: boolean
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
  playbackRate: 1,
  downloadFilenameTemplate: '%t - %s',
  quality: '',
  showLyrics: true,
  cloudLyrics: true,
  keepScreenOn: true,
  playOnHeadset: true,
  swipePlayer: true,
  swipeTabs: true,
  systemLyrics: true,
  systemLyricsTranslation: true,
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
      Object.assign(settingsState, saved)
    }
  } catch {}
  applyTheme()
  persist()
}

function persist(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settingsState))
  } catch {}
}

export function updateSettings(patch: Partial<AppSettings>): void {
  Object.assign(settingsState, patch)
  persist()
  if (patch.theme || patch.accent || patch.lyricScale !== undefined) applyTheme()
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

export function applyAccent(): void {
  const accent = ACCENTS[settingsState.accent] ?? ACCENTS.green
  const root = document.documentElement
  root.style.setProperty('--brand', accent.brand)
  root.style.setProperty('--brand-strong', accent.strong)
  root.style.setProperty('--brand-soft', accent.soft)
  root.style.setProperty('--brand-softer', accent.softer)
}

export function applyLyricScale(): void {
  const scale = Math.max(0.8, Math.min(1.4, Number(settingsState.lyricScale) || 1))
  document.documentElement.style.setProperty('--lyric-scale', String(scale))
}

export function applyTheme(): void {
  const dark =
    settingsState.theme === 'dark' ||
    (settingsState.theme === 'system' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.classList.toggle('dark', dark)
  applyAccent()
  applyLyricScale()
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
