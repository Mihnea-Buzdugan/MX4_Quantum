// src/utils/auth.ts
// JWT helpers: token storage, a fetch wrapper that attaches the access token
// and refreshes it automatically, and logout.

const ACCESS_KEY = 'access-token'
const REFRESH_KEY = 'refresh-token'

export type Tokens = { access: string; refresh: string }

class SessionExpiredError extends Error {}

// Backend base URL from .env, e.g. VITE_API_URL=http://localhost:5173
// (must include http:// or https://). Empty string = same origin as the page.
export const API_URL: string = ((import.meta.env.VITE_API_URL as string | undefined) ?? '').replace(/\/+$/, '')

// Prefixes a path like '/api/user/' with API_URL (absolute URLs are left alone).
export const apiUrl = (path: string): string => (/^https?:\/\//i.test(path) ? path : `${API_URL}${path}`)

export const getAccessToken = (): string | null => localStorage.getItem(ACCESS_KEY)
export const getRefreshToken = (): string | null => localStorage.getItem(REFRESH_KEY)

export function setTokens({ access, refresh }: Partial<Tokens>): void {
  if (access) localStorage.setItem(ACCESS_KEY, access)
  if (refresh) localStorage.setItem(REFRESH_KEY, refresh)
}

export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY)
  localStorage.removeItem(REFRESH_KEY)
}

// Reads the "exp" claim (in ms) from a JWT without verifying it.
function getExpiry(token: string): number {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    return JSON.parse(atob(payload)).exp * 1000
  } catch {
    return 0
  }
}

// Use this in route guards. The session is alive as long as the refresh token
// exists and has not expired.
export function isLoggedIn(): boolean {
  const refresh = getRefreshToken()
  return Boolean(refresh) && getExpiry(refresh as string) > Date.now()
}

let refreshPromise: Promise<string> | null = null

// Single-flight: if several requests get a 401 at once, only one refresh
// call is made (important because refresh tokens rotate and are single-use).
function refreshAccessToken(): Promise<string> {
  const refresh = getRefreshToken()
  if (!refresh) return Promise.reject(new SessionExpiredError())

  if (!refreshPromise) {
    refreshPromise = fetch(apiUrl('/api/token/refresh/'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh }),
    })
      .then(async (res) => {
        if (!res.ok) throw new SessionExpiredError()
        const data: Tokens = await res.json()
        setTokens(data) // stores the new access AND the rotated refresh token
        return data.access
      })
      .finally(() => {
        refreshPromise = null
      })
  }
  return refreshPromise
}

// Drop-in replacement for fetch() on authenticated endpoints:
//   const res = await authFetch('/api/something/', { method: 'POST', body: ... })
// The base URL (VITE_API_URL) is added automatically; pass paths like '/api/...'.
// No CSRF header and no `credentials: 'include'` needed anymore.
export async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const send = (token: string | null) => {
    const headers = new Headers(options.headers)
    if (token) headers.set('Authorization', `Bearer ${token}`)
    return fetch(apiUrl(url), { ...options, headers })
  }

  const res = await send(getAccessToken())
  if (res.status !== 401) return res

  try {
    const newAccess = await refreshAccessToken()
    return await send(newAccess)
  } catch (err) {
    if (err instanceof SessionExpiredError) {
      clearTokens()
      window.location.href = '/login'
      return res
    }
    throw err // network error etc.: keep the user logged in
  }
}

// Revokes the refresh token on the server, then clears local state.
// NOTE: adjust '/api/logout/' if your api/urls.py uses a different path.
export async function logout(): Promise<void> {
  const refresh = getRefreshToken()
  clearTokens()

  if (refresh) {
    try {
      await fetch(apiUrl('/api/logout/'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refresh }),
      })
    } catch (error) {
      console.error('Error during logout:', error)
    }
  }
}