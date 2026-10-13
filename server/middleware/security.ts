import { timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { config } from '../config.js'
import { HttpError, parseCookies } from '../http.js'

export const stateMethods = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export function requestProtocol(request: IncomingMessage) {
  const forwarded = String(request.headers['x-forwarded-proto'] || '').split(',')[0].trim().toLowerCase()
  return forwarded === 'https' ? 'https' : 'http'
}

export function requestOrigin(request: IncomingMessage) {
  return `${requestProtocol(request)}://${request.headers.host || `${config.host}:${config.port}`}`
}

export function originAllowed(request: IncomingMessage, origin: string) {
  return origin.replace(/\/$/, '') === requestOrigin(request) || config.allowedOrigins.includes(origin.replace(/\/$/, ''))
}

export function applySecurityHeaders(request: IncomingMessage, response: ServerResponse) {
  response.setHeader('X-Content-Type-Options', 'nosniff')
  response.setHeader('X-Frame-Options', 'DENY')
  response.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  response.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()')
  response.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  response.setHeader('Cross-Origin-Resource-Policy', 'same-origin')
  response.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self' https: http:")
  if (requestProtocol(request) === 'https') response.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  const origin = request.headers.origin
  if (origin && originAllowed(request, origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin)
    response.setHeader('Access-Control-Allow-Credentials', 'true')
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-CSRF-Token, X-Request-Id')
    response.setHeader('Vary', 'Origin')
  }
}

export function checkOrigin(request: IncomingMessage) {
  if (!stateMethods.has(request.method || 'GET')) return
  const origin = request.headers.origin
  if (origin && !originAllowed(request, origin)) throw new HttpError(403, '请求来源未被允许')
  const fetchSite = String(request.headers['sec-fetch-site'] || '')
  if (fetchSite === 'cross-site') throw new HttpError(403, '跨站请求已被拒绝')
}

export function requireCsrf(request: IncomingMessage, expected: string) {
  if (!stateMethods.has(request.method || 'GET')) return
  const actual = String(request.headers['x-csrf-token'] || parseCookies(request).jtwz_csrf || '')
  const expectedBuffer = Buffer.from(expected)
  const actualBuffer = Buffer.from(actual)
  if (!actual || expectedBuffer.length !== actualBuffer.length || !timingSafeEqual(expectedBuffer, actualBuffer)) {
    throw new HttpError(403, '安全令牌无效，请刷新页面后重试')
  }
}

export function sessionCookie(request: IncomingMessage, token: string, maxAge: number) {
  const useSecure = config.cookieSecure === 'true' || (config.cookieSecure === 'auto' && requestProtocol(request) === 'https')
  return `${config.cookieName}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${useSecure ? '; Secure' : ''}`
}

export function csrfCookie(request: IncomingMessage, token: string, maxAge: number) {
  const useSecure = config.cookieSecure === 'true' || (config.cookieSecure === 'auto' && requestProtocol(request) === 'https')
  return `jtwz_csrf=${encodeURIComponent(token)}; Path=/; SameSite=Strict; Max-Age=${maxAge}${useSecure ? '; Secure' : ''}`
}
