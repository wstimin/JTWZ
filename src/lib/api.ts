import { apiUrl } from './appUrls'

export const authExpiredEvent = 'jtwz:auth-expired'
let csrfToken = ''

export function setCsrfToken(value: string) {
  csrfToken = value
}

export function csrfHeaders(headers: HeadersInit = {}) {
  return { ...Object.fromEntries(new Headers(headers).entries()), ...(csrfToken ? { 'X-CSRF-Token': csrfToken } : {}) }
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = String(init.method || 'GET').toUpperCase()
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
      ...(method !== 'GET' && method !== 'HEAD' && csrfToken ? { 'X-CSRF-Token': csrfToken } : {}),
    },
  })

  const payload = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) {
    const isAuthenticationProbe = path === '/api/auth/login' || path === '/api/auth/me'
    if (response.status === 401 && !isAuthenticationProbe) {
      window.dispatchEvent(new CustomEvent(authExpiredEvent, { detail: { path } }))
      throw new ApiError(401, '登录状态已失效，请重新登录')
    }
    throw new ApiError(response.status, payload.error || `请求失败（${response.status}）`)
  }
  if (typeof (payload as { csrfToken?: unknown }).csrfToken === 'string') setCsrfToken(String((payload as { csrfToken: string }).csrfToken))
  return payload as T
}

export function apiJson<T>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) {
  return apiRequest<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
}

