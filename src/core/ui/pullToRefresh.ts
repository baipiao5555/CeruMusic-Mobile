import { computed, onBeforeUnmount, ref } from 'vue'

const TRIGGER_DISTANCE = 64
const MAX_DISTANCE = 96

/** Shared top-only pull gesture for pages that already have a real async loader. */
export function usePullToRefresh(refresh: () => Promise<void>) {
  const distance = ref(0)
  const refreshing = ref(false)
  const result = ref<'' | 'done' | 'error'>('')
  let startX = 0
  let startY = 0
  let tracking = false
  let horizontal = false
  let timer: ReturnType<typeof setTimeout> | undefined

  const message = computed(() => {
    if (refreshing.value) return '正在刷新…'
    if (result.value === 'done') return '已刷新'
    if (result.value === 'error') return '刷新失败，请重试'
    return distance.value >= TRIGGER_DISTANCE ? '松开刷新' : '下拉刷新'
  })
  const visible = computed(() => distance.value > 0 || refreshing.value || Boolean(result.value))

  function reset(): void {
    tracking = false
    horizontal = false
    distance.value = 0
  }

  function onTouchStart(event: TouchEvent): void {
    if (refreshing.value || event.touches.length !== 1) return
    const element = event.currentTarget as HTMLElement
    if (element.scrollTop > 0) return
    if (timer) clearTimeout(timer)
    startX = event.touches[0].clientX
    startY = event.touches[0].clientY
    tracking = true
    horizontal = false
    result.value = ''
  }

  function onTouchMove(event: TouchEvent): void {
    if (!tracking || refreshing.value || event.touches.length !== 1) return
    const dx = event.touches[0].clientX - startX
    const dy = event.touches[0].clientY - startY
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
      horizontal = true
      reset()
      return
    }
    if (horizontal) return
    const element = event.currentTarget as HTMLElement
    if (dy <= 0 || element.scrollTop > 0) {
      reset()
      return
    }
    distance.value = Math.min(MAX_DISTANCE, Math.round(dy * 0.5))
    if (distance.value > 2 && event.cancelable) event.preventDefault()
  }

  async function onTouchEnd(): Promise<void> {
    if (!tracking) return
    const shouldRefresh = distance.value >= TRIGGER_DISTANCE
    tracking = false
    if (!shouldRefresh) {
      reset()
      return
    }
    refreshing.value = true
    result.value = ''
    try {
      await refresh()
      result.value = 'done'
    } catch {
      result.value = 'error'
    } finally {
      refreshing.value = false
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        distance.value = 0
        result.value = ''
      }, 700)
    }
  }

  onBeforeUnmount(() => { if (timer) clearTimeout(timer) })
  return { distance, refreshing, result, message, visible, onTouchStart, onTouchMove, onTouchEnd, onTouchCancel: reset }
}
