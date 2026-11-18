import { computed, ref, watch, type Ref } from 'vue'

/** 手机长列表先只渲染一段，滚动到末尾再追加；避免清空重排。 */
export const LIST_PAGE_SIZE = 120

export function useListWindow<T>(source: Ref<readonly T[]>, step = LIST_PAGE_SIZE) {
  const limit = ref(step)
  const items = computed(() => source.value.slice(0, limit.value))
  const hasMore = computed(() => limit.value < source.value.length)
  const remaining = computed(() => Math.max(0, source.value.length - limit.value))

  function showMore(): void {
    limit.value = Math.min(source.value.length, limit.value + step)
  }

  watch(source, () => {
    limit.value = step
  })

  return { items, hasMore, remaining, showMore }
}
