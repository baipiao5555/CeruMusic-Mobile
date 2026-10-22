import { reactive } from 'vue'
import { Capacitor } from '@capacitor/core'
import { errorMessage, httpRequest } from './net'
import { External } from './native/plugins'

/**
 * 澜音账号（Logto OAuth 2.0 + PKCE）。
 * 与桌面版共用同一个 Logto 应用和回调地址，token 的 audience 是
 * api.ceru.shiqianjiang.cn，所以手机端登录后可以读写桌面版上传的云歌单。
 */
const AUTH_ENDPOINT = 'https://auth.shiqianjiang.cn/'
const APP_ID = '2a22nn23flw9nyrwi6jw9'
const REDIRECT_URI = 'cerumusic://oauth/callback'
const API_RESOURCE = 'https://api.ceru.shiqianjiang.cn/api'
const SCOPES = 'openid profile offline_access'
const STORAGE_KEY = 'ceru.auth.v1'
const PENDING_KEY = 'ceru.auth.pending.v1'
const PENDING_TTL = 15 * 60 * 1000
const REFRESH_MARGIN = 60 * 1000

export interface AuthUser {
  sub: string
  name?: string
  username?: string
  nickname?: string
  picture?: string
  email?: string
}

interface TokenResponse {
  access_token: string
  refresh_token?: string
  id_token?: string
  expires_in?: number
  token_type?: string
}

interface StoredSession {
  accessToken: string
  refreshToken?: string
  idToken?: string
  expiresAt: number
  user: AuthUser | null
}

export const authState = reactive({
  initialized: false,
  loading: false,
  authenticated: false,
  user: null as AuthUser | null,
  error: ''
})

let session: StoredSession | null = null
let refreshing: Promise<string> | null = null

function persist(): void {
  try {
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
    else localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  return bytes
}

function base64Url(bytes: Uint8Array | ArrayBuffer): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let binary = ''
  for (const byte of view) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function codeChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return base64Url(digest)
}

function decodeJwtPayload(token: string): any {
  try {
    const payload = token.split('.')[1]
    if (!payload) return null
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const binary = atob(padded)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
    return JSON.parse(new TextDecoder().decode(bytes))
  } catch {
    return null
  }
}

function userFromIdToken(idToken?: string): AuthUser | null {
  if (!idToken) return null
  const claims = decodeJwtPayload(idToken)
  if (!claims?.sub) return null
  return {
    sub: String(claims.sub),
    name: claims.name ?? undefined,
    username: claims.username ?? undefined,
    nickname: claims.nickname ?? undefined,
    picture: claims.picture ?? undefined,
    email: claims.email ?? undefined
  }
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams(params).toString()
  const response = await httpRequest({
    url: AUTH_ENDPOINT + 'oidc/token',
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    responseType: 'json'
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(errorMessage(response.data, '登录失败，请稍后重试'))
  }
  return response.data as TokenResponse
}

function applyTokens(tokens: TokenResponse): void {
  const expiresAt = Date.now() + Math.max(60, tokens.expires_in ?? 3600) * 1000 - REFRESH_MARGIN
  const user = userFromIdToken(tokens.id_token) ?? session?.user ?? null
  session = {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token ?? session?.refreshToken,
    idToken: tokens.id_token ?? session?.idToken,
    expiresAt,
    user
  }
  authState.authenticated = true
  authState.user = user
  authState.error = ''
  persist()
}

async function refreshSession(): Promise<string> {
  if (!session?.refreshToken) throw new Error('登录已过期，请重新登录')
  if (refreshing) return refreshing
  refreshing = (async () => {
    try {
      const tokens = await tokenRequest({
        grant_type: 'refresh_token',
        client_id: APP_ID,
        refresh_token: session!.refreshToken!,
        resource: API_RESOURCE
      })
      applyTokens(tokens)
      return session!.accessToken
    } catch (error) {
      clearSession()
      throw error
    } finally {
      refreshing = null
    }
  })()
  return refreshing
}

export async function getAccessToken(): Promise<string> {
  if (!session?.accessToken) {
    if (session?.refreshToken) return refreshSession()
    throw new Error('请先登录澜音账号')
  }
  if (Date.now() >= session.expiresAt) return refreshSession()
  return session.accessToken
}

function clearSession(): void {
  session = null
  authState.authenticated = false
  authState.user = null
  persist()
}

function restoreSession(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw) as StoredSession
    if (!saved?.accessToken) return
    session = saved
    authState.authenticated = true
    authState.user = saved.user ?? userFromIdToken(saved.idToken)
  } catch {
    clearSession()
  }
}

// Restore synchronously so the first render already knows the login state.
restoreSession()

export async function initAuth(): Promise<void> {
  if (authState.initialized) return
  authState.initialized = true
  if (!session) {
    restoreSession()
    return
  }
  if (Date.now() >= session.expiresAt - REFRESH_MARGIN && session.refreshToken) {
    try {
      await refreshSession()
    } catch (error) {
      console.warn('刷新登录状态失败:', error)
    }
  }
}

/** Exported for the browser test harness in scripts/. @public */
export function buildAuthorizeUrl(challenge: string, state: string, nonce: string): string {
  const url = new URL('oidc/auth', AUTH_ENDPOINT)
  url.searchParams.set('client_id', APP_ID)
  url.searchParams.set('redirect_uri', REDIRECT_URI)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('scope', SCOPES)
  url.searchParams.set('code_challenge', challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', state)
  url.searchParams.set('nonce', nonce)
  url.searchParams.set('resource', API_RESOURCE)
  return url.toString()
}

/** Opens the Logto sign-in page in the system browser. */
export async function login(): Promise<void> {
  authState.error = ''
  const verifier = base64Url(randomBytes(48))
  const state = base64Url(randomBytes(24))
  const nonce = base64Url(randomBytes(24))
  const challenge = await codeChallenge(verifier)
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, nonce, createdAt: Date.now() }))
  } catch {}
  const url = buildAuthorizeUrl(challenge, state, nonce)
  if (Capacitor.isNativePlatform()) {
    await External.open({ url })
  } else {
    window.location.href = url
  }
}

/** Handles cerumusic://oauth/callback?code=... after the browser redirects back. */
export async function handleAuthCallback(rawUrl: string): Promise<AuthUser | null> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('登录回调地址无效')
  }
  if (parsed.protocol !== 'cerumusic:' || parsed.host !== 'oauth') return null
  const params = parsed.searchParams
  const error = params.get('error')
  if (error) {
    const description = params.get('error_description') || error
    authState.error = description
    throw new Error(description)
  }
  const code = params.get('code')
  if (!code) return null

  let pending: { verifier: string; state: string; nonce: string; createdAt: number } | null = null
  try {
    pending = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null')
  } catch {}
  if (!pending || Date.now() - pending.createdAt > PENDING_TTL) {
    throw new Error('登录请求已过期，请重新登录')
  }
  const state = params.get('state') ?? ''
  if (state !== pending.state) throw new Error('登录状态校验失败，请重新登录')

  authState.loading = true
  try {
    const tokens = await tokenRequest({
      grant_type: 'authorization_code',
      client_id: APP_ID,
      code,
      redirect_uri: REDIRECT_URI,
      code_verifier: pending.verifier,
      resource: API_RESOURCE
    })
    const claims = tokens.id_token ? decodeJwtPayload(tokens.id_token) : null
    if (claims?.nonce && claims.nonce !== pending.nonce) {
      throw new Error('登录校验失败，请重新登录')
    }
    applyTokens(tokens)
    try {
      localStorage.removeItem(PENDING_KEY)
    } catch {}
    return authState.user
  } finally {
    authState.loading = false
  }
}

export function logout(): void {
  clearSession()
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {}
}

export function displayName(user: AuthUser | null = authState.user): string {
  if (!user) return '澜音账号'
  return user.nickname || user.name || user.username || user.email || '澜音用户'
}
