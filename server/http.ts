import type { IncomingMessage, ServerResponse } from 'node:http'

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(payload))
}

export function sendHtml(response: ServerResponse, status: number, html: string) {
  response.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8' })
  response.end(html)
}

export async function readJson<T>(request: IncomingMessage, limit = 1024 * 1024): Promise<T> {
  const chunks: Buffer[] = []
  let length = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    length += buffer.length
    if (length > limit) throw new HttpError(413, '请求内容过大')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {} as T
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as T
  } catch {
    throw new HttpError(400, 'JSON 格式不正确')
  }
}

export function parseCookies(request: IncomingMessage) {
  const cookies: Record<string, string> = {}
  for (const part of (request.headers.cookie || '').split(';')) {
    const index = part.indexOf('=')
    if (index < 0) continue
    cookies[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim())
  }
  return cookies
}

export function clientIp(request: IncomingMessage) {
  const forwarded = request.headers['x-forwarded-for']
  if (typeof forwarded === 'string') return forwarded.split(',')[0].trim()
  return request.socket.remoteAddress || 'unknown'
}

