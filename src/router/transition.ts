import { ref } from 'vue'

export type RouteDirection = 'forward' | 'back' | 'tab'

/** Direction of the latest route change, used by the page transition. */
export const routeDirection = ref<RouteDirection>('forward')
