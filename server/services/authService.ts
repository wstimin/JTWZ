import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { createSessionToken, hashToken, verifyPassword } from '../auth.js'
import { config } from '../config.js'
import { HttpError, parseCookies } from '../http.js'
import { currentRequestContext } from '../middleware/requestContext.js'
import { requestIp } from '../middleware/requestContext.js'
import { notifyAlert } from '../notifications.js'
import {
  consumeRecoveryCode,
  createLoginChallenge,
  createSession,
  deleteLoginChallenge,
  deleteSessionByTokenHash,
  findAdminById,
  findAdminByUsername,
  findLoginChallenge,
  findSessionByTokenHash,
  hasSeenDevice,
  incrementChallengeAttempts,
  markLogin,
  recordLoginEvent,
  setPendingTotpSecret,
  touchSession,
  type Row,
} from '../repositories/adminRepository.js'
import { adminRoles, permissionsForRole, type AdminRole, type AuthenticatedAdmin } from '../securityTypes.js'

const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Encode(input: Buffer) {
  let bits = 0
  let value = 0
  let output = ''
  for (const byte of input) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31]
  return output
}

function base32Decode(input: string) {
  let bits = 0
  let value = 0
  const output: number[] = []
  for (const character of input.toUpperCase().replace(/[^A-Z2-7]/g, '')) {
    const index = alphabet.indexOf(character)
    if (index < 0) continue
    value = (value << 5) | index
    bits += 5
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255)
      bits -= 8
    }
  }
  return Buffer.from(output)
}

function encryptionKey() {
  return createHash('sha256').update(config.appSecret).digest()
}

export function encryptSecret(secret: string) {
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv)
  const encrypted = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()])
  return `${iv.toString('base64url')}.${cipher.getAuthTag().toString('base64url')}.${encrypted.toString('base64url')}`
}

export function decryptSecret(payload: string) {
  const [ivValue, tagValue, encryptedValue] = payload.split('.')
  if (!ivValue || !tagValue || !encryptedValue) throw new Error('2FA 密钥格式无效')
  const decipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(ivValue, 'base64url'))
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8')
}

export function generateTotpSecret() {
  return base32Encode(randomBytes(20))
}

function totpAt(secret: string, counter: number) {
  const buffer = Buffer.alloc(8)
  buffer.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest()
  const offset = digest[digest.length - 1] & 15
  const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255)
  return String(binary % 1_000_000).padStart(6, '0')
}

export function verifyTotp(secret: string, code: string) {
  if (!/^\d{6}$/.test(code)) return false
  const counter = Math.floor(Date.now() / 30_000)
  return [-1, 0, 1].some((offset) => {
    const expected = Buffer.from(totpAt(secret, counter + offset))
    const actual = Buffer.from(code)
    return expected.length === actual.length && timingSafeEqual(expected, actual)
  })
}

export function generateRecoveryCodes() {
  return Array.from({ length: 8 }, () => `${randomBytes(3).toString('hex').toUpperCase()}-${randomBytes(3).toString('hex').toUpperCase()}`)
}

export function hashRecoveryCode(code: string) {
  return createHash('sha256').update(code.trim().toUpperCase()).digest('hex')
}

export function deviceName(userAgent: string) {
  const platform = /Windows/i.test(userAgent) ? 'Windows' : /Android/i.test(userAgent) ? 'Android' : /iPhone|iPad/i.test(userAgent) ? 'iOS' : /Macintosh/i.test(userAgent) ? 'macOS' : /Linux/i.test(userAgent) ? 'Linux' : '未知系统'
  const browser = /Edg\//i.test(userAgent) ? 'Edge' : /Chrome\//i.test(userAgent) ? 'Chrome' : /Firefox\//i.test(userAgent) ? 'Firefox' : /Safari\//i.test(userAgent) ? 'Safari' : /curl/i.test(userAgent) ? '命令行' : '未知客户端'
  return `${platform} · ${browser}`
}

function roleOf(value: unknown): AdminRole {
  return adminRoles.includes(value as AdminRole) ? value as AdminRole : 'analyst'
}

function authenticatedAdmin(row: Row): AuthenticatedAdmin {
  const role = roleOf(row.role)
  return {
    id: String(row.admin_id || row.id),
    username: String(row.username),
    displayName: String(row.display_name || row.username),
    role,
    permissions: permissionsForRole(role),
    twoFactorEnabled: Boolean(row.totp_secret),
    sessionId: String(row.session_id || row.id),
    csrfToken: String(row.csrf_token || ''),
  }
}

export function getAuthenticatedAdmin(request: IncomingMessage) {
  const token = parseCookies(request)[config.cookieName]
  if (!token) return null
  const row = findSessionByTokenHash(hashToken(token))
  if (!row || String(row.status) !== 'active') return null
  if (Number(row.expires_at) <= Date.now()) {
    deleteSessionByTokenHash(hashToken(token))
    return null
  }
  const lastSeen = Date.parse(String(row.last_seen_at || row.created_at))
  if (!Number.isFinite(lastSeen) || Date.now() - lastSeen > 60_000) touchSession(String(row.id))
  return authenticatedAdmin({ ...row, session_id: row.id })
}

export function verifyPrimaryCredentials(username: string, password: string) {
  const row = findAdminByUsername(username)
  if (!row || String(row.status) !== 'active' || !verifyPassword(password, String(row.password_hash))) return null
  return row
}

export function createTwoFactorChallenge(row: Row, request: IncomingMessage) {
  const context = currentRequestContext()
  return createLoginChallenge({ adminId: String(row.id), ipAddress: requestIp(request), userAgent: String(request.headers['user-agent'] || '').slice(0, 500), requestId: context.requestId })
}

export function verifyTwoFactorChallenge(challengeId: string, code: string) {
  const row = findLoginChallenge(challengeId)
  if (!row || Number(row.expires_at) <= Date.now() || Number(row.attempts) >= 5 || String(row.status) !== 'active') {
    if (row) deleteLoginChallenge(challengeId)
    throw new HttpError(401, '二次验证已失效，请重新登录')
  }
  incrementChallengeAttempts(challengeId)
  let valid = verifyTotp(decryptSecret(String(row.totp_secret)), code)
  if (!valid) {
    const hashes = JSON.parse(String(row.recovery_codes || '[]')) as string[]
    const suppliedHash = hashRecoveryCode(code)
    const index = hashes.indexOf(suppliedHash)
    if (index >= 0) {
      valid = consumeRecoveryCode(String(row.admin_id), suppliedHash, hashes.filter((_, itemIndex) => itemIndex !== index))
    }
  }
  if (!valid) throw new HttpError(401, '动态验证码或恢复码不正确')
  deleteLoginChallenge(challengeId)
  return row
}

export function createAuthenticatedSession(row: Row, request: IncomingMessage) {
  const token = createSessionToken()
  const csrfToken = randomBytes(32).toString('base64url')
  const expiresAt = Date.now() + config.sessionDays * 24 * 60 * 60 * 1000
  const ipAddress = requestIp(request)
  const userAgent = String(request.headers['user-agent'] || '').slice(0, 500)
  const currentDevice = deviceName(userAgent)
  const adminId = String(row.admin_id || row.id)
  const newDevice = !hasSeenDevice(adminId, ipAddress, currentDevice)
  const sessionId = createSession({ adminId, tokenHash: hashToken(token), csrfToken, expiresAt, ipAddress, userAgent, deviceName: currentDevice })
  markLogin(adminId)
  recordLoginEvent({ adminId, username: String(row.username), success: true, reason: newDevice ? '新设备登录' : '登录成功', ipAddress, userAgent, deviceName: currentDevice, requestId: currentRequestContext().requestId })
  if (newDevice) notifyAlert({ type: 'new_admin_login', title: '管理员新设备登录', detail: `${row.username} · ${currentDevice} · ${ipAddress}`, entityId: adminId })
  return { token, expiresAt, admin: authenticatedAdmin({ ...row, admin_id: adminId, session_id: sessionId, csrf_token: csrfToken }) }
}

export function recordFailedLogin(username: string, request: IncomingMessage, reason: string) {
  const row = findAdminByUsername(username)
  const userAgent = String(request.headers['user-agent'] || '').slice(0, 500)
  recordLoginEvent({ adminId: row ? String(row.id) : undefined, username, success: false, reason, ipAddress: requestIp(request), userAgent, deviceName: deviceName(userAgent), requestId: currentRequestContext().requestId })
}

export function beginTotpSetup(adminId: string, username: string) {
  const secret = generateTotpSecret()
  setPendingTotpSecret(adminId, encryptSecret(secret))
  const issuer = encodeURIComponent('JTWZ')
  const label = encodeURIComponent(`JTWZ:${username}`)
  return { secret, otpauthUrl: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30` }
}

export function pendingTotpSecret(adminId: string) {
  const row = findAdminById(adminId)
  if (!row?.totp_pending_secret) throw new HttpError(409, '请先开始设置双重验证')
  return decryptSecret(String(row.totp_pending_secret))
}
