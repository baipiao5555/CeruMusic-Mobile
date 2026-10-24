import { createRouter, createWebHashHistory } from 'vue-router'
import { routeDirection } from './transition'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'discover', component: () => import('@/views/Discover.vue') },
    { path: '/search', name: 'search', component: () => import('@/views/Search.vue') },
    { path: '/playlists', name: 'playlists', component: () => import('@/views/Playlists.vue') },
    { path: '/library', name: 'library', component: () => import('@/views/Library.vue') },
    { path: '/player', name: 'player', component: () => import('@/views/Player.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/Settings.vue') },
    { path: '/plugins', name: 'plugins', component: () => import('@/views/Plugins.vue') },
    { path: '/cloud', name: 'cloud', component: () => import('@/views/CloudPlaylists.vue') },
    { path: '/downloads', name: 'downloads', component: () => import('@/views/Downloads.vue') },
    { path: '/update', name: 'update', component: () => import('@/views/Update.vue') },
    { path: '/logs', name: 'logs', component: () => import('@/views/Logs.vue') },
    { path: '/playlist/:id', name: 'playlist', component: () => import('@/views/PlaylistDetail.vue') },
    { path: '/browse', name: 'browse', component: () => import('@/views/Browse.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ],
  scrollBehavior() {
    return { top: 0 }
  }
})

// Vue Router's hash history replaces state on every navigation, so
// history.state.position cannot tell back from forward. Track the intent at
// the call site instead; every in-app back button and Android back gesture
// goes through router.back().
const pushRoute = router.push.bind(router)
const replaceRoute = router.replace.bind(router)
const backRoute = router.back.bind(router)
const goRoute = router.go.bind(router)

router.push = ((...args: any[]) => {
  routeDirection.value = 'forward'
  return (pushRoute as any)(...args)
}) as typeof router.push
router.replace = ((...args: any[]) => {
  routeDirection.value = 'forward'
  return (replaceRoute as any)(...args)
}) as typeof router.replace
router.back = (() => {
  routeDirection.value = 'back'
  return backRoute()
}) as typeof router.back
router.go = ((delta: number) => {
  routeDirection.value = delta < 0 ? 'back' : 'forward'
  return goRoute(delta)
}) as typeof router.go

export default router
