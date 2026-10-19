import { reactive } from 'vue'
import { registerHostHooks } from './plugin/manager'

export interface AppSettings {
  theme: 'system' | 'light' | 'dark'
  /** Empty means automatic: use the highest quality the current track offers. */
  quality: string
  showLyrics: boolean
  keepScreenOn: boolean
  playOnHeadset: boolean
  version?: number
}

const KEY = 'ceru.settings.v1'

export const settingsState = reactive<AppSettings>({
  theme: 'system',
  quality: '',
  showLyrics: true,
  keepScreenOn: true,
  playOnHeadset: true,
  version: 2
})

export function restoreSettings(): void {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return
    const saved = JSON.parse(raw)
    if (saved && saved.version !== 2) {
      // v1 defaulted to 128k, which made plugins with higher tiers feel low.
      if (saved.quality === '128k') saved.quality = ''
      saved.version = 2
    }
    Object.assign(settingsState, saved)
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
  if (patch.theme) applyTheme()
}

export function applyTheme(): void {
  const dark =
    settingsState.theme === 'dark' ||
    (settingsState.theme === 'system' &&
      window.matchMedia?.('(prefers-color-scheme: dark)').matches)
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  document.documentElement.classList.toggle('dark', dark)
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
        updateSettings(allowed)
        return { ...settingsState }
      }
    }
  })
}
