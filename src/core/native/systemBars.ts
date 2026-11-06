import { Capacitor, registerPlugin } from '@capacitor/core'

interface SystemBarsPlugin {
  getInsets(): Promise<{ top: number; bottom: number }>
  setNavigationBar(options: { color: string; darkIcons: boolean }): Promise<void>
  getTheme(): Promise<{ dark: boolean }>
  addListener(
    eventName: 'themeChanged',
    listener: (data: { dark: boolean }) => void
  ): Promise<{ remove: () => Promise<void> }>
}

const SystemBars = registerPlugin<SystemBarsPlugin>('SystemBars')

export async function applySystemInsets(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const insets = await SystemBars.getInsets()
    const root = document.documentElement
    const top = Math.max(0, Math.round(insets?.top ?? 0))
    const bottom = Math.max(0, Math.round(insets?.bottom ?? 0))
    // 启动瞬间 WindowInsets 往往还是 0，此时若把 0 写进 --safe-top，
    // 状态栏高度就永远补不回来，页面标题会压在系统时间上。只在量到正值时才写。
    if (top > 0) {
      root.style.setProperty('--safe-top', `${top}px`)
      root.classList.add('insets-ready')
    }
    if (bottom > 0) {
      root.style.setProperty('--safe-bottom', `${bottom}px`)
    }
  } catch {
    // 插件尚未就绪时保留 CSS env() 的默认值，后续调用会接管
  }
}

/** 系统导航栏跟随应用明暗主题，避免深色界面下露出一条浅色底。 */
export async function applyNavigationBar(darkTheme: boolean): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    await SystemBars.setNavigationBar({
      color: darkTheme ? '#0B1210' : '#F8FCFA',
      darkIcons: !darkTheme
    })
  } catch {
    // 旧机型不支持浅色导航栏图标时忽略
  }
}

/** Native night-mode state. Android WebView does not reliably update prefers-color-scheme. */
export async function getNativeTheme(): Promise<boolean | null> {
  if (!Capacitor.isNativePlatform()) return null
  try {
    const result = await SystemBars.getTheme()
    return Boolean(result?.dark)
  } catch {
    return null
  }
}

export function onNativeThemeChange(handler: (dark: boolean) => void): void {
  if (!Capacitor.isNativePlatform()) return
  void SystemBars.addListener('themeChanged', (data) => handler(Boolean(data?.dark))).catch(
    () => undefined
  )
}

/** 启动时立即测量一次，并在旋转、软键盘弹出等尺寸变化后重新测量。 */
export function initSystemInsets(): void {
  if (!Capacitor.isNativePlatform()) return
  if (Capacitor.getPlatform() === 'android') {
    document.documentElement.classList.add('native-android')
  }
  // 首帧之后 WindowInsets 才可用，多测几次直到拿到正值。
  for (const delay of [0, 240, 600, 1200, 2400]) {
    window.setTimeout(() => void applySystemInsets(), delay)
  }
  window.addEventListener('resize', () => void applySystemInsets())
  window.addEventListener('orientationchange', () => void applySystemInsets())
  document.addEventListener('deviceready', () => void applySystemInsets(), { once: true })
}
