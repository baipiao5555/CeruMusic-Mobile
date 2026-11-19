/**
 * Android 返回键的路由策略（纯函数，便于单测）。
 *
 * 根页面按「层级」返回：我的 → 歌单 → 音乐；
 * 音乐是最高层，连按两次才退出应用；搜索作为子页返回进入来源。
 * 其余页面（详情、设置、播放页等）交给浏览历史。
 */
export type BackAction =
  | { type: 'parent'; path: string }
  | { type: 'exit-confirm' }
  | { type: 'history' }
  | { type: 'home' }

export const TAB_BACK_PARENT: Record<string, string | undefined> = {
  '/library': '/playlists',
  '/playlists': '/'
}

export const EXIT_ROOT = '/'

export function resolveBackAction(path: string, hasHistoryBack: boolean): BackAction {
  if ((path === '/favorites' || path === '/recent') && !hasHistoryBack) {
    return { type: 'parent', path: '/library' }
  }
  if (path === EXIT_ROOT) return { type: 'exit-confirm' }
  const parent = TAB_BACK_PARENT[path]
  if (parent) return { type: 'parent', path: parent }
  return hasHistoryBack ? { type: 'history' } : { type: 'home' }
}
