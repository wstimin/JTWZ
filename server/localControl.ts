import { createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { config } from './config.js'

function isLoopbackRequest(request: IncomingMessage) {
  const address = request.socket.remoteAddress || ''
  return address === '127.0.0.1' || address === '::1' || address.startsWith('::ffff:127.')
}

function tokenMatches(supplied: string, purpose: string) {
  const expected = createHash('sha256').update(`${purpose}:${config.appSecret}`).digest('hex')
  const suppliedBuffer = Buffer.from(supplied)
  const expectedBuffer = Buffer.from(expected)
  return suppliedBuffer.length === expectedBuffer.length && timingSafeEqual(suppliedBuffer, expectedBuffer)
}

export function hasLocalControlAccess(request: IncomingMessage) {
  if (!isLoopbackRequest(request)) return false
  return tokenMatches(String(request.headers['x-jtwz-local-control-token'] || ''), 'jtwz-local-control-v1')
}

export function hasLocalUpdateAccess(request: IncomingMessage) {
  if (hasLocalControlAccess(request)) return true
  if (!isLoopbackRequest(request)) return false
  return tokenMatches(String(request.headers['x-jtwz-local-update-token'] || ''), 'jtwz-local-update-v1')
}
