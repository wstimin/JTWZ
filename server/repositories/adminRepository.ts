import { randomUUID } from 'node:crypto'
import { db } from '../db.js'
import type { AdminRole } from '../securityTypes.js'

export type Row = Record<string, unknown>

export function findAdminByUsername(username: string) {
  return db.prepare('SELECT * FROM admins WHERE username = ?').get(username) as Row | undefined
}

export function findAdminById(id: string) {
  return db.prepare('SELECT * FROM admins WHERE id = ?').get(id) as Row | undefined
}

export function listAdmins() {
  return db.prepare(`SELECT admins.id, admins.username, admins.display_name, admins.role, admins.status, admins.totp_secret,
    admins.last_login_at, admins.updated_at, admins.created_at,
    (SELECT COUNT(*) FROM sessions WHERE sessions.admin_id = admins.id AND sessions.expires_at > ?) AS active_sessions
    FROM admins ORDER BY CASE admins.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, admins.created_at ASC`).all(Date.now()) as Row[]
}

export function countActiveOwners() {
  return Number((db.prepare("SELECT COUNT(*) AS count FROM admins WHERE role = 'owner' AND status = 'active'").get() as Row).count)
}

export function createAdmin(input: { username: string; displayName: string; role: AdminRole; passwordHash: string }) {
  const id = randomUUID()
  const timestamp = new Date().toISOString()
  db.prepare(`INSERT INTO admins (id, username, password_hash, display_name, role, status, updated_at, created_at)
    VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`).run(id, input.username, input.passwordHash, input.displayName, input.role, timestamp, timestamp)
  return findAdminById(id)!
}

export function updateAdmin(id: string, updates: { displayName: string; role: AdminRole; status: 'active' | 'disabled'; passwordHash?: string }) {
  const timestamp = new Date().toISOString()
  if (updates.passwordHash) {
    db.prepare('UPDATE admins SET display_name = ?, role = ?, status = ?, password_hash = ?, updated_at = ? WHERE id = ?')
      .run(updates.displayName, updates.role, updates.status, updates.passwordHash, timestamp, id)
  } else {
    db.prepare('UPDATE admins SET display_name = ?, role = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(updates.displayName, updates.role, updates.status, timestamp, id)
  }
  if (updates.status === 'disabled') revokeAdminSessions(id)
  return findAdminById(id)
}

export function deleteAdmin(id: string) {
  return db.prepare('DELETE FROM admins WHERE id = ?').run(id).changes > 0
}

export function createSession(input: { adminId: string; tokenHash: string; csrfToken: string; expiresAt: number; ipAddress: string; userAgent: string; deviceName: string }) {
  const id = randomUUID()
  const timestamp = new Date().toISOString()
  db.prepare(`INSERT INTO sessions (id, admin_id, token_hash, csrf_token, expires_at, ip_address, user_agent, device_name, last_seen_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, input.adminId, input.tokenHash, input.csrfToken, input.expiresAt, input.ipAddress, input.userAgent, input.deviceName, timestamp, timestamp)
  return id
}

export function findSessionByTokenHash(tokenHash: string) {
  return db.prepare(`SELECT sessions.*, admins.username, admins.display_name, admins.role, admins.status, admins.totp_secret
    FROM sessions JOIN admins ON admins.id = sessions.admin_id WHERE sessions.token_hash = ?`).get(tokenHash) as Row | undefined
}

export function touchSession(id: string) {
  db.prepare('UPDATE sessions SET last_seen_at = ? WHERE id = ?').run(new Date().toISOString(), id)
}

export function deleteSessionByTokenHash(tokenHash: string) {
  return db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(tokenHash).changes > 0
}

export function deleteSession(id: string, adminId: string) {
  return db.prepare('DELETE FROM sessions WHERE id = ? AND admin_id = ?').run(id, adminId).changes > 0
}

export function revokeOtherSessions(adminId: string, currentSessionId: string) {
  return db.prepare('DELETE FROM sessions WHERE admin_id = ? AND id <> ?').run(adminId, currentSessionId).changes
}

export function revokeAdminSessions(adminId: string) {
  return db.prepare('DELETE FROM sessions WHERE admin_id = ?').run(adminId).changes
}

export function listSessions(adminId: string) {
  return db.prepare(`SELECT id, ip_address, device_name, user_agent, last_seen_at, created_at, expires_at
    FROM sessions WHERE admin_id = ? AND expires_at > ? ORDER BY last_seen_at DESC`).all(adminId, Date.now()) as Row[]
}

export function recordLoginEvent(input: { adminId?: string; username: string; success: boolean; reason: string; ipAddress: string; userAgent: string; deviceName: string; requestId: string }) {
  db.prepare(`INSERT INTO admin_login_events (id, admin_id, username, success, reason, ip_address, user_agent, device_name, request_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), input.adminId || null, input.username, input.success ? 1 : 0, input.reason, input.ipAddress, input.userAgent, input.deviceName, input.requestId, new Date().toISOString())
}

export function listLoginEvents(adminId: string, canViewAll: boolean) {
  const sql = `SELECT id, admin_id, username, success, reason, ip_address, device_name, request_id, created_at FROM admin_login_events ${canViewAll ? '' : 'WHERE admin_id = ?'} ORDER BY created_at DESC LIMIT 50`
  return (canViewAll ? db.prepare(sql).all() : db.prepare(sql).all(adminId)) as Row[]
}

export function hasSeenDevice(adminId: string, ipAddress: string, deviceName: string) {
  return Boolean(db.prepare('SELECT id FROM admin_login_events WHERE admin_id = ? AND success = 1 AND ip_address = ? AND device_name = ? LIMIT 1').get(adminId, ipAddress, deviceName))
}

export function createLoginChallenge(input: { adminId: string; ipAddress: string; userAgent: string; requestId: string }) {
  const id = randomUUID()
  db.prepare('DELETE FROM login_challenges WHERE expires_at <= ?').run(Date.now())
  db.prepare(`INSERT INTO login_challenges (id, admin_id, expires_at, attempts, ip_address, user_agent, request_id, created_at)
    VALUES (?, ?, ?, 0, ?, ?, ?, ?)`).run(id, input.adminId, Date.now() + 5 * 60_000, input.ipAddress, input.userAgent, input.requestId, new Date().toISOString())
  return id
}

export function findLoginChallenge(id: string) {
  return db.prepare(`SELECT login_challenges.*, admins.username, admins.display_name, admins.role, admins.status, admins.totp_secret, admins.recovery_codes
    FROM login_challenges JOIN admins ON admins.id = login_challenges.admin_id WHERE login_challenges.id = ?`).get(id) as Row | undefined
}

export function incrementChallengeAttempts(id: string) {
  db.prepare('UPDATE login_challenges SET attempts = attempts + 1 WHERE id = ?').run(id)
}

export function deleteLoginChallenge(id: string) {
  db.prepare('DELETE FROM login_challenges WHERE id = ?').run(id)
}

export function setPendingTotpSecret(adminId: string, encryptedSecret: string) {
  db.prepare('UPDATE admins SET totp_pending_secret = ?, updated_at = ? WHERE id = ?').run(encryptedSecret, new Date().toISOString(), adminId)
}

export function enableTotp(adminId: string, encryptedSecret: string, recoveryCodeHashes: string[]) {
  db.prepare("UPDATE admins SET totp_secret = ?, totp_pending_secret = '', recovery_codes = ?, updated_at = ? WHERE id = ?")
    .run(encryptedSecret, JSON.stringify(recoveryCodeHashes), new Date().toISOString(), adminId)
}

export function disableTotp(adminId: string) {
  db.prepare("UPDATE admins SET totp_secret = '', totp_pending_secret = '', recovery_codes = '[]', updated_at = ? WHERE id = ?").run(new Date().toISOString(), adminId)
}

export function consumeRecoveryCode(adminId: string, expectedHash: string, remainingHashes: string[]) {
  const result = db.prepare('UPDATE admins SET recovery_codes = ?, updated_at = ? WHERE id = ? AND recovery_codes LIKE ?')
    .run(JSON.stringify(remainingHashes), new Date().toISOString(), adminId, `%${expectedHash}%`)
  return result.changes > 0
}

export function markLogin(adminId: string) {
  db.prepare('UPDATE admins SET last_login_at = ?, updated_at = ? WHERE id = ?').run(new Date().toISOString(), new Date().toISOString(), adminId)
}
