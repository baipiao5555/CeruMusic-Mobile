/**
 * 返回键的第一拦截点。
 *
 * Android 的返回键由 App.vue 统一处理：先关弹层，主页再退出应用。
 * 全屏歌词这类「页内浮层」不在路由里，返回键本该先收起它，
 * 所以页面可以临时挂一个守卫；返回 true 表示这次返回已经被消费。
 */
type BackGuard = () => boolean

let guard: BackGuard | null = null

export function setBackGuard(next: BackGuard | null): void {
  guard = next
}

export function runBackGuard(): boolean {
  if (!guard) return false
  try {
    return guard()
  } catch {
    return false
  }
}
