import type { ServerResponse } from 'node:http'
import { config } from '../config.js'
import { audit, db } from '../db.js'
import { clientIp, HttpError, parseCookies, readJson, sendJson } from '../http.js'
import { csrfCookie, requireCsrf, sessionCookie } from '../middleware/security.js'
import { deleteSessionByTokenHash } from '../repositories/adminRepository.js'
import { publicAdmin, type AuthenticatedRequest } from '../securityTypes.js'
import {
  createAuthenticatedSession,
  createTwoFactorChallenge,
  getAuthenticatedAdmin,
  recordFailedLogin,
  verifyPrimaryCredentials,
  verifyTwoFactorChallenge,
} from '../services/authService.js'
import { hashToken } from '../auth.js'

const loginAttempts = new Map<string, { count: number; resetAt: number }>()

function enforceLoginLimit(request: AuthenticatedRequest, username: string) {
  const key = `${clientIp(request)}:${username.toLowerCase()}`
  const attempt = loginAttempts.get(key)
  if (attempt && attempt.resetAt <= Date.now()) loginAttempts.delete(key)
  else if (attempt && attempt.count >= 5) throw new HttpError(429, '登录尝试过多，请 15 分钟后再试')
  return key
}

function failedAttempt(key: string) {
  const current = loginAttempts.get(key)
  loginAttempts.set(key, { count: (current?.count || 0) + 1, resetAt: current?.resetAt || Date.now() + 15 * 60_000 })
}

function finishLogin(request: AuthenticatedRequest, response: ServerResponse, row: Record<string, unknown>) {
  const session = createAuthenticatedSession(row, request)
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now())
  response.setHeader('Set-Cookie', [sessionCookie(request, session.token, config.sessionDays * 24 * 60 * 60), csrfCookie(request, session.admin.csrfToken, config.sessionDays * 24 * 60 * 60)])
  audit(session.admin.id, 'login', 'session', session.admin.sessionId, `${session.admin.displayName} 登录`)
  sendJson(response, 200, { admin: publicAdmin(session.admin), csrfToken: session.admin.csrfToken, requiresTwoFactor: false })
}

export async function handleAuthRoutes(request: AuthenticatedRequest, response: ServerResponse, url: URL) {
  const method = request.method || 'GET'
  if (method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await readJson<{ username?: string; password?: string }>(request)
    const username = String(body.username || '').trim()
    const key = enforceLoginLimit(request, username)
    const row = verifyPrimaryCredentials(username, String(body.password || ''))
    if (!row) {
      failedAttempt(key)
      recordFailedLogin(username, request, '账号、密码或账号状态无效')
      throw new HttpError(401, '账号或密码错误')
    }
    loginAttempts.delete(key)
    if (row.totp_secret) {
      const challengeId = createTwoFactorChallenge(row, request)
      sendJson(response, 200, { requiresTwoFactor: true, challengeId })
      return true
    }
    finishLogin(request, response, row)
    return true
  }

  if (method === 'POST' && url.pathname === '/api/auth/two-factor') {
    const body = await readJson<{ challengeId?: string; code?: string }>(request)
    try {
      const row = verifyTwoFactorChallenge(String(body.challengeId || ''), String(body.code || '').trim())
      finishLogin(request, response, row)
    } catch (error) {
      recordFailedLogin('', request, error instanceof Error ? error.message : '二次验证失败')
      throw error
    }
    return true
  }

  if (method === 'POST' && url.pathname === '/api/auth/logout') {
    const admin = getAuthenticatedAdmin(request)
    if (admin) requireCsrf(request, admin.csrfToken)
    const token = parseCookies(request)[config.cookieName]
    if (token) deleteSessionByTokenHash(hashToken(token))
    if (admin) audit(admin.id, 'logout', 'session', admin.sessionId, `${admin.displayName} 退出登录`)
    response.setHeader('Set-Cookie', [sessionCookie(request, '', 0), csrfCookie(request, '', 0)])
    sendJson(response, 200, { ok: true })
    return true
  }

  if (method === 'GET' && url.pathname === '/api/auth/me') {
    const admin = getAuthenticatedAdmin(request)
    if (!admin) throw new HttpError(401, '请先登录管理后台')
    sendJson(response, 200, { admin: publicAdmin(admin), csrfToken: admin.csrfToken })
    return true
  }
  return false
}
