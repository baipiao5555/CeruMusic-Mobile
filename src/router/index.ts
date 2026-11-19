import { createRouter, createWebHashHistory } from 'vue-router'
import { routeDirection } from './transition'
import Discover from '@/views/Discover.vue'
import Search from '@/views/Search.vue'
import Playlists from '@/views/Playlists.vue'
import Library from '@/views/Library.vue'
import Browse from '@/views/Browse.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'discover', component: Discover },
    { path: '/daily', name: 'daily', component: () => import('@/views/DailyRecommendations.vue') },
    { path: '/search', name: 'search', component: Search },
    { path: '/playlists', name: 'playlists', component: Playlists },
    { path: '/library', name: 'library', component: Library },
    { path: '/favorites', name: 'favorites', meta: { hideBottomNav: true }, component: () => import('@/views/CollectionDetail.vue') },
    { path: '/recent', name: 'recent', meta: { hideBottomNav: true }, component: () => import('@/views/CollectionDetail.vue') },
    { path: '/player', name: 'player', component: () => import('@/views/Player.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/Settings.vue') },
    { path: '/theme-background', name: 'theme-background', component: () => import('@/views/ThemeBackground.vue') },
    { path: '/accounts', redirect: '/cloud' },
    { path: '/sync-services', name: 'sync-services', component: () => import('@/views/SyncServices.vue') },
    { path: '/webdav-music', name: 'webdav-music', component: () => import('@/views/WebDavMusic.vue') },
    { path: '/plugins', name: 'plugins', component: () => import('@/views/Plugins.vue') },
    { path: '/cloud', name: 'cloud', component: () => import('@/views/CloudPlaylists.vue') },
    { path: '/downloads', name: 'downloads', component: () => import('@/views/Downloads.vue') },
    { path: '/local', name: 'local', component: () => import('@/views/LocalMusic.vue') },
    { path: '/update', name: 'update', component: () => import('@/views/Update.vue') },
    { path: '/logs', name: 'logs', component: () => import('@/views/Logs.vue') },
    { path: '/playlist/:id', name: 'playlist', component: () => import('@/views/PlaylistDetail.vue') },
    { path: '/browse', name: 'browse', component: Browse },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ]
})

// Old links still reach the collection without rendering an intermediate home.
router.beforeEach((to) => {
  if (to.path !== '/library') return
  const kind = to.query.section ?? to.query.view
  if (kind !== 'favorites' && kind !== 'recent') return
  const { section, view, ...query } = to.query
  return { path: kind === 'favorites' ? '/favorites' : '/recent', query }
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

// Search is now a secondary page; only the three root tabs use a cross-fade.
const TAB_ROUTES = new Set(['/', '/playlists', '/library'])
router.afterEach((to, from) => {
  if (TAB_ROUTES.has(to.path) && TAB_ROUTES.has(from.path)) {
    routeDirection.value = 'tab'
  }
})

export default router
