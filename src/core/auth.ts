import { reactive } from 'vue'
import { Capacitor } from '@capacitor/core'
import { errorMessage, httpRequest } from './net'
import { External } from './native/plugins'

/**
 * 澜音账号（Logto OIDC + PKCE）。
 * 使用 auth.shiqianjiang.cn/oidc 发行者、公开客户端和三段式自定义回调。
 * token 的 audience 是 api.ceru.shiqianjiang.cn，用于读取桌面版上传的云歌单。
 */
const OIDC_ISSUER = 'https://auth.shiqianjiang.cn/oidc'
const OIDC_AUTHORIZE_ENDPOINT = OIDC_ISSUER + '/auth'
const OIDC_TOKEN_ENDPOINT = OIDC_ISSUER + '/token'
const OIDC_USERINFO_ENDPOINT = OIDC_ISSUER + '/me'
const APP_ID = 'pwp79ko18ykz9ir6acry7'
const REDIRECT_URI = 'cerumusic://login/callback'
const POST_LOGOUT_REDIRECT_URI = 'cerumusic://logout/callback'
const API_RESOURCE = 'https://api.ceru.shiqianjiang.cn/api'
const SCOPES = 'openid profile offline_access ceru:read'
const STORAGE_KEY = 'ceru.auth.oidc.v2'
const PENDING_KEY = 'ceru.auth.pending.oidc.v2'
const LEGACY_KEYS = ['ceru.auth.v1', 'ceru.auth.pending.v1']
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
let sessionVersion = 0
let callbackInFlight: { url: string; promise: Promise<AuthUser | null> } | null = null
let completedCallback = ''

/** Async cloud/login work must discard results when the account lifecycle changes. */
export function getAuthSessionVersion(): number { return sessionVersion }

function invalidateSession(): number {
  refreshing = null
  authState.loading = false
  return ++sessionVersion
}

function assertSessionVersion(version: number): void {
  if (version !== sessionVersion) throw new Error('账号状态已变化，已取消旧登录请求')
}

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
  return userFromClaims(claims)
}

function userFromClaims(claims: any): AuthUser | null {
  if (!claims || typeof claims !== 'object' || !claims.sub) return null
  return {
    sub: String(claims.sub),
    name: typeof claims.name === 'string' ? claims.name : undefined,
    username: typeof (claims.username ?? claims.preferred_username) === 'string'
      ? claims.username ?? claims.preferred_username : undefined,
    nickname: typeof claims.nickname === 'string' ? claims.nickname : undefined,
    picture: typeof claims.picture === 'string' ? claims.picture : undefined,
    email: typeof claims.email === 'string' ? claims.email : undefined
  }
}

function mergeUser(primary: AuthUser | null, fallback: AuthUser | null): AuthUser | null {
  if (!primary) return fallback
  if (!fallback) return primary
  if (primary.sub !== fallback.sub) return fallback
  const merged: AuthUser = { ...fallback }
  for (const key of ['name', 'username', 'nickname', 'picture', 'email'] as const) {
    if (primary[key]) merged[key] = primary[key]
  }
  return merged
}

async function fetchUserInfo(accessToken: string): Promise<AuthUser | null> {
  try {
    const response = await httpRequest({
      url: OIDC_USERINFO_ENDPOINT,
      headers: { Accept: 'application/json', Authorization: 'Bearer ' + accessToken },
      responseType: 'json'
    })
    if (response.status < 200 || response.status >= 300) return null
    return userFromClaims(response.data)
  } catch {
    // ID token claims remain a safe fallback when UserInfo is temporarily unavailable.
    return null
  }
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const body = new URLSearchParams(params).toString()
  const response = await httpRequest({
    url: OIDC_TOKEN_ENDPOINT,
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    responseType: 'json'
  })
  if (response.status < 200 || response.status >= 300) {
    throw new Error(errorMessage(response.data, '登录失败，请稍后重试'))
  }
  if (!response.data || typeof response.data.access_token !== 'string' || !response.data.access_token) {
    throw new Error('登录服务没有返回有效凭据，请重新登录')
  }
  return response.data as TokenResponse
}

async function applyTokens(tokens: TokenResponse): Promise<void> {
  const expiresAt = Date.now() + Math.max(60, tokens.expires_in ?? 3600) * 1000 - REFRESH_MARGIN
  const idTokenUser = userFromIdToken(tokens.id_token)
  const userInfo = await fetchUserInfo(tokens.access_token)
  const user = mergeUser(userInfo, idTokenUser) ?? session?.user ?? null
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
  const version = sessionVersion, refreshToken = session.refreshToken
  refreshing = (async () => {
    try {
      const tokens = await tokenRequest({
        grant_type: 'refresh_token',
        client_id: APP_ID,
        refresh_token: refreshToken,
        resource: API_RESOURCE
      })
      assertSessionVersion(version)
      await applyTokens(tokens)
      return session!.accessToken
    } catch (error) {
      if (version === sessionVersion) clearSession()
      throw error
    } finally {
      if (version === sessionVersion) refreshing = null
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
  invalidateSession()
  session = null
  authState.authenticated = false
  authState.user = null
  persist()
}

function restoreSession(): void {
  try {
    for (const key of LEGACY_KEYS) localStorage.removeItem(key)
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return
    const saved = JSON.parse(raw) as StoredSession
    if (!saved?.accessToken) return
    invalidateSession()
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
  const url = new URL(OIDC_AUTHORIZE_ENDPOINT)
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

/** Standard RP-initiated logout URL for the registered post-logout callback. */
export function buildLogoutUrl(idTokenHint = ''): string {
  const url = new URL(OIDC_ISSUER + '/session/end')
  url.searchParams.set('client_id', APP_ID)
  url.searchParams.set('post_logout_redirect_uri', POST_LOGOUT_REDIRECT_URI)
  if (idTokenHint) url.searchParams.set('id_token_hint', idTokenHint)
  return url.toString()
}

/** Opens the Logto sign-in page in the system browser. */
export async function login(): Promise<void> {
  completedCallback = ''
  authState.error = ''
  const version = invalidateSession()
  const verifier = base64Url(randomBytes(48))
  const state = base64Url(randomBytes(24))
  const nonce = base64Url(randomBytes(24))
  const challenge = await codeChallenge(verifier)
  assertSessionVersion(version)
  try {
    localStorage.setItem(PENDING_KEY, JSON.stringify({ verifier, state, nonce, createdAt: Date.now() }))
  } catch {
    authState.error = '无法保存登录请求，请释放本地存储后重试'
    throw new Error(authState.error)
  }
  const url = buildAuthorizeUrl(challenge, state, nonce)
  if (Capacitor.isNativePlatform()) {
    let authResult: { url?: string; cancelled?: boolean } | null = null
    try {
      authResult = await External.openAuth({ url })
    } catch {
      authResult = null
    }
    if (!authResult) {
      // Older native builds have no in-app OAuth activity; keep the browser fallback.
      await External.open({ url })
      return
    }
    if (authResult.cancelled) return
    if (authResult.url) await exchangeAuthCallback(authResult.url)
  } else {
    window.location.href = url
  }
}

/** Handles cerumusic://login/callback?code=... after the authorization redirect. */
export function handleAuthCallback(rawUrl: string): Promise<AuthUser | null> {
  if (callbackInFlight?.url === rawUrl) return callbackInFlight.promise
  if (completedCallback === rawUrl && authState.authenticated) return Promise.resolve(authState.user)
  const operation = { url: rawUrl, promise: Promise.resolve(null) as Promise<AuthUser | null> }
  operation.promise = exchangeAuthCallback(rawUrl).then(user => {
    if (authState.authenticated) completedCallback = rawUrl
    return user
  }).catch(error => {
    if (callbackInFlight === operation) authState.error = error?.message || '登录失败'
    throw error
  }).finally(() => { if (callbackInFlight === operation) callbackInFlight = null })
  callbackInFlight = operation
  return operation.promise
}

async function exchangeAuthCallback(rawUrl: string): Promise<AuthUser | null> {
  let parsed: URL
  try {
    parsed = new URL(rawUrl)
  } catch {
    throw new Error('登录回调地址无效')
  }
  if (parsed.protocol !== 'cerumusic:' || parsed.host !== 'login' || parsed.pathname !== '/callback') return null
  const params = parsed.searchParams
  const hashParams = new URLSearchParams(parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash)
  const error = params.get('error') ?? hashParams.get('error')
  if (error) {
    const description = params.get('error_description') || hashParams.get('error_description') || error
    authState.error = description
    throw new Error(description)
  }
  const code = params.get('code') ?? hashParams.get('code')
  if (!code) return null

  let pending: { verifier: string; state: string; nonce: string; createdAt: number } | null = null
  try {
    pending = JSON.parse(localStorage.getItem(PENDING_KEY) ?? 'null')
  } catch {}
  // A recreated Activity can redeliver an already-consumed login intent.
  // With no pending authorization, preserve the existing session without another token exchange.
  if (!pending && authState.authenticated) return authState.user
  if (!pending || !Number.isFinite(pending.createdAt) || Date.now() - pending.createdAt > PENDING_TTL) {
    throw new Error('登录请求已过期，请重新登录')
  }
  const state = params.get('state') ?? hashParams.get('state') ?? ''
  if (state !== pending.state) throw new Error('登录状态校验失败，请重新登录')

  const version = sessionVersion
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
    assertSessionVersion(version)
    const claims = tokens.id_token ? decodeJwtPayload(tokens.id_token) : null
    if (claims?.iss && claims.iss !== OIDC_ISSUER) {
      throw new Error('登录签发方不匹配，请重新登录')
    }
    if (claims?.nonce && claims.nonce !== pending.nonce) {
      throw new Error('登录校验失败，请重新登录')
    }
    invalidateSession()
    session = null
    await applyTokens(tokens)
    try {
      localStorage.removeItem(PENDING_KEY)
    } catch {}
    return authState.user
  } finally {
    if (version === sessionVersion) authState.loading = false
  }
}

export function logout(): void {
  completedCallback = ''
  clearSession()
  try {
    localStorage.removeItem(PENDING_KEY)
    for (const key of LEGACY_KEYS) localStorage.removeItem(key)
  } catch {}
}

export function displayName(user: AuthUser | null = authState.user): string {
  if (!user) return '澜音账号'
  return user.nickname || user.name || user.username || user.email || '澜音用户'
}
