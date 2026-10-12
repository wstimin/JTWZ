import { apiUrl } from './appUrls'

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(apiUrl(path), {
    ...init,
    credentials: 'include',
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })

  const payload = await response.json().catch(() => ({})) as { error?: string }
  if (!response.ok) throw new ApiError(response.status, payload.error || `请求失败（${response.status}）`)
  return payload as T
}

export function apiJson<T>(path: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown) {
  return apiRequest<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) })
}

