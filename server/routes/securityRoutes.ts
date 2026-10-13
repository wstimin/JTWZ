import type { ServerResponse } from 'node:http'
import { hashPassword, verifyPassword } from '../auth.js'
import { audit } from '../db.js'
import { HttpError, readJson, sendJson } from '../http.js'
import { requirePermission } from '../middleware/authorization.js'
import {
  countActiveOwners,
  createAdmin,
  deleteAdmin,
  deleteSession,
  disableTotp,
  enableTotp,
  findAdminById,
  listAdmins,
  listLoginEvents,
  listSessions,
  revokeAdminSessions,
  revokeOtherSessions,
  updateAdmin,
} from '../repositories/adminRepository.js'
import { adminRoles, type AdminRole, type AuthenticatedRequest } from '../securityTypes.js'
import { beginTotpSetup, decryptSecret, generateRecoveryCodes, hashRecoveryCode, pendingTotpSecret, verifyTotp } from '../services/authService.js'

function mapAdmin(row: Record<string, unknown>) {
  return {
    id: String(row.id), username: String(row.username), displayName: String(row.display_name || row.username), role: String(row.role), status: String(row.status),
    twoFactorEnabled: Boolean(row.totp_secret), activeSessions: Number(row.active_sessions || 0), lastLoginAt: row.last_login_at ? String(row.last_login_at) : undefined,
    updatedAt: String(row.updated_at || row.created_at), createdAt: String(row.created_at),
  }
}

function validUsername(value: unknown) {
  const username = String(value || '').trim()
  if (!/^[A-Za-z0-9._-]{3,64}$/.test(username)) throw new HttpError(400, '管理员账号需为 3-64 位字母、数字、点、下划线或短横线')
  return username
}

function validRole(value: unknown): AdminRole {
  if (!adminRoles.includes(value as AdminRole)) throw new HttpError(400, '管理员角色无效')
  return value as AdminRole
}

function verifyCurrentPassword(adminId: string, password: unknown) {
  const row = findAdminById(adminId)
  if (!row || !verifyPassword(String(password || ''), String(row.password_hash))) throw new HttpError(400, '当前密码不正确')
  return row
}

export async function handleSecurityRoutes(request: AuthenticatedRequest, response: ServerResponse, url: URL) {
  if (!url.pathname.startsWith('/api/security/')) return false
  const admin = request.admin!
  const method = request.method || 'GET'

  if (method === 'GET' && url.pathname === '/api/security/overview') {
    const canManageAdmins = admin.permissions.includes('admins.manage')
    sendJson(response, 200, {
      admins: canManageAdmins ? listAdmins().map(mapAdmin) : [],
      sessions: listSessions(admin.id).map((row) => ({ id: String(row.id), ipAddress: String(row.ip_address), deviceName: String(row.device_name), userAgent: String(row.user_agent), lastSeenAt: String(row.last_seen_at), createdAt: String(row.created_at), expiresAt: Number(row.expires_at), current: String(row.id) === admin.sessionId })),
      events: listLoginEvents(admin.id, canManageAdmins).map((row) => ({ id: String(row.id), adminId: row.admin_id ? String(row.admin_id) : undefined, username: String(row.username), success: Boolean(row.success), reason: String(row.reason), ipAddress: String(row.ip_address), deviceName: String(row.device_name), requestId: String(row.request_id), createdAt: String(row.created_at) })),
      canManageAdmins,
    })
    return true
  }

  if (method === 'POST' && url.pathname === '/api/security/admins') {
    requirePermission(admin, 'admins.manage')
    const body = await readJson<Record<string, unknown>>(request)
    const username = validUsername(body.username)
    const password = String(body.password || '')
    if (password.length < 6 || password.length > 160) throw new HttpError(400, '密码长度需要在 6 到 160 个字符之间')
    let created
    try {
      created = createAdmin({ username, displayName: String(body.displayName || username).trim().slice(0, 80) || username, role: validRole(body.role || 'editor'), passwordHash: hashPassword(password) })
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new HttpError(409, '管理员账号已经存在')
      throw error
    }
    audit(admin.id, 'create', 'admin', String(created.id), `${created.username} / ${created.role}`)
    sendJson(response, 201, { admin: mapAdmin(created) })
    return true
  }

  const adminMatch = url.pathname.match(/^\/api\/security\/admins\/([^/]+)$/)
  if (adminMatch && method === 'PATCH') {
    requirePermission(admin, 'admins.manage')
    const id = decodeURIComponent(adminMatch[1])
    const target = findAdminById(id)
    if (!target) throw new HttpError(404, '管理员不存在')
    const body = await readJson<Record<string, unknown>>(request)
    const nextRole = validRole(body.role || target.role)
    const nextStatus = body.status === 'disabled' ? 'disabled' : 'active'
    if (String(target.role) === 'owner' && (nextRole !== 'owner' || nextStatus !== 'active') && countActiveOwners() <= 1) throw new HttpError(409, '系统必须保留至少一名启用的所有者')
    const password = String(body.password || '')
    if (password && (password.length < 6 || password.length > 160)) throw new HttpError(400, '密码长度需要在 6 到 160 个字符之间')
    const updated = updateAdmin(id, { displayName: String(body.displayName || target.display_name || target.username).trim().slice(0, 80), role: nextRole, status: nextStatus, passwordHash: password ? hashPassword(password) : undefined })!
    if (password) revokeAdminSessions(id)
    audit(admin.id, 'update', 'admin', id, `${updated.username} / ${updated.role} / ${updated.status}`)
    sendJson(response, 200, { admin: mapAdmin(updated) })
    return true
  }
  if (adminMatch && method === 'DELETE') {
    requirePermission(admin, 'admins.manage')
    const id = decodeURIComponent(adminMatch[1])
    if (id === admin.id) throw new HttpError(409, '不能删除当前登录账号')
    const target = findAdminById(id)
    if (!target) throw new HttpError(404, '管理员不存在')
    if (String(target.role) === 'owner' && countActiveOwners() <= 1) throw new HttpError(409, '系统必须保留至少一名所有者')
    deleteAdmin(id)
    audit(admin.id, 'delete', 'admin', id, String(target.username))
    sendJson(response, 200, { deleted: true })
    return true
  }

  const sessionMatch = url.pathname.match(/^\/api\/security\/sessions\/([^/]+)$/)
  if (sessionMatch && method === 'DELETE') {
    const id = decodeURIComponent(sessionMatch[1])
    if (id === admin.sessionId) throw new HttpError(409, '当前会话请使用“退出登录”结束')
    if (!deleteSession(id, admin.id)) throw new HttpError(404, '会话不存在')
    audit(admin.id, 'session_revoke', 'session', id, '撤销设备会话')
    sendJson(response, 200, { deleted: true })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/security/sessions/revoke-others') {
    const count = revokeOtherSessions(admin.id, admin.sessionId)
    audit(admin.id, 'session_revoke_others', 'session', admin.sessionId, `撤销 ${count} 个其他会话`)
    sendJson(response, 200, { revoked: count })
    return true
  }

  if (method === 'POST' && url.pathname === '/api/security/2fa/setup') {
    const body = await readJson<{ currentPassword?: string }>(request)
    verifyCurrentPassword(admin.id, body.currentPassword)
    sendJson(response, 200, { setup: beginTotpSetup(admin.id, admin.username) })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/security/2fa/enable') {
    const body = await readJson<{ code?: string }>(request)
    const secret = pendingTotpSecret(admin.id)
    if (!verifyTotp(secret, String(body.code || ''))) throw new HttpError(400, '动态验证码不正确')
    const recoveryCodes = generateRecoveryCodes()
    enableTotp(admin.id, (findAdminById(admin.id) as Record<string, unknown>).totp_pending_secret as string, recoveryCodes.map(hashRecoveryCode))
    revokeOtherSessions(admin.id, admin.sessionId)
    audit(admin.id, 'two_factor_enable', 'admin', admin.id, '启用双重验证并撤销其他会话')
    sendJson(response, 200, { enabled: true, recoveryCodes })
    return true
  }
  if (method === 'POST' && url.pathname === '/api/security/2fa/disable') {
    const body = await readJson<{ currentPassword?: string; code?: string }>(request)
    const row = verifyCurrentPassword(admin.id, body.currentPassword)
    if (!row.totp_secret) throw new HttpError(409, '双重验证尚未启用')
    if (!verifyTotp(decryptSecret(String(row.totp_secret)), String(body.code || ''))) throw new HttpError(400, '动态验证码不正确')
    disableTotp(admin.id)
    revokeOtherSessions(admin.id, admin.sessionId)
    audit(admin.id, 'two_factor_disable', 'admin', admin.id, '关闭双重验证并撤销其他会话')
    sendJson(response, 200, { enabled: false })
    return true
  }
  throw new HttpError(404, '安全中心接口不存在')
}
