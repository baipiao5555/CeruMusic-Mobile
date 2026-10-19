import { reactive } from 'vue'
import { registerHostHooks } from './plugin/manager'

export interface AppSettings {
  theme: 'system' | 'light' | 'dark'
  quality: string
  showLyrics: boolean
  keepScreenOn: boolean
  playOnHeadset: boolean
}

const KEY = 'ceru.settings.v1'

export const settingsState = reactive<AppSettings>({
  theme: 'system',
  quality: '128k',
  showLyrics: true,
  keepScreenOn: true,
  playOnHeadset: true
})

export function restoreSettings(): void {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return
    Object.assign(settingsState, JSON.parse(raw))
  } catch {}
  applyTheme()
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
