import { ref } from 'vue'
import type { RouteLocationRaw, Router } from 'vue-router'

/**
 * 用户主动从搜索入口打开搜索页时，转场结束后再聚焦输入框。
 * 焦点不能跟着组件挂载走：首次进入时页面还在移动，缓存页则根本不会重新挂载。
 */
let pendingFocus = false
export const searchEntryFocusEpoch = ref(0)

export function requestSearchEntryFocus(): void {
  pendingFocus = true
}

export function cancelSearchEntryFocus(): void {
  pendingFocus = false
}

export function completeSearchEntryTransition(): void {
  if (!pendingFocus) return
  pendingFocus = false
  searchEntryFocusEpoch.value += 1
}

/** 所有显式“去搜索”按钮共用一次性的编辑意图；插件带 query 的导航不调用。 */
export function openSearch(router: Router, to: RouteLocationRaw = '/search'): void {
  requestSearchEntryFocus()
  void router.push(to)
}
