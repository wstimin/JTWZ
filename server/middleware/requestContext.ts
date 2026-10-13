import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

export type RequestContext = { requestId: string; ipAddress: string }

const storage = new AsyncLocalStorage<RequestContext>()
const sensitivePattern = /(password|secret|token|authorization|cookie|recovery|totp|api[_-]?key)/i

export function requestId(request: IncomingMessage) {
  const supplied = String(request.headers['x-request-id'] || '').trim()
  return /^[A-Za-z0-9._:-]{8,128}$/.test(supplied) ? supplied : randomUUID()
}

export function requestIp(request: IncomingMessage) {
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim().slice(0, 120)
  return String(request.socket.remoteAddress || 'unknown').slice(0, 120)
}

export function runWithRequestContext<T>(request: IncomingMessage, response: ServerResponse, callback: () => T) {
  const context = { requestId: requestId(request), ipAddress: requestIp(request) }
  response.setHeader('X-Request-Id', context.requestId)
  return storage.run(context, callback)
}

export function currentRequestContext() {
  return storage.getStore() || { requestId: '', ipAddress: '' }
}

export function redactSensitive(value: unknown, key = ''): unknown {
  if (sensitivePattern.test(key)) return '[REDACTED]'
  if (Array.isArray(value)) return value.map((item) => redactSensitive(item))
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [entryKey, redactSensitive(entryValue, entryKey)]))
  }
  if (typeof value === 'string') {
    return value
      .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1[REDACTED]')
      .replace(/([?&](?:token|secret|key|signature)=)[^&\s]+/gi, '$1[REDACTED]')
  }
  return value
}

export function safeAuditDetail(detail: string) {
  return String(redactSensitive(detail)).slice(0, 1000)
}
