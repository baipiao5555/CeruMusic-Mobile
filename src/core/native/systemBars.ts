import { Capacitor, registerPlugin } from '@capacitor/core'

interface SystemBarsPlugin {
  getInsets(): Promise<{ top: number; bottom: number }>
  setNavigationBar(options: { color: string; darkIcons: boolean }): Promise<void>
}

const SystemBars = registerPlugin<SystemBarsPlugin>('SystemBars')

export async function applySystemInsets(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return
  try {
    const insets = await SystemBars.getInsets()
    document.documentElement.style.setProperty('--safe-top', `${Math.max(0, insets.top)}px`)
    document.documentElement.style.setProperty('--safe-bottom', `${Math.max(0, insets.bottom)}px`)
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

/** 启动时立即测量一次，并在旋转、软键盘弹出等尺寸变化后重新测量。 */
export function initSystemInsets(): void {
  if (!Capacitor.isNativePlatform()) return
  void applySystemInsets()
  window.addEventListener('resize', () => void applySystemInsets())
  window.addEventListener('orientationchange', () => void applySystemInsets())
  document.addEventListener('deviceready', () => void applySystemInsets(), { once: true })
}
