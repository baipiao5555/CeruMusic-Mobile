import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'discover', component: () => import('@/views/Discover.vue') },
    { path: '/search', name: 'search', component: () => import('@/views/Search.vue') },
    { path: '/library', name: 'library', component: () => import('@/views/Library.vue') },
    { path: '/player', name: 'player', component: () => import('@/views/Player.vue') },
    { path: '/settings', name: 'settings', component: () => import('@/views/Settings.vue') },
    { path: '/plugins', name: 'plugins', component: () => import('@/views/Plugins.vue') },
    { path: '/playlist/:id', name: 'playlist', component: () => import('@/views/PlaylistDetail.vue') },
    { path: '/browse', name: 'browse', component: () => import('@/views/Browse.vue') },
    { path: '/:pathMatch(.*)*', redirect: '/' }
  ],
  scrollBehavior() {
    return { top: 0 }
  }
})

export default router
