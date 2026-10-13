import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { appendFileSync, createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { resolveTxt } from 'node:dns/promises'
import { basename, extname, resolve, sep } from 'node:path'
import { hashPassword, hashToken, verifyPassword } from './auth.js'
import { config, normalizeAdminBasePath } from './config.js'
import { audit, db, isHttpUrl, isValidHostname, mapCertificate, mapDomain, mapPackage, mapSettings, mapSite, mapSoftware, mapSoftwareVersion, normalizeHostname, recordEvent } from './db.js'
import { clientIp, HttpError, parseCookies, readJson, sendHtml, sendJson } from './http.js'
import { extractStaticSite } from './sitePublisher.js'
import { completeMultipartUpload, completeStorageUpload, createMultipartPartUpload, createMultipartUpload, createStorageDownload, createStorageUpload, isStorageConfigured, localFilePath, objectStorageMode, refreshObjectStorageMode, removeObject, uploadLocal } from './objectStorage.js'
import { dnsProviderStatus, publishVerificationRecord } from './dnsProvider.js'
import { certificateProviderStatus, configureDomainRoute, deleteCertificate, domainAutomationConfigured, issueCertificate, removeDomainRoute, type CertificateProviderResult } from './certificateProvider.js'
import { backupFilePath, createBackup, listBackups, restoreBackupWithRollback, startBackupScheduler } from './backup.js'
import { notificationsConfigured, notifyAlert } from './notifications.js'
import { formatBytes, removeStoredFile, safeStoragePath, signedDownloadPath, signedStorageUpload, verifyDownloadSignature, verifyStorageUpload, writeRequestToFile } from './storage.js'
import { checkForUpdate, getUpdateState, installUpdate } from './updateService.js'
import { cancelTask, createTask, findLatestTask, getTask, listTasks, recoverInterruptedTasks, updateTask } from './tasks.js'
import { applySecurityHeaders, checkOrigin, originAllowed, requestOrigin, requireCsrf, stateMethods } from './middleware/security.js'
import { runWithRequestContext } from './middleware/requestContext.js'
import { getAuthenticatedAdmin } from './services/authService.js'
import { handleAuthRoutes } from './routes/authRoutes.js'
import { handleSecurityRoutes } from './routes/securityRoutes.js'
import { permissionForRequest, requirePermission } from './middleware/authorization.js'
import type { AuthenticatedRequest } from './securityTypes.js'
import { validatePackageFile, validatePackageMetadata } from './services/uploadValidation.js'

type Row = Record<string, unknown>
const adminRequestBuckets = new Map<string, { count: number; resetAt: number }>()
let activeAdminBasePath = config.adminBasePath
const disabledAdminBasePaths = new Set(config.disabledAdminBasePaths.filter((path) => path !== activeAdminBasePath))
if (activeAdminBasePath !== '/admin') disabledAdminBasePaths.add('/admin')

function adminAccess(request: IncomingMessage) {
  const origin = requestOrigin(request)
  return {
    adminBasePath: activeAdminBasePath,
    dashboardPath: activeAdminBasePath,
    loginPath: `${activeAdminBasePath}/login`,
    loginUrl: `${origin}${activeAdminBasePath}/login`,
  }
}

function writeEnvironmentValues(values: Record<string, string>) {
  const envPath = config.envPath
  const lines = existsSync(envPath) ? readFileSync(envPath, 'utf8').split(/\r?\n/) : []
  const seen = new Set<string>()
  const updated = lines.filter((line, index) => line || index < lines.length - 1).map((line) => {
    const separator = line.indexOf('=')
    if (separator < 1) return line
    const key = line.slice(0, separator)
    if (!(key in values)) return line
    seen.add(key)
    return `${key}=${values[key]}`
  })
  for (const [key, value] of Object.entries(values)) {
    if (!seen.has(key)) updated.push(`${key}=${value}`)
  }
  const nextContent = `${updated.join('\n').replace(/\n+$/, '')}\n`
  const tempPath = `${envPath}.${process.pid}.tmp`
  writeFileSync(tempPath, nextContent, { mode: 0o600 })
  try {
    renameSync(tempPath, envPath)
  } catch {
    writeFileSync(envPath, nextContent, { mode: 0o600 })
    rmSync(tempPath, { force: true })
  }
}

function systemConfiguration() {
  return {
    storageProvider: objectStorageMode,
    s3Endpoint: config.s3Endpoint,
    s3Region: config.s3Region,
    s3Bucket: config.s3Bucket,
    s3PublicBaseUrl: config.s3PublicBaseUrl,
    s3AccessKeyConfigured: Boolean(config.s3AccessKey),
    s3SecretKeyConfigured: Boolean(config.s3SecretKey),
    dnsProvider: config.dnsProvider,
    certificateProvider: config.certificateProvider,
    cloudflareApiTokenConfigured: Boolean(config.cloudflareApiToken),
    dnsWebhookUrl: config.dnsWebhookUrl,
    dnsWebhookSecretConfigured: Boolean(config.dnsWebhookSecret),
    alertWebhookUrl: config.alertWebhookUrl,
    alertWebhookSecretConfigured: Boolean(config.alertWebhookSecret),
    domainAutomationConfigured: domainAutomationConfigured(),
  }
}

function validatedOptionalUrl(value: unknown, label: string) {
  const normalized = String(value || '').trim()
  if (normalized && !isHttpUrl(normalized)) throw new HttpError(400, `${label}必须是有效的 http 或 https 地址`)
  return normalized.replace(/\/$/, '')
}

function configuredSecret(body: Record<string, unknown>, field: string, clearField: string, current: string) {
  if (body[clearField] === true) return ''
  const value = String(body[field] || '').trim()
  return value || current
}

function requireAdmin(request: AuthenticatedRequest) {
  const admin = getAuthenticatedAdmin(request)
  if (!admin) throw new HttpError(401, '请先登录管理后台')
  request.admin = admin
  return admin
}

function enforceAdminRateLimit(request: AuthenticatedRequest, adminId: string) {
  if (!stateMethods.has(request.method || 'GET')) return
  const key = `${adminId}:${clientIp(request)}`
  const current = adminRequestBuckets.get(key)
  if (!current || current.resetAt <= Date.now()) {
    adminRequestBuckets.set(key, { count: 1, resetAt: Date.now() + 60_000 })
    return
  }
  current.count += 1
  if (current.count > 120) {
    notifyAlert({ type: 'rate_limit', title: '管理员请求触发限流', detail: `IP ${clientIp(request)} 在 1 分钟内超过写操作限制` })
    throw new HttpError(429, '管理请求过于频繁，请稍后重试')
  }
}

function normalizeTarget(target: string) {
  const value = target.trim()
  if (!isHttpUrl(value)) throw new HttpError(400, '跳转目标必须是有效的 http 或 https 地址')
  return value
}

function publicSettings() {
  return mapSettings(db.prepare('SELECT * FROM settings WHERE id = 1').get() as Row)
}

function listDomains() {
  return db.prepare('SELECT * FROM domains ORDER BY created_at DESC').all().map((row) => mapDomain(row as Row))
}

function refreshCertificateStatuses(domainId = '') {
  const now = new Date().toISOString()
  const expiring = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
  const suffix = domainId ? ' AND domain_id = ?' : ''
  const args = domainId ? [domainId] : []
  db.prepare(`UPDATE certificates SET status = 'expired', updated_at = ? WHERE expires_at IS NOT NULL AND expires_at <= ? AND status IN ('active', 'expiring')${suffix}`)
    .run(now, now, ...args)
  db.prepare(`UPDATE certificates SET status = 'expiring', updated_at = ? WHERE expires_at IS NOT NULL AND expires_at > ? AND expires_at <= ? AND status = 'active'${suffix}`)
    .run(now, now, expiring, ...args)
}

function listCertificates(domainId = '') {
  refreshCertificateStatuses(domainId)
  const where = domainId ? 'WHERE certificates.domain_id = ?' : ''
  const rows = db.prepare(`SELECT certificates.*, domains.hostname FROM certificates JOIN domains ON domains.id = certificates.domain_id ${where} ORDER BY certificates.created_at DESC`)
    .all(...(domainId ? [domainId] : []))
  return rows.map((row) => mapCertificate(row as Row))
}

function syncDomainCertificateStatus(domainId: string) {
  refreshCertificateStatuses(domainId)
  const current = db.prepare(`SELECT status FROM certificates WHERE domain_id = ? ORDER BY
    CASE status WHEN 'active' THEN 0 WHEN 'expiring' THEN 1 WHEN 'pending' THEN 2 WHEN 'error' THEN 3 ELSE 4 END,
    created_at DESC LIMIT 1`).get(domainId) as Row | undefined
  const certificateStatus = current && ['active', 'expiring'].includes(String(current.status)) ? 'active' : current?.status === 'error' ? 'error' : 'pending'
  db.prepare('UPDATE domains SET certificate_status = ?, updated_at = ? WHERE id = ?').run(certificateStatus, new Date().toISOString(), domainId)
  return certificateStatus
}

function saveProviderCertificate(domainId: string, result: CertificateProviderResult, existingId = '') {
  const timestamp = new Date().toISOString()
  const id = existingId || randomUUID()
  if (existingId) {
    db.prepare(`UPDATE certificates SET provider = ?, issuer = ?, serial_number = ?, external_ref = ?, issued_at = ?, expires_at = ?,
      status = 'active', last_error = '', updated_at = ? WHERE id = ? AND domain_id = ?`)
      .run(result.provider, result.issuer, result.serialNumber || '', result.externalRef, result.issuedAt || timestamp, result.expiresAt || null, timestamp, id, domainId)
  } else {
    db.prepare(`INSERT INTO certificates
      (id, domain_id, provider, issuer, serial_number, external_ref, issued_at, expires_at, status, auto_renew, note, last_error, updated_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', 1, '', '', ?, ?)`)
      .run(id, domainId, result.provider, result.issuer, result.serialNumber || '', result.externalRef, result.issuedAt || timestamp, result.expiresAt || null, timestamp, timestamp)
  }
  syncDomainCertificateStatus(domainId)
  return listCertificates(domainId).find((item) => item.id === id)
}

async function issueManagedCertificate(domainId: string, hostname: string, existingId = '') {
  const provider = certificateProviderStatus()
  if (!provider.configured) throw new HttpError(503, 'HTTPS 证书服务商尚未完成配置')
  const timestamp = new Date().toISOString()
  const certificateId = existingId || randomUUID()
  if (!existingId) {
    db.prepare(`INSERT INTO certificates
      (id, domain_id, provider, issuer, serial_number, external_ref, issued_at, expires_at, status, auto_renew, note, last_error, updated_at, created_at)
      VALUES (?, ?, ?, '', '', '', NULL, NULL, 'pending', 1, '', '', ?, ?)`)
      .run(certificateId, domainId, provider.provider, timestamp, timestamp)
  } else {
    db.prepare("UPDATE certificates SET status = 'pending', last_error = '', updated_at = ? WHERE id = ? AND domain_id = ?")
      .run(timestamp, certificateId, domainId)
  }
  try {
    const result = await issueCertificate(hostname)
    return saveProviderCertificate(domainId, result, certificateId)
  } catch (error) {
    const detail = error instanceof Error ? error.message : '证书服务商请求失败'
    db.prepare("UPDATE certificates SET status = 'error', last_error = ?, updated_at = ? WHERE id = ? AND domain_id = ?")
      .run(detail, new Date().toISOString(), certificateId, domainId)
    syncDomainCertificateStatus(domainId)
    throw error
  }
}

async function runCertificateOperationTask(taskId: string, adminId: string | null) {
  const task = getTask(taskId)
  if (!task) throw new HttpError(404, '任务不存在')
  const domainId = String(task.input.domainId || task.entityId || '')
  const certificateId = String(task.input.certificateId || '')
  const domain = db.prepare('SELECT hostname, dns_status FROM domains WHERE id = ?').get(domainId) as Row | undefined
  if (!domain) throw new HttpError(404, '域名不存在')
  if (String(domain.dns_status) !== 'verified') throw new HttpError(409, '请先完成 DNS 所有权验证')
  updateTask(taskId, { status: 'running', progress: 15, message: '正在连接证书服务商', log: { level: 'info', message: `开始处理 ${String(domain.hostname)} 的证书` } })
  try {
    const certificate = await issueManagedCertificate(domainId, String(domain.hostname), certificateId)
    const action = certificateId ? 'certificate_renewed' : 'certificate_issued'
    audit(adminId, action, certificateId ? 'certificate' : 'domain', certificateId || domainId, String(domain.hostname))
    updateTask(taskId, { status: 'succeeded', progress: 100, message: certificateId ? '证书续期完成' : '证书签发完成', result: { domainId, certificateId: certificate?.id || certificateId }, log: { level: 'success', message: '证书服务商已返回成功状态' } })
    return { certificate, domain: mapDomain(db.prepare('SELECT * FROM domains WHERE id = ?').get(domainId) as Row), task: getTask(taskId) }
  } catch (error) {
    const detail = `${String(domain.hostname)}: ${error instanceof Error ? error.message : '证书操作失败'}`
    updateTask(taskId, { status: 'failed', message: certificateId ? '证书续期失败' : '证书签发失败', error: detail, log: { level: 'error', message: detail } })
    audit(adminId, 'certificate_failed', 'domain', domainId, detail)
    notifyAlert({ type: 'certificate_failed', title: certificateId ? 'HTTPS 证书续期失败' : 'HTTPS 证书签发失败', detail, entityId: domainId })
    throw error
  }
}

let certificateRenewalRunning = false

async function renewDueCertificates() {
  if (certificateRenewalRunning || !certificateProviderStatus().configured) return
  certificateRenewalRunning = true
  try {
    const renewBefore = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
    const due = db.prepare(`SELECT certificates.id, certificates.domain_id, domains.hostname FROM certificates
      JOIN domains ON domains.id = certificates.domain_id
      WHERE certificates.auto_renew = 1 AND certificates.provider <> 'manual' AND certificates.expires_at IS NOT NULL
        AND certificates.expires_at <= ? AND certificates.status IN ('active', 'expiring', 'error')
      ORDER BY certificates.expires_at ASC LIMIT 25`).all(renewBefore) as Row[]
    for (const item of due) {
      try {
        await issueManagedCertificate(String(item.domain_id), String(item.hostname), String(item.id))
        audit(null, 'certificate_auto_renewed', 'certificate', String(item.id), String(item.hostname))
      } catch (error) {
        const detail = `${String(item.hostname)}: ${error instanceof Error ? error.message : '自动续期失败'}`
        audit(null, 'certificate_failed', 'domain', String(item.domain_id), detail)
        notifyAlert({ type: 'certificate_failed', title: 'HTTPS 证书自动续期失败', detail, entityId: String(item.domain_id) })
      }
    }
  } finally {
    certificateRenewalRunning = false
  }
}

function startCertificateRenewalScheduler() {
  const timer = setInterval(() => { void renewDueCertificates() }, 6 * 60 * 60 * 1000)
  timer.unref()
  setTimeout(() => { void renewDueCertificates() }, 30_000).unref()
}

function listRedirectRules() {
  return db.prepare(`SELECT redirect_rules.*, domains.hostname FROM redirect_rules
    JOIN domains ON domains.id = redirect_rules.domain_id ORDER BY priority ASC, created_at DESC`).all().map((raw) => {
    const row = raw as Row
    return {
      id: String(row.id), domainId: String(row.domain_id), hostname: String(row.hostname), sourcePath: String(row.source_path),
      name: String(row.name || ''), notes: String(row.notes || ''),
      target: String(row.target), redirectCode: Number(row.redirect_code), preservePath: Boolean(row.preserve_path),
      preserveQuery: Boolean(row.preserve_query), enabled: Boolean(row.enabled), priority: Number(row.priority),
      startsAt: row.starts_at ? String(row.starts_at) : undefined, expiresAt: row.expires_at ? String(row.expires_at) : undefined,
      hits: Number(row.hits), updatedAt: String(row.updated_at),
    }
  })
}

function listPackages() {
  return db.prepare(`SELECT packages.*, software.name AS software_name FROM packages
    LEFT JOIN software ON software.id = packages.software_id ORDER BY packages.created_at DESC`).all().map((row) => mapPackage(row as Row))
}

function packagesWithUrls() {
  return listPackages().map((item) => ({ ...item, downloadUrl: item.status === 'available' ? signedDownloadPath(item.id) : '' }))
}

function listSoftwareVersions(softwareId = '') {
  const filter = softwareId ? 'WHERE software_versions.software_id = ?' : ''
  return db.prepare(`SELECT software_versions.*, software.name AS software_name,
      COUNT(packages.id) AS package_count,
      COALESCE(SUM(packages.downloads), 0) AS downloads,
      GROUP_CONCAT(DISTINCT packages.platform) AS platforms
    FROM software_versions
    JOIN software ON software.id = software_versions.software_id
    LEFT JOIN packages ON packages.version_id = software_versions.id
    ${filter}
    GROUP BY software_versions.id
    ORDER BY software_versions.created_at DESC`)
    .all(...(softwareId ? [softwareId] : []))
    .map((row) => mapSoftwareVersion(row as Row))
}

function ensureSoftwareVersion(softwareId: string, version: string, releaseNotes = '') {
  const existing = db.prepare('SELECT id FROM software_versions WHERE software_id = ? AND version = ?').get(softwareId, version) as Row | undefined
  if (existing) return String(existing.id)
  const id = randomUUID()
  const timestamp = new Date().toISOString()
  const channel = /alpha/i.test(version) ? 'alpha' : /beta|rc/i.test(version) ? 'beta' : 'stable'
  db.prepare(`INSERT INTO software_versions
    (id, software_id, version, channel, release_notes, status, is_recommended, published_at, updated_at, created_at)
    VALUES (?, ?, ?, ?, ?, 'draft', 0, NULL, ?, ?)`)
    .run(id, softwareId, version, channel, releaseNotes.slice(0, 10000), timestamp, timestamp)
  return id
}

function syncSoftwareRecommendedVersion(softwareId: string) {
  const current = db.prepare(`SELECT software_versions.version, COALESCE(GROUP_CONCAT(DISTINCT packages.platform), '') AS platforms,
      COALESCE(MAX(packages.size), '') AS size
    FROM software_versions LEFT JOIN packages ON packages.version_id = software_versions.id
    WHERE software_versions.software_id = ? AND software_versions.is_recommended = 1
    GROUP BY software_versions.id LIMIT 1`).get(softwareId) as Row | undefined
  db.prepare('UPDATE software SET version = ?, platform = ?, size = ?, updated_at = ? WHERE id = ?')
    .run(current ? String(current.version) : '', current ? String(current.platforms) : '', current ? String(current.size) : '', new Date().toISOString(), softwareId)
}

function listAnnouncements(publicOnly = false) {
  const where = publicOnly ? "WHERE status = 'published'" : ''
  return db.prepare(`SELECT id, title, body, status, pinned, published_at AS publishedAt, updated_at AS updatedAt, created_at AS createdAt FROM announcements ${where} ORDER BY pinned DESC, COALESCE(published_at, created_at) DESC`).all().map((raw) => {
    const row = raw as Row
    return { id: String(row.id), title: String(row.title), body: String(row.body), status: String(row.status), pinned: Boolean(row.pinned), publishedAt: row.publishedAt ? String(row.publishedAt) : undefined, updatedAt: String(row.updatedAt), createdAt: String(row.createdAt) }
  })
}

function safeFileName(value: string) {
  const original = basename(value.replace(/\\/g, '/')).trim()
  if (!original || original === '.' || original === '..') throw new HttpError(400, '文件名无效')
  return original.slice(0, 240)
}

function safeObjectName(value: string) {
  return value.replace(/[^\p{L}\p{N}._-]/gu, '_').replace(/^\.+/, '').slice(-180) || 'package.bin'
}

function parseStatus(value: unknown, allowed: string[], fallback: string) {
  const normalized = String(value || '')
  return allowed.includes(normalized) ? normalized : fallback
}

function optionalIsoDate(value: unknown, label: string) {
  const raw = String(value || '').trim()
  if (!raw) return null
  const timestamp = Date.parse(raw)
  if (!Number.isFinite(timestamp)) throw new HttpError(400, `${label}格式无效`)
  return new Date(timestamp).toISOString()
}

async function publishSiteTask(taskId: string, adminId: string | null) {
  const task = getTask(taskId)
  if (!task) throw new HttpError(404, '任务不存在')
  const siteId = String(task.input.siteId || task.entityId || '')
  const sourceName = safeFileName(String(task.input.sourceName || 'website.zip'))
  const zipPath = resolve(String(task.input.zipPath || ''))
  const site = db.prepare('SELECT name FROM sites WHERE id = ?').get(siteId) as Row | undefined
  if (!site) throw new HttpError(404, '静态网站不存在')
  if (!existsSync(zipPath)) throw new HttpError(409, '发布源文件已经不存在，无法重试；请重新上传 ZIP')
  const versionId = randomUUID()
  const releasePath = resolve(config.siteReleasesDir, siteId, versionId)
  updateTask(taskId, { status: 'running', progress: 35, message: '正在安全解压网站文件', log: { level: 'info', message: '开始检查 ZIP 路径、文件类型与解压体积' } })
  try {
    const result = await extractStaticSite(zipPath, releasePath)
    updateTask(taskId, { progress: 72, message: '安全检查通过，正在写入版本记录', log: { level: 'success', message: `安全解压完成：${result.files} 个文件，${formatBytes(result.totalBytes)}` } })
    const archive = readFileSync(zipPath)
    const archiveSha256 = createHash('sha256').update(archive).digest('hex')
    const timestamp = new Date().toISOString()
    db.exec('BEGIN IMMEDIATE')
    try {
      db.prepare(`INSERT INTO site_versions (id, site_id, release_path, source_name, file_count, byte_size, sha256, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(versionId, siteId, releasePath, sourceName, result.files, result.totalBytes, archiveSha256, timestamp)
      db.prepare("UPDATE sites SET current_version_id = ?, status = 'published', updated_at = ? WHERE id = ?")
        .run(versionId, timestamp, siteId)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      throw error
    }
    audit(adminId, 'publish', 'site', siteId, `${sourceName} / ${result.files} files / SHA-256 ${archiveSha256}`)
    updateTask(taskId, { status: 'succeeded', progress: 100, message: '网站新版本已发布', result: { siteId, versionId, fileCount: result.files, byteSize: result.totalBytes, sha256: archiveSha256 }, log: { level: 'success', message: '版本记录已提交并切换为当前版本' } })
    rmSync(zipPath, { force: true })
    return { site: mapSite(db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId) as Row), task: getTask(taskId) }
  } catch (error) {
    rmSync(releasePath, { recursive: true, force: true })
    const detail = error instanceof Error ? error.message : '网站发布失败'
    updateTask(taskId, { status: 'failed', message: '网站发布失败', error: detail, log: { level: 'error', message: detail } })
    throw error
  }
}

async function rollbackSiteTask(taskId: string, adminId: string | null) {
  const task = getTask(taskId)
  if (!task) throw new HttpError(404, '任务不存在')
  const siteId = String(task.input.siteId || task.entityId || '')
  const versionId = String(task.input.versionId || '')
  updateTask(taskId, { status: 'running', progress: 30, message: '正在验证目标版本', log: { level: 'info', message: '检查版本记录与发布目录' } })
  try {
    const version = db.prepare('SELECT id, release_path FROM site_versions WHERE id = ? AND site_id = ?').get(versionId, siteId) as Row | undefined
    if (!version || !existsSync(String(version.release_path))) throw new HttpError(404, '发布版本或版本文件不存在')
    db.prepare("UPDATE sites SET current_version_id = ?, status = 'published', updated_at = ? WHERE id = ?")
      .run(versionId, new Date().toISOString(), siteId)
    audit(adminId, 'rollback', 'site', siteId, versionId)
    updateTask(taskId, { status: 'succeeded', progress: 100, message: '网站版本回滚完成', result: { siteId, versionId }, log: { level: 'success', message: '目标版本已经恢复并重新上线' } })
    return { site: mapSite(db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId) as Row), task: getTask(taskId) }
  } catch (error) {
    const detail = error instanceof Error ? error.message : '版本回滚失败'
    updateTask(taskId, { status: 'failed', message: '网站版本回滚失败', error: detail, log: { level: 'error', message: detail } })
    throw error
  }
}

function assertRedirectRuleSafe(domainId: string, sourcePath: string, target: string, currentId = '') {
  const domain = db.prepare('SELECT hostname FROM domains WHERE id = ?').get(domainId) as Row | undefined
  if (!domain) throw new HttpError(404, '来源域名不存在')
  const conflict = db.prepare('SELECT id FROM redirect_rules WHERE domain_id = ? AND source_path = ? AND id <> ? LIMIT 1').get(domainId, sourcePath, currentId) as Row | undefined
  if (conflict) throw new HttpError(409, '该域名已经存在相同匹配路径的规则')

  const sourceHostname = normalizeHostname(String(domain.hostname))
  let targetHostname = normalizeHostname(new URL(target).hostname)
  const visited = new Set([sourceHostname])
  for (let depth = 0; depth < 16 && targetHostname; depth += 1) {
    if (visited.has(targetHostname)) throw new HttpError(409, '检测到跳转循环，请更换目标地址')
    visited.add(targetHostname)
    const next = db.prepare("SELECT target FROM domains WHERE hostname = ? AND status = 'active' AND mode IN ('redirect', 'download')").get(targetHostname) as Row | undefined
    if (!next || !isHttpUrl(String(next.target))) return
    targetHostname = normalizeHostname(new URL(String(next.target)).hostname)
  }
  if (targetHostname) throw new HttpError(409, '跳转链路过长，无法安全保存')
}

function buildAnalytics(days = 30) {
  const safeDays = Math.min(90, Math.max(7, Math.floor(days)))
  const since = new Date(Date.now() - (safeDays - 1) * 24 * 60 * 60 * 1000)
  since.setUTCHours(0, 0, 0, 0)
  const events = db.prepare('SELECT event_type, domain_id, user_agent, created_at FROM analytics_events WHERE created_at >= ? ORDER BY created_at ASC').all(since.toISOString()) as Row[]
  const daily = new Map<string, { date: string; visits: number; conversions: number }>()
  for (let index = 0; index < safeDays; index += 1) {
    const date = new Date(since.getTime() + index * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
    daily.set(date, { date, visits: 0, conversions: 0 })
  }
  let mobile = 0
  let desktop = 0
  for (const event of events) {
    const item = daily.get(String(event.created_at).slice(0, 10))
    if (item) {
      item.visits += 1
      if (['redirect', 'download_redirect', 'download'].includes(String(event.event_type))) item.conversions += 1
    }
    if (/android|iphone|ipad|mobile/i.test(String(event.user_agent || ''))) mobile += 1
    else desktop += 1
  }
  const totalVisits = Number((db.prepare('SELECT COALESCE(SUM(visits), 0) AS total FROM domains').get() as Row).total)
  const redirects = Number((db.prepare("SELECT COUNT(*) AS total FROM analytics_events WHERE event_type IN ('redirect', 'download_redirect')").get() as Row).total)
  const downloads = Number((db.prepare('SELECT COALESCE(SUM(downloads), 0) AS total FROM software').get() as Row).total)
  const conversions = events.filter((event) => ['redirect', 'download_redirect', 'download'].includes(String(event.event_type))).length
  const topDomains = db.prepare('SELECT id, hostname, visits FROM domains ORDER BY visits DESC LIMIT 5').all()
  const topSoftware = db.prepare('SELECT id, name, downloads FROM software ORDER BY downloads DESC LIMIT 5').all()
  return {
    summary: {
      totalVisits,
      redirects,
      downloads,
      conversionRate: events.length ? Number(((conversions / events.length) * 100).toFixed(1)) : 0,
      periodEvents: events.length,
    },
    trend: [...daily.values()],
    devices: { desktop, mobile },
    topDomains,
    topSoftware,
  }
}

function buildAlerts() {
  const alerts: Array<{ id: string; severity: 'warning' | 'error'; title: string; detail: string; createdAt: string }> = []
  const pendingDomains = Number((db.prepare("SELECT COUNT(*) AS count FROM domains WHERE status = 'pending' OR dns_status IN ('unverified', 'error')").get() as Row).count)
  if (pendingDomains) alerts.push({ id: 'pending-domains', severity: 'warning', title: `${pendingDomains} 个域名需要处理`, detail: '完成 DNS 所有权验证后才能稳定启用域名。', createdAt: new Date().toISOString() })
  const processingPackages = Number((db.prepare("SELECT COUNT(*) AS count FROM packages WHERE status = 'processing'").get() as Row).count)
  if (processingPackages) alerts.push({ id: 'processing-packages', severity: 'warning', title: `${processingPackages} 个安装包仍在处理中`, detail: '请检查上传任务或清理过期任务。', createdAt: new Date().toISOString() })
  const failedAudits = Number((db.prepare("SELECT COUNT(*) AS count FROM audit_logs WHERE action IN ('verify_failed', 'certificate_failed') AND created_at >= ?").get(new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()) as Row).count)
  if (failedAudits) alerts.push({ id: 'failed-security-actions', severity: 'error', title: `${failedAudits} 次安全操作失败`, detail: '最近 24 小时内存在 DNS 或证书失败记录，请查看操作日志。', createdAt: new Date().toISOString() })
  return alerts
}

function buildSystemHealth() {
  const checks: Array<{ id: string; label: string; status: 'ok' | 'warning' | 'error'; detail: string }> = []
  try {
    db.prepare('SELECT 1 AS ok').get()
    checks.push({ id: 'database', label: '数据库', status: 'ok', detail: 'SQLite WAL 连接正常' })
  } catch {
    checks.push({ id: 'database', label: '数据库', status: 'error', detail: '数据库连接失败' })
  }
  checks.push({ id: 'storage', label: '对象存储', status: isStorageConfigured() ? 'ok' : 'warning', detail: isStorageConfigured() ? `${objectStorageMode.toUpperCase()} 存储已配置` : '使用本地存储或尚未配置云存储' })
  checks.push({ id: 'dns', label: 'DNS 服务商', status: dnsProviderStatus().configured ? 'ok' : 'warning', detail: dnsProviderStatus().configured ? `${dnsProviderStatus().provider} 适配器可用` : '使用手动 DNS 验证' })
  checks.push({ id: 'certificate', label: 'HTTPS 证书', status: certificateProviderStatus().configured ? 'ok' : 'warning', detail: certificateProviderStatus().configured ? `${certificateProviderStatus().provider} 适配器可用` : '等待证书服务商配置' })
  checks.push({ id: 'notifications', label: '告警通知', status: notificationsConfigured() ? 'ok' : 'warning', detail: notificationsConfigured() ? '签名 Webhook 已配置' : '未配置外部通知通道' })
  checks.push({ id: 'backup', label: '备份目录', status: existsSync(config.backupDir) ? 'ok' : 'error', detail: existsSync(config.backupDir) ? `${listBackups().length} 个本地备份可用` : '备份目录不存在' })
  checks.push({ id: 'update-signing', label: '更新签名', status: config.updateManifestUrl && config.updatePublicKey ? 'ok' : 'warning', detail: config.updateManifestUrl && config.updatePublicKey ? 'Ed25519 更新清单校验已配置' : '发布前需要配置更新清单地址和 Ed25519 公钥' })
  return { overall: checks.some((check) => check.status === 'error') ? 'degraded' : 'ok', checkedAt: new Date().toISOString(), checks }
}

async function checkedSystemUpdate() {
  try {
    return await checkForUpdate()
  } catch (error) {
    throw new HttpError(502, error instanceof Error ? error.message : '版本检测失败，请检查更新源配置')
  }
}

async function applySystemUpdate() {
  try {
    return await installUpdate()
  } catch (error) {
    throw new HttpError(502, error instanceof Error ? error.message : '系统更新失败，请检查更新源和执行器配置')
  }
}

async function api(request: AuthenticatedRequest, response: ServerResponse, url: URL) {
  const method = request.method || 'GET'
  checkOrigin(request)

  if (method === 'GET' && url.pathname === '/api/health') {
    sendJson(response, 200, { ok: true, service: 'jtwz-api', time: new Date().toISOString() })
    return
  }
  if (method === 'GET' && url.pathname === '/api/public/settings') {
    sendJson(response, 200, { settings: publicSettings() })
    return
  }
  if (method === 'GET' && url.pathname === '/api/public/brand/logo') {
    const row = db.prepare('SELECT logo_path FROM settings WHERE id = 1').get() as Row
    const logoPath = String(row.logo_path || '')
    if (!logoPath) throw new HttpError(404, '品牌 Logo 尚未配置')
    const filePath = resolve(config.brandAssetsDir, logoPath)
    if (!filePath.startsWith(`${config.brandAssetsDir}${sep}`) || !existsSync(filePath)) throw new HttpError(404, '品牌 Logo 文件不存在')
    response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream', 'Content-Length': statSync(filePath).size, 'Cache-Control': 'public, max-age=31536000, immutable' })
    createReadStream(filePath).pipe(response)
    return
  }
  if (method === 'GET' && url.pathname === '/api/public/software') {
    const software = db.prepare("SELECT * FROM software WHERE status IN ('published', 'testing') ORDER BY created_at ASC").all().map((raw) => {
      const item = mapSoftware(raw as Row)
      const packageRow = db.prepare(`SELECT packages.id, packages.size FROM packages
        JOIN software_versions ON software_versions.id = packages.version_id
        WHERE packages.software_id = ? AND packages.status = 'available' AND software_versions.status = 'published'
        ORDER BY software_versions.is_recommended DESC, packages.created_at DESC LIMIT 1`).get(item.id) as Row | undefined
      return packageRow ? { ...item, size: String(packageRow.size), downloadUrl: signedDownloadPath(String(packageRow.id)) } : item
    })
    sendJson(response, 200, { software })
    return
  }
  const publicSoftwareMatch = url.pathname.match(/^\/api\/public\/software\/([^/]+)$/)
  if (method === 'GET' && publicSoftwareMatch) {
    const slug = decodeURIComponent(publicSoftwareMatch[1])
    const raw = db.prepare("SELECT * FROM software WHERE slug = ? AND status IN ('published', 'testing')").get(slug) as Row | undefined
    if (!raw) throw new HttpError(404, '软件不存在')
    const software = mapSoftware(raw)
    const packages = db.prepare(`SELECT packages.id, packages.file_name AS fileName, packages.version, packages.platform, packages.size,
      packages.byte_size AS byteSize, packages.sha256, software_versions.release_notes AS releaseNotes,
      packages.downloads, packages.created_at AS createdAt
      FROM packages JOIN software_versions ON software_versions.id = packages.version_id
      WHERE packages.software_id = ? AND packages.status = 'available' AND software_versions.status = 'published'
      ORDER BY software_versions.is_recommended DESC, packages.created_at DESC`).all(software.id).map((item) => {
      const row = item as Row
      return { ...row, downloadUrl: signedDownloadPath(String(row.id)) }
    })
    sendJson(response, 200, { software, packages })
    return
  }
  if (method === 'GET' && url.pathname === '/api/public/announcements') {
    sendJson(response, 200, { announcements: listAnnouncements(true) })
    return
  }

  const certificateCallbackMatch = url.pathname.match(/^\/api\/public\/domains\/([^/]+)\/certificate-callback$/)
  if (certificateCallbackMatch && method === 'POST') {
    const callbackToken = String(request.headers['x-jtwz-callback-token'] || request.headers['x-aurelia-callback-token'] || '')
    const expectedCallbackToken = Buffer.from(config.certificateCallbackSecret)
    const actualCallbackToken = Buffer.from(callbackToken)
    if (!callbackToken || expectedCallbackToken.length !== actualCallbackToken.length || !timingSafeEqual(expectedCallbackToken, actualCallbackToken)) throw new HttpError(401, '证书回调凭证无效')
    const id = decodeURIComponent(certificateCallbackMatch[1])
    const row = db.prepare('SELECT hostname FROM domains WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new HttpError(404, '域名不存在')
    const body = await readJson<{ status?: string; detail?: string; externalRef?: string; issuer?: string; serialNumber?: string; issuedAt?: string; expiresAt?: string }>(request)
    const status = parseStatus(body.status, ['pending', 'active', 'error'], 'pending')
    const timestamp = new Date().toISOString()
    const pending = db.prepare("SELECT id FROM certificates WHERE domain_id = ? AND provider = 'webhook' AND status = 'pending' ORDER BY created_at DESC LIMIT 1").get(id) as Row | undefined
    if (status === 'active') {
      saveProviderCertificate(id, {
        provider: 'webhook', status: 'active', externalRef: String(body.externalRef || 'webhook'), issuer: String(body.issuer || 'Webhook certificate provider'),
        serialNumber: String(body.serialNumber || ''), issuedAt: body.issuedAt || timestamp, expiresAt: body.expiresAt,
      }, pending ? String(pending.id) : '')
    } else if (pending) {
      db.prepare('UPDATE certificates SET status = ?, last_error = ?, updated_at = ? WHERE id = ?')
        .run(status, status === 'error' ? String(body.detail || '外部证书服务回调失败') : '', timestamp, String(pending.id))
      syncDomainCertificateStatus(id)
    } else {
      db.prepare('UPDATE domains SET certificate_status = ?, updated_at = ? WHERE id = ?').run(status, timestamp, id)
    }
    audit(null, `certificate_callback_${status}`, 'domain', id, String(body.detail || row.hostname))
    if (status === 'error') notifyAlert({ type: 'certificate_failed', title: '外部证书服务回调失败', detail: String(body.detail || row.hostname), entityId: id })
    sendJson(response, 200, { ok: true, domainId: id, status })
    return
  }

  const publicDownloadMatch = url.pathname.match(/^\/api\/public\/files\/([^/]+)\/download$/)
  if (method === 'GET' && publicDownloadMatch) {
    const id = decodeURIComponent(publicDownloadMatch[1])
    const expires = Number(url.searchParams.get('expires'))
    const signature = url.searchParams.get('signature') || ''
    if (!verifyDownloadSignature(id, expires, signature)) throw new HttpError(403, '下载链接无效或已经过期')
    const row = db.prepare(`SELECT packages.* FROM packages
      JOIN software_versions ON software_versions.id = packages.version_id
      WHERE packages.id = ? AND packages.status = 'available' AND software_versions.status = 'published'`).get(id) as Row | undefined
    if (!row) throw new HttpError(404, '安装包不存在或已暂停下载')
    const fileName = String(row.file_name)
    const fallbackName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_') || 'download.bin'
    let directUrl = ''
    let filePath = ''
    if (objectStorageMode === 's3') {
      directUrl = createStorageDownload(String(row.object_key))
      if (!directUrl) throw new HttpError(503, '对象存储下载地址生成失败')
    } else {
      filePath = safeStoragePath(config.storageDir, String(row.object_key))
      if (!existsSync(filePath)) throw new HttpError(404, '安装包文件不存在')
    }
    const timestamp = new Date().toISOString()
    db.prepare('UPDATE packages SET downloads = downloads + 1, updated_at = ? WHERE id = ?').run(timestamp, id)
    if (row.software_id) db.prepare('UPDATE software SET downloads = downloads + 1, updated_at = ? WHERE id = ?').run(timestamp, String(row.software_id))
    db.prepare(`INSERT INTO analytics_events (id, event_type, domain_id, path, referrer, user_agent, created_at)
      VALUES (?, 'download', NULL, ?, ?, ?, ?)`)
      .run(randomUUID(), fileName, String(request.headers.referer || ''), String(request.headers['user-agent'] || ''), timestamp)
    if (objectStorageMode === 's3') {
      response.writeHead(302, { Location: directUrl, 'Cache-Control': 'private, no-store' })
      response.end()
      return
    }
    response.writeHead(200, {
      'Content-Type': String(row.mime_type || 'application/octet-stream'),
      'Content-Length': statSync(filePath).size,
      'Content-Disposition': `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'private, no-store',
    })
    createReadStream(filePath).pipe(response)
    return
  }

  if (await handleAuthRoutes(request, response, url)) return

  const admin = requireAdmin(request)
  enforceAdminRateLimit(request, admin.id)
  requireCsrf(request, admin.csrfToken)
  if (await handleSecurityRoutes(request, response, url)) return
  requirePermission(admin, permissionForRequest(method, url.pathname))

  if (method === 'PUT' && url.pathname === '/api/admin/account') {
    const body = await readJson<{ currentPassword?: string; newPassword?: string; newUsername?: string }>(request)
    const currentPassword = String(body.currentPassword || '')
    const newPassword = String(body.newPassword || '')
    const newUsername = String(body.newUsername || admin.username).trim()
    const row = db.prepare('SELECT password_hash FROM admins WHERE id = ?').get(admin.id) as Row | undefined
    if (!row || !verifyPassword(currentPassword, String(row.password_hash))) throw new HttpError(400, '当前密码不正确')
    if (!/^[A-Za-z0-9._-]{3,64}$/.test(newUsername)) throw new HttpError(400, '管理员账号需为 3-64 位字母、数字、点、下划线或短横线')
    if (newPassword.length < 6 || newPassword.length > 160) throw new HttpError(400, '新密码长度需要在 6 到 160 个字符之间')
    const conflict = db.prepare('SELECT id FROM admins WHERE username = ? AND id <> ?').get(newUsername, admin.id)
    if (conflict) throw new HttpError(409, '新的管理员账号已经存在')
    db.prepare('UPDATE admins SET username = ?, password_hash = ? WHERE id = ?').run(newUsername, hashPassword(newPassword), admin.id)
    const currentToken = parseCookies(request)[config.cookieName]
    if (currentToken) db.prepare('DELETE FROM sessions WHERE admin_id = ? AND token_hash <> ?').run(admin.id, hashToken(currentToken))
    audit(admin.id, 'account_change', 'admin', admin.id, `账号更新为 ${newUsername}`)
    sendJson(response, 200, { ok: true })
    return
  }

  if (method === 'GET' && url.pathname === '/api/admin/access') {
    sendJson(response, 200, { access: adminAccess(request) })
    return
  }

  if (method === 'PUT' && url.pathname === '/api/admin/access') {
    const body = await readJson<{ currentPassword?: string; adminBasePath?: string }>(request)
    const row = db.prepare('SELECT password_hash FROM admins WHERE id = ?').get(admin.id) as Row | undefined
    if (!row || !verifyPassword(String(body.currentPassword || ''), String(row.password_hash))) throw new HttpError(400, '当前密码不正确')
    let nextPath: string
    try {
      nextPath = normalizeAdminBasePath(body.adminBasePath)
    } catch (error) {
      throw new HttpError(400, error instanceof Error ? error.message : '管理入口后缀无效')
    }
    if (nextPath !== activeAdminBasePath) {
      disabledAdminBasePaths.add(activeAdminBasePath)
      disabledAdminBasePaths.delete(nextPath)
      const previousPath = activeAdminBasePath
      activeAdminBasePath = nextPath
      writeEnvironmentValues({
        ADMIN_BASE_PATH: activeAdminBasePath,
        ADMIN_DISABLED_PATHS: [...disabledAdminBasePaths].join(','),
        ADMIN_LOGIN_URL: `${config.adminAppOrigin.replace(/\/$/, '')}${activeAdminBasePath}/login`,
      })
      audit(admin.id, 'update', 'admin_access', '', `${previousPath} -> ${activeAdminBasePath}`)
    }
    sendJson(response, 200, { access: adminAccess(request) })
    return
  }

  if (method === 'GET' && url.pathname === '/api/admin/bootstrap') {
    const domains = listDomains()
    const sites = db.prepare('SELECT * FROM sites ORDER BY created_at ASC').all().map((row) => mapSite(row as Row))
    const software = db.prepare('SELECT * FROM software ORDER BY created_at ASC').all().map((row) => mapSoftware(row as Row))
    const audits = db.prepare(`SELECT audit_logs.action, audit_logs.entity_type AS entityType, audit_logs.entity_id AS entityId, audit_logs.detail,
      audit_logs.request_id AS requestId, audit_logs.ip_address AS ipAddress, COALESCE(admins.display_name, admins.username, '系统') AS adminName,
      audit_logs.created_at AS createdAt FROM audit_logs LEFT JOIN admins ON admins.id = audit_logs.admin_id ORDER BY audit_logs.created_at DESC LIMIT 20`).all()
    sendJson(response, 200, {
      settings: publicSettings(), domains, sites, software, packages: packagesWithUrls(), redirectRules: listRedirectRules(), audits: admin.permissions.includes('audit.read') ? audits : [],
      analytics: admin.permissions.includes('analytics.read') ? buildAnalytics(30) : null, storage: { provider: objectStorageMode, directUpload: true, configured: isStorageConfigured() }, dns: dnsProviderStatus(), certificate: certificateProviderStatus(), alerts: buildAlerts(), notifications: { configured: notificationsConfigured() },
    })
    return
  }

  if (method === 'GET' && url.pathname === '/api/tasks') {
    const status = String(url.searchParams.get('status') || '')
    if (status && !['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(status)) throw new HttpError(400, '任务状态筛选无效')
    sendJson(response, 200, { tasks: listTasks({ status, entityType: String(url.searchParams.get('entityType') || ''), entityId: String(url.searchParams.get('entityId') || ''), limit: Number(url.searchParams.get('limit') || 100) }) })
    return
  }
  const taskMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)$/)
  if (taskMatch && method === 'GET') {
    const task = getTask(decodeURIComponent(taskMatch[1]))
    if (!task) throw new HttpError(404, '任务不存在')
    sendJson(response, 200, { task })
    return
  }
  const taskCancelMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/cancel$/)
  if (taskCancelMatch && method === 'POST') {
    const task = cancelTask(decodeURIComponent(taskCancelMatch[1]))
    if (!task) throw new HttpError(404, '任务不存在')
    audit(admin.id, 'task_cancel', 'task', task.id, task.label)
    sendJson(response, 200, { task })
    return
  }
  const taskRetryMatch = url.pathname.match(/^\/api\/tasks\/([^/]+)\/retry$/)
  if (taskRetryMatch && method === 'POST') {
    const source = getTask(decodeURIComponent(taskRetryMatch[1]))
    if (!source) throw new HttpError(404, '任务不存在')
    if (!source.retryable || source.status !== 'failed') throw new HttpError(409, '该任务当前不能重试')
    const retry = createTask({ kind: source.kind, label: source.label, entityType: source.entityType, entityId: source.entityId, input: source.input, retryable: true, retryOf: source.id })
    audit(admin.id, 'task_retry', 'task', retry.id, `${source.id} → ${retry.id}`)
    if (['certificate_issue', 'certificate_renew'].includes(retry.kind)) {
      const result = await runCertificateOperationTask(retry.id, admin.id)
      sendJson(response, 200, result)
      return
    }
    if (retry.kind === 'site_publish') {
      sendJson(response, 200, await publishSiteTask(retry.id, admin.id))
      return
    }
    if (retry.kind === 'site_rollback') {
      sendJson(response, 200, await rollbackSiteTask(retry.id, admin.id))
      return
    }
    if (retry.kind === 'package_upload') {
      const uploadId = String(retry.input.uploadId || retry.entityId)
      const session = db.prepare("SELECT * FROM upload_sessions WHERE id = ? AND status IN ('uploading', 'paused', 'failed')").get(uploadId) as Row | undefined
      if (!session) {
        updateTask(retry.id, { status: 'failed', message: '续传会话不存在', error: '服务器已清理临时分片，请重新上传文件', log: { level: 'error', message: '没有找到可恢复的上传会话' } })
        throw new HttpError(409, '服务器已清理临时分片，请重新上传文件')
      }
      db.prepare("UPDATE upload_sessions SET status = 'paused', updated_at = ? WHERE id = ?").run(new Date().toISOString(), uploadId)
      const received = JSON.parse(String(session.received_chunks || '[]')) as number[]
      updateTask(retry.id, { status: 'running', progress: Math.round(received.length / Number(session.total_chunks) * 90), message: '请到安装包页面重新选择原文件继续上传', log: { level: 'info', message: `服务器保留 ${received.length}/${Number(session.total_chunks)} 个分片` } })
      sendJson(response, 200, { task: getTask(retry.id), uploadId })
      return
    }
    throw new HttpError(409, '该任务类型尚不支持自动重试')
  }

  if (method === 'GET' && url.pathname === '/api/analytics') {
    sendJson(response, 200, { analytics: buildAnalytics(Number(url.searchParams.get('days') || 30)) })
    return
  }
  if (method === 'GET' && url.pathname === '/api/alerts') {
    sendJson(response, 200, { alerts: buildAlerts() })
    return
  }
  if (method === 'POST' && url.pathname === '/api/alerts/test') {
    notifyAlert({ type: 'test', title: '告警通道测试', detail: '这是一条来自管理后台的测试通知。' })
    sendJson(response, 200, { ok: true, configured: notificationsConfigured() })
    return
  }
  if (method === 'GET' && url.pathname === '/api/admin/backups') {
    sendJson(response, 200, { backups: listBackups(), intervalHours: config.backupIntervalHours, retentionDays: config.backupRetentionDays })
    return
  }
  if (method === 'GET' && url.pathname === '/api/admin/health') {
    sendJson(response, 200, { health: buildSystemHealth() })
    return
  }
  if (method === 'GET' && url.pathname === '/api/admin/system/update') {
    sendJson(response, 200, { update: await checkedSystemUpdate() })
    return
  }
  if (method === 'GET' && url.pathname === '/api/admin/system/update/state') {
    sendJson(response, 200, { state: getUpdateState(), currentVersion: config.systemVersion, checkedAt: new Date().toISOString() })
    return
  }
  if (method === 'GET' && url.pathname === '/api/admin/system/config') {
    sendJson(response, 200, { config: systemConfiguration() })
    return
  }
  if (method === 'PUT' && url.pathname === '/api/admin/system/config') {
    const body = await readJson<Record<string, unknown>>(request)
    const storageProvider = String(body.storageProvider ?? config.storageProvider).toLowerCase()
    const dnsProvider = String(body.dnsProvider ?? config.dnsProvider).toLowerCase()
    const certificateProvider = String(body.certificateProvider ?? config.certificateProvider).toLowerCase()
    if (!['local', 's3'].includes(storageProvider)) throw new HttpError(400, '存储方式仅支持 local 或 s3')
    if (!['manual', 'cloudflare', 'webhook'].includes(dnsProvider)) throw new HttpError(400, 'DNS 服务商配置无效')
    if (!['manual', 'certbot', 'cloudflare', 'webhook'].includes(certificateProvider)) throw new HttpError(400, '证书服务商配置无效')
    const next = {
      storageProvider,
      s3Endpoint: validatedOptionalUrl(body.s3Endpoint ?? config.s3Endpoint, 'S3 Endpoint'),
      s3Region: String(body.s3Region ?? config.s3Region).trim() || 'auto',
      s3Bucket: String(body.s3Bucket ?? config.s3Bucket).trim(),
      s3AccessKey: configuredSecret(body, 's3AccessKey', 'clearS3AccessKey', config.s3AccessKey),
      s3SecretKey: configuredSecret(body, 's3SecretKey', 'clearS3SecretKey', config.s3SecretKey),
      s3PublicBaseUrl: validatedOptionalUrl(body.s3PublicBaseUrl ?? config.s3PublicBaseUrl, 'S3 公开地址'),
      dnsProvider,
      certificateProvider,
      cloudflareApiToken: configuredSecret(body, 'cloudflareApiToken', 'clearCloudflareApiToken', config.cloudflareApiToken),
      dnsWebhookUrl: validatedOptionalUrl(body.dnsWebhookUrl ?? config.dnsWebhookUrl, 'DNS Webhook 地址'),
      dnsWebhookSecret: configuredSecret(body, 'dnsWebhookSecret', 'clearDnsWebhookSecret', config.dnsWebhookSecret),
      alertWebhookUrl: validatedOptionalUrl(body.alertWebhookUrl ?? config.alertWebhookUrl, '告警 Webhook 地址'),
      alertWebhookSecret: configuredSecret(body, 'alertWebhookSecret', 'clearAlertWebhookSecret', config.alertWebhookSecret),
    }
    if (storageProvider === 's3' && (!next.s3Endpoint || !next.s3Bucket || !next.s3AccessKey || !next.s3SecretKey)) throw new HttpError(400, '启用 S3 前请完整填写 Endpoint、Bucket、Access Key 和 Secret Key')
    if (dnsProvider === 'cloudflare' && !next.cloudflareApiToken) throw new HttpError(400, '启用 Cloudflare DNS 前请填写 API Token')
    if (dnsProvider === 'webhook' && !next.dnsWebhookUrl) throw new HttpError(400, '启用 DNS Webhook 前请填写 Webhook 地址')
    if (certificateProvider === 'cloudflare' && !next.cloudflareApiToken) throw new HttpError(400, '使用 Cloudflare 证书前请填写 API Token')
    if (certificateProvider === 'webhook' && !next.dnsWebhookUrl) throw new HttpError(400, '使用 Webhook 证书服务前请填写 Webhook 地址')
    if (certificateProvider === 'certbot' && !domainAutomationConfigured()) throw new HttpError(409, '当前安装未配置本机 Certbot 执行器，请重新运行一键安装脚本完成升级')
    writeEnvironmentValues({
      STORAGE_PROVIDER: next.storageProvider, S3_ENDPOINT: next.s3Endpoint, S3_REGION: next.s3Region, S3_BUCKET: next.s3Bucket,
      S3_ACCESS_KEY: next.s3AccessKey, S3_SECRET_KEY: next.s3SecretKey, S3_PUBLIC_BASE_URL: next.s3PublicBaseUrl,
      DNS_PROVIDER: next.dnsProvider, CERTIFICATE_PROVIDER: next.certificateProvider, CLOUDFLARE_API_TOKEN: next.cloudflareApiToken,
      DNS_WEBHOOK_URL: next.dnsWebhookUrl, DNS_WEBHOOK_SECRET: next.dnsWebhookSecret,
      ALERT_WEBHOOK_URL: next.alertWebhookUrl, ALERT_WEBHOOK_SECRET: next.alertWebhookSecret,
    })
    Object.assign(config, next)
    refreshObjectStorageMode()
    audit(admin.id, 'update', 'system_config', 'runtime', `${next.storageProvider} / ${next.dnsProvider} / ${next.certificateProvider}`)
    sendJson(response, 200, { config: systemConfiguration() })
    return
  }
  if (method === 'POST' && url.pathname === '/api/settings/logo') {
    const fileName = safeFileName(url.searchParams.get('fileName') || '')
    const extension = extname(fileName).toLowerCase()
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(extension)) throw new HttpError(400, 'Logo 仅支持 PNG、JPEG 或 WebP')
    mkdirSync(config.brandAssetsDir, { recursive: true })
    const storedName = `logo-${randomUUID()}${extension === '.jpeg' ? '.jpg' : extension}`
    const filePath = resolve(config.brandAssetsDir, storedName)
    await writeRequestToFile(request, filePath, 2 * 1024 * 1024)
    const signature = readFileSync(filePath).subarray(0, 12)
    const valid = extension === '.png'
      ? signature.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      : ['.jpg', '.jpeg'].includes(extension)
        ? signature[0] === 0xff && signature[1] === 0xd8 && signature[2] === 0xff
        : signature.subarray(0, 4).toString('ascii') === 'RIFF' && signature.subarray(8, 12).toString('ascii') === 'WEBP'
    if (!valid) {
      rmSync(filePath, { force: true })
      throw new HttpError(400, 'Logo 文件内容与图片格式不匹配')
    }
    const current = db.prepare('SELECT logo_path FROM settings WHERE id = 1').get() as Row
    const timestamp = new Date().toISOString()
    db.prepare('UPDATE settings SET logo_path = ?, updated_at = ? WHERE id = 1').run(storedName, timestamp)
    const previous = String(current.logo_path || '')
    if (previous) {
      const previousPath = resolve(config.brandAssetsDir, previous)
      if (previousPath.startsWith(`${config.brandAssetsDir}${sep}`)) rmSync(previousPath, { force: true })
    }
    audit(admin.id, 'update', 'brand_logo', '1', storedName)
    sendJson(response, 200, { settings: publicSettings() })
    return
  }
  if (method === 'DELETE' && url.pathname === '/api/settings/logo') {
    const current = db.prepare('SELECT logo_path FROM settings WHERE id = 1').get() as Row
    const previous = String(current.logo_path || '')
    db.prepare("UPDATE settings SET logo_path = '', updated_at = ? WHERE id = 1").run(new Date().toISOString())
    if (previous) {
      const previousPath = resolve(config.brandAssetsDir, previous)
      if (previousPath.startsWith(`${config.brandAssetsDir}${sep}`)) rmSync(previousPath, { force: true })
    }
    audit(admin.id, 'delete', 'brand_logo', '1', previous)
    sendJson(response, 200, { settings: publicSettings() })
    return
  }
  if (method === 'POST' && url.pathname === '/api/admin/system/update/check') {
    const update = await checkedSystemUpdate()
    audit(admin.id, 'update_check', 'system', '1', update.configured ? String('latestVersion' in update ? update.latestVersion : config.systemVersion) : '未配置更新源')
    sendJson(response, 200, { update })
    return
  }
  if (method === 'POST' && url.pathname === '/api/admin/system/update/install') {
    const update = await applySystemUpdate()
    audit(admin.id, 'update_install', 'system', '1', `${update.version} / ${update.applyStarted ? '执行器已启动' : '已暂存'}`)
    sendJson(response, 202, { update })
    return
  }
  if (method === 'GET' && url.pathname === '/api/versions') {
    const softwareId = String(url.searchParams.get('softwareId') || '')
    sendJson(response, 200, { versions: listSoftwareVersions(softwareId) })
    return
  }
  if (method === 'POST' && url.pathname === '/api/versions') {
    const body = await readJson<Record<string, unknown>>(request)
    const softwareId = String(body.softwareId || '')
    const software = db.prepare('SELECT id, name FROM software WHERE id = ?').get(softwareId) as Row | undefined
    if (!software) throw new HttpError(404, '请选择有效的软件产品')
    const version = String(body.version || '').trim()
    if (!version || version.length > 80) throw new HttpError(400, '请输入有效版本号')
    const channel = parseStatus(body.channel, ['stable', 'beta', 'alpha'], 'stable')
    let status = parseStatus(body.status, ['draft', 'published', 'archived'], 'draft')
    const isRecommended = body.isRecommended === true
    if (isRecommended) status = 'published'
    if (status === 'published') throw new HttpError(409, '请先创建草稿版本并上传至少一个可用安装包，再发布版本')
    const id = randomUUID()
    const timestamp = new Date().toISOString()
    db.exec('BEGIN IMMEDIATE')
    try {
      if (isRecommended) db.prepare('UPDATE software_versions SET is_recommended = 0, updated_at = ? WHERE software_id = ?').run(timestamp, softwareId)
      db.prepare(`INSERT INTO software_versions
        (id, software_id, version, channel, release_notes, status, is_recommended, published_at, updated_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(id, softwareId, version, channel, String(body.releaseNotes || '').slice(0, 10000), status, isRecommended ? 1 : 0,
          status === 'published' ? timestamp : null, timestamp, timestamp)
      if (isRecommended) syncSoftwareRecommendedVersion(softwareId)
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      if (String(error).includes('UNIQUE')) throw new HttpError(409, '该软件已经存在相同版本号')
      throw error
    }
    audit(admin.id, 'create', 'software_version', id, `${String(software.name)} ${version}`)
    sendJson(response, 201, { version: listSoftwareVersions(softwareId).find((item) => item.id === id) })
    return
  }
  const versionMatch = url.pathname.match(/^\/api\/versions\/([^/]+)$/)
  if (versionMatch && ['PUT', 'PATCH'].includes(method)) {
    const id = decodeURIComponent(versionMatch[1])
    const current = db.prepare('SELECT * FROM software_versions WHERE id = ?').get(id) as Row | undefined
    if (!current) throw new HttpError(404, '版本不存在')
    const body = await readJson<Record<string, unknown>>(request)
    const version = String(body.version ?? current.version).trim()
    const releaseNotes = String(body.releaseNotes ?? current.release_notes ?? '').slice(0, 10000)
    const channel = parseStatus(body.channel ?? current.channel, ['stable', 'beta', 'alpha'], String(current.channel))
    let status = parseStatus(body.status ?? current.status, ['draft', 'published', 'archived'], String(current.status))
    const isRecommended = body.isRecommended === undefined ? Boolean(current.is_recommended) : body.isRecommended === true
    if (!version || version.length > 80) throw new HttpError(400, '请输入有效版本号')
    if (isRecommended) status = 'published'
    if (status === 'published') {
      const availablePackages = Number((db.prepare("SELECT COUNT(*) AS count FROM packages WHERE version_id = ? AND status = 'available'").get(id) as Row).count)
      if (!availablePackages) throw new HttpError(409, '发布版本前至少需要一个可用安装包')
    }
    const timestamp = new Date().toISOString()
    db.exec('BEGIN IMMEDIATE')
    try {
      if (isRecommended) db.prepare('UPDATE software_versions SET is_recommended = 0, updated_at = ? WHERE software_id = ? AND id <> ?').run(timestamp, String(current.software_id), id)
      db.prepare(`UPDATE software_versions SET version = ?, channel = ?, release_notes = ?, status = ?, is_recommended = ?,
        published_at = ?, updated_at = ? WHERE id = ?`)
        .run(version, channel, releaseNotes, status, isRecommended ? 1 : 0,
          status === 'published' ? String(current.published_at || timestamp) : null, timestamp, id)
      db.prepare('UPDATE packages SET version = ?, release_notes = ?, updated_at = ? WHERE version_id = ?').run(version, releaseNotes, timestamp, id)
      syncSoftwareRecommendedVersion(String(current.software_id))
      db.exec('COMMIT')
    } catch (error) {
      db.exec('ROLLBACK')
      if (String(error).includes('UNIQUE')) throw new HttpError(409, '该软件已经存在相同版本号')
      throw error
    }
    audit(admin.id, 'update', 'software_version', id, `${version} / ${status}`)
    sendJson(response, 200, { version: listSoftwareVersions(String(current.software_id)).find((item) => item.id === id) })
    return
  }
  if (versionMatch && method === 'DELETE') {
    const id = decodeURIComponent(versionMatch[1])
    const current = db.prepare('SELECT * FROM software_versions WHERE id = ?').get(id) as Row | undefined
    if (!current) throw new HttpError(404, '版本不存在')
    const packageCount = Number((db.prepare('SELECT COUNT(*) AS count FROM packages WHERE version_id = ?').get(id) as Row).count)
    if (packageCount > 0) throw new HttpError(409, `该版本仍关联 ${packageCount} 个安装包，请先删除安装包`)
    db.prepare('DELETE FROM software_versions WHERE id = ?').run(id)
    syncSoftwareRecommendedVersion(String(current.software_id))
    audit(admin.id, 'delete', 'software_version', id, String(current.version))
    sendJson(response, 200, { ok: true })
    return
  }
  if (method === 'GET' && url.pathname === '/api/announcements') {
    sendJson(response, 200, { announcements: listAnnouncements() })
    return
  }
  if (method === 'POST' && url.pathname === '/api/announcements') {
    const body = await readJson<Record<string, unknown>>(request)
    const title = String(body.title || '').trim()
    const detail = String(body.body || '').trim()
    if (!title || !detail) throw new HttpError(400, '公告标题和内容不能为空')
    const id = randomUUID()
    const status = parseStatus(body.status, ['published', 'draft'], 'draft')
    const pinned = body.pinned === true ? 1 : 0
    const timestamp = new Date().toISOString()
    db.prepare('INSERT INTO announcements (id, title, body, status, pinned, published_at, updated_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(id, title, detail, status, pinned, status === 'published' ? timestamp : null, timestamp, timestamp)
    audit(admin.id, 'create', 'announcement', id, title)
    sendJson(response, 201, { announcement: listAnnouncements().find((item) => item.id === id) })
    return
  }
  const announcementMatch = url.pathname.match(/^\/api\/announcements\/([^/]+)$/)
  if (announcementMatch && method === 'PUT') {
    const id = decodeURIComponent(announcementMatch[1])
    const current = db.prepare('SELECT * FROM announcements WHERE id = ?').get(id) as Row | undefined
    if (!current) throw new HttpError(404, '公告不存在')
    const body = await readJson<Record<string, unknown>>(request)
    const title = String(body.title ?? current.title).trim()
    const detail = String(body.body ?? current.body).trim()
    const status = parseStatus(body.status, ['published', 'draft'], String(current.status))
    const pinned = body.pinned === undefined ? Number(current.pinned) : body.pinned === true ? 1 : 0
    if (!title || !detail) throw new HttpError(400, '公告标题和内容不能为空')
    const timestamp = new Date().toISOString()
    db.prepare('UPDATE announcements SET title = ?, body = ?, status = ?, pinned = ?, published_at = ?, updated_at = ? WHERE id = ?').run(title, detail, status, pinned, status === 'published' ? String(current.published_at || timestamp) : null, timestamp, id)
    audit(admin.id, 'update', 'announcement', id, title)
    sendJson(response, 200, { announcement: listAnnouncements().find((item) => item.id === id) })
    return
  }
  if (announcementMatch && method === 'DELETE') {
    const id = decodeURIComponent(announcementMatch[1])
    const current = db.prepare('SELECT title FROM announcements WHERE id = ?').get(id) as Row | undefined
    if (!current) throw new HttpError(404, '公告不存在')
    db.prepare('DELETE FROM announcements WHERE id = ?').run(id)
    audit(admin.id, 'delete', 'announcement', id, String(current.title))
    sendJson(response, 200, { ok: true })
    return
  }
  if (method === 'POST' && url.pathname === '/api/admin/backups/create') {
    const backup = await createBackup()
    audit(admin.id, 'backup_create', 'database', '1', backup.fileName)
    sendJson(response, 201, { backup })
    return
  }
  const backupDownloadMatch = url.pathname.match(/^\/api\/admin\/backups\/([^/]+)\/download$/)
  if (backupDownloadMatch && method === 'GET') {
    let filePath: string
    try { filePath = backupFilePath(decodeURIComponent(backupDownloadMatch[1])) } catch { throw new HttpError(404, '备份文件不存在') }
    response.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': statSync(filePath).size, 'Content-Disposition': `attachment; filename="${basename(filePath)}"` })
    createReadStream(filePath).pipe(response)
    return
  }
  if (method === 'POST' && url.pathname === '/api/admin/import') {
    const restoreId = randomUUID()
    const archivePath = resolve(config.tempDir, `restore-upload-${restoreId}.jtwz-backup`)
    try {
      await writeRequestToFile(request, archivePath, config.maxBackupBytes)
      const result = await restoreBackupWithRollback(archivePath)
      if (result.restored.adminBasePath) {
        disabledAdminBasePaths.add(activeAdminBasePath)
        activeAdminBasePath = normalizeAdminBasePath(result.restored.adminBasePath)
        disabledAdminBasePaths.delete(activeAdminBasePath)
      }
      audit(null, 'restore', 'database', '1', `来源 ${result.restored.sourceExportedAt} / 回滚备份 ${result.rollbackBackup.fileName}`)
      sendJson(response, 200, { ok: true, ...result })
    } finally {
      rmSync(archivePath, { force: true })
    }
    return
  }

  if (method === 'GET' && url.pathname === '/api/domains') {
    sendJson(response, 200, { domains: listDomains() })
    return
  }
  if (method === 'POST' && url.pathname === '/api/domains') {
    const body = await readJson<Record<string, unknown>>(request)
    const hostname = normalizeHostname(String(body.hostname || ''))
    const mode = String(body.mode || 'redirect')
    const allowedModes = ['redirect', 'site', 'download', 'maintenance']
    if (!isValidHostname(hostname)) throw new HttpError(400, '请输入有效的域名')
    if (!allowedModes.includes(mode)) throw new HttpError(400, '运行模式无效')
    const target = String(body.target || '').trim()
    if (['redirect', 'download'].includes(mode) && target) normalizeTarget(target)
    if (mode === 'site' && !db.prepare("SELECT id FROM sites WHERE id = ? AND status = 'published'").get(target)) throw new HttpError(409, '请选择一个已经发布的静态网站')
    const id = randomUUID()
    const verificationToken = randomUUID()
    const timestamp = new Date().toISOString()
    try {
      db.prepare(`INSERT INTO domains
        (id, hostname, mode, target, status, redirect_code, preserve_path, preserve_query, force_https, verification_token, dns_status, certificate_status, visits, updated_at, created_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, 'unverified', 'pending', 0, ?, ?)`)
        .run(id, hostname, mode, target, Number(body.redirectCode) === 301 ? 301 : 302, body.preservePath === false ? 0 : 1, body.preserveQuery === false ? 0 : 1, body.forceHttps === false ? 0 : 1, verificationToken, timestamp, timestamp)
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new HttpError(409, '该域名已经存在')
      throw error
    }
    let routeWarning = ''
    try {
      await configureDomainRoute(hostname)
    } catch (error) {
      routeWarning = error instanceof Error ? error.message : '服务器入口配置失败'
      audit(admin.id, 'domain_route_failed', 'domain', id, `${hostname} / ${routeWarning}`)
    }
    audit(admin.id, 'create', 'domain', id, hostname)
    sendJson(response, 201, { domain: mapDomain(db.prepare('SELECT * FROM domains WHERE id = ?').get(id) as Row), routeWarning })
    return
  }

  const domainMatch = url.pathname.match(/^\/api\/domains\/([^/]+)$/)
  if (domainMatch && method === 'PUT') {
    const id = decodeURIComponent(domainMatch[1])
    const current = db.prepare('SELECT * FROM domains WHERE id = ?').get(id) as Row | undefined
    if (!current) throw new HttpError(404, '域名不存在')
    const body = await readJson<Record<string, unknown>>(request)
    const mode = String(body.mode ?? current.mode)
    const target = String(body.target ?? current.target).trim()
    const status = String(body.status ?? current.status)
    if (!['redirect', 'site', 'download', 'maintenance'].includes(mode)) throw new HttpError(400, '运行模式无效')
    if (!['active', 'pending', 'paused', 'error'].includes(status)) throw new HttpError(400, '域名状态无效')
    if (status === 'active' && String(current.dns_status) !== 'verified') throw new HttpError(409, '域名尚未完成 DNS 所有权验证，不能启用')
    if (['redirect', 'download'].includes(mode)) normalizeTarget(target)
    if (mode === 'site' && !db.prepare("SELECT id FROM sites WHERE id = ? AND status = 'published'").get(target)) throw new HttpError(409, '请选择一个已经发布的静态网站')
    const redirectCode = Number(body.redirectCode ?? current.redirect_code) === 301 ? 301 : 302
    const preservePath = body.preservePath === undefined ? Number(current.preserve_path) : body.preservePath ? 1 : 0
    const preserveQuery = body.preserveQuery === undefined ? Number(current.preserve_query) : body.preserveQuery ? 1 : 0
    const forceHttps = body.forceHttps === undefined ? Number(current.force_https) : body.forceHttps ? 1 : 0
    db.prepare(`UPDATE domains SET mode = ?, target = ?, status = ?, redirect_code = ?, preserve_path = ?,
      preserve_query = ?, force_https = ?, updated_at = ? WHERE id = ?`)
      .run(mode, target, status, redirectCode, preservePath, preserveQuery, forceHttps, new Date().toISOString(), id)
    audit(admin.id, 'update', 'domain', id, `${String(current.hostname)} → ${target}`)
    sendJson(response, 200, { domain: mapDomain(db.prepare('SELECT * FROM domains WHERE id = ?').get(id) as Row) })
    return
  }
  if (domainMatch && method === 'DELETE') {
    const id = decodeURIComponent(domainMatch[1])
    const current = db.prepare('SELECT hostname FROM domains WHERE id = ?').get(id) as Row | undefined
    if (!current) throw new HttpError(404, '域名不存在')
    await removeDomainRoute(String(current.hostname))
    db.prepare('DELETE FROM domains WHERE id = ?').run(id)
    audit(admin.id, 'delete', 'domain', id, String(current.hostname))
    sendJson(response, 200, { ok: true })
    return
  }

  if (method === 'GET' && url.pathname === '/api/certificates') {
    const domainId = String(url.searchParams.get('domainId') || '')
    if (domainId && !db.prepare('SELECT id FROM domains WHERE id = ?').get(domainId)) throw new HttpError(404, '域名不存在')
    sendJson(response, 200, { certificates: listCertificates(domainId) })
    return
  }
  const domainCertificatesMatch = url.pathname.match(/^\/api\/domains\/([^/]+)\/certificates$/)
  if (domainCertificatesMatch && method === 'POST') {
    const domainId = decodeURIComponent(domainCertificatesMatch[1])
    const domain = db.prepare('SELECT hostname, dns_status FROM domains WHERE id = ?').get(domainId) as Row | undefined
    if (!domain) throw new HttpError(404, '域名不存在')
    if (String(domain.dns_status) !== 'verified') throw new HttpError(409, '请先完成 DNS 所有权验证')
    const body = await readJson<Record<string, unknown>>(request)
    const issuer = String(body.issuer || '').trim().slice(0, 240)
    const expiresAt = optionalIsoDate(body.expiresAt, '到期时间')
    const issuedAt = optionalIsoDate(body.issuedAt, '签发时间') || new Date().toISOString()
    if (!issuer) throw new HttpError(400, '请填写证书签发机构')
    if (!expiresAt) throw new HttpError(400, '请填写证书到期时间')
    const expiresTime = Date.parse(expiresAt)
    const status = expiresTime <= Date.now() ? 'expired' : expiresTime <= Date.now() + 30 * 24 * 60 * 60 * 1000 ? 'expiring' : 'active'
    const id = randomUUID()
    const timestamp = new Date().toISOString()
    db.prepare(`INSERT INTO certificates
      (id, domain_id, provider, issuer, serial_number, external_ref, issued_at, expires_at, status, auto_renew, note, last_error, updated_at, created_at)
      VALUES (?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?, '', ?, ?)`)
      .run(id, domainId, issuer, String(body.serialNumber || '').trim().slice(0, 240), String(body.externalRef || '').trim().slice(0, 500), issuedAt, expiresAt, status, body.autoRenew ? 1 : 0, String(body.note || '').trim().slice(0, 1000), timestamp, timestamp)
    syncDomainCertificateStatus(domainId)
    audit(admin.id, 'certificate_add', 'certificate', id, `${String(domain.hostname)} / ${issuer} / ${expiresAt}`)
    sendJson(response, 201, { certificate: listCertificates(domainId).find((item) => item.id === id), domain: mapDomain(db.prepare('SELECT * FROM domains WHERE id = ?').get(domainId) as Row) })
    return
  }
  const certificateDiagnosticsMatch = url.pathname.match(/^\/api\/domains\/([^/]+)\/certificate-diagnostics$/)
  if (certificateDiagnosticsMatch && method === 'GET') {
    const domainId = decodeURIComponent(certificateDiagnosticsMatch[1])
    const domain = db.prepare('SELECT * FROM domains WHERE id = ?').get(domainId) as Row | undefined
    if (!domain) throw new HttpError(404, '域名不存在')
    const failures = db.prepare(`SELECT action, detail, created_at AS createdAt FROM audit_logs
      WHERE entity_id = ? AND action IN ('certificate_failed', 'certificate_callback_error') ORDER BY created_at DESC LIMIT 10`).all(domainId)
    sendJson(response, 200, { domain: mapDomain(domain), provider: certificateProviderStatus(), certificates: listCertificates(domainId), failures })
    return
  }
  const certificateMatch = url.pathname.match(/^\/api\/certificates\/([^/]+)$/)
  if (certificateMatch && method === 'PATCH') {
    const id = decodeURIComponent(certificateMatch[1])
    const current = db.prepare('SELECT certificates.*, domains.hostname FROM certificates JOIN domains ON domains.id = certificates.domain_id WHERE certificates.id = ?').get(id) as Row | undefined
    if (!current) throw new HttpError(404, '证书记录不存在')
    const body = await readJson<Record<string, unknown>>(request)
    const issuer = String(body.issuer ?? current.issuer).trim().slice(0, 240)
    const expiresAt = body.expiresAt === undefined ? (current.expires_at ? String(current.expires_at) : null) : optionalIsoDate(body.expiresAt, '到期时间')
    const note = String(body.note ?? current.note).trim().slice(0, 1000)
    const autoRenew = body.autoRenew === undefined ? Number(current.auto_renew) : body.autoRenew ? 1 : 0
    if (!issuer) throw new HttpError(400, '证书签发机构不能为空')
    if (autoRenew && String(current.provider) === 'manual') throw new HttpError(409, '外部证书不能自动续期；请接入证书服务商后执行续期')
    db.prepare('UPDATE certificates SET issuer = ?, expires_at = ?, auto_renew = ?, note = ?, updated_at = ? WHERE id = ?')
      .run(issuer, expiresAt, autoRenew, note, new Date().toISOString(), id)
    syncDomainCertificateStatus(String(current.domain_id))
    audit(admin.id, 'certificate_update', 'certificate', id, `${String(current.hostname)} / 自动续期 ${Boolean(autoRenew) ? '开启' : '关闭'}`)
    sendJson(response, 200, { certificate: listCertificates(String(current.domain_id)).find((item) => item.id === id), domain: mapDomain(db.prepare('SELECT * FROM domains WHERE id = ?').get(String(current.domain_id)) as Row) })
    return
  }
  if (certificateMatch && method === 'DELETE') {
    const id = decodeURIComponent(certificateMatch[1])
    const current = db.prepare('SELECT certificates.*, domains.hostname FROM certificates JOIN domains ON domains.id = certificates.domain_id WHERE certificates.id = ?').get(id) as Row | undefined
    if (!current) throw new HttpError(404, '证书记录不存在')
    await deleteCertificate(String(current.hostname), String(current.external_ref || ''), String(current.provider || ''))
    db.prepare('DELETE FROM certificates WHERE id = ?').run(id)
    syncDomainCertificateStatus(String(current.domain_id))
    audit(admin.id, 'certificate_delete', 'certificate', id, `${String(current.hostname)} / ${String(current.issuer)}`)
    sendJson(response, 200, { ok: true, domain: mapDomain(db.prepare('SELECT * FROM domains WHERE id = ?').get(String(current.domain_id)) as Row) })
    return
  }
  const certificateRenewMatch = url.pathname.match(/^\/api\/certificates\/([^/]+)\/renew$/)
  if (certificateRenewMatch && method === 'POST') {
    const id = decodeURIComponent(certificateRenewMatch[1])
    const current = db.prepare('SELECT certificates.*, domains.hostname, domains.dns_status FROM certificates JOIN domains ON domains.id = certificates.domain_id WHERE certificates.id = ?').get(id) as Row | undefined
    if (!current) throw new HttpError(404, '证书记录不存在')
    if (String(current.dns_status) !== 'verified') throw new HttpError(409, '域名 DNS 所有权验证已失效，请重新验证')
    const task = createTask({ kind: 'certificate_renew', label: `续期 ${String(current.hostname)} 的 HTTPS 证书`, entityType: 'domain', entityId: String(current.domain_id), input: { domainId: String(current.domain_id), certificateId: id }, retryable: true })
    sendJson(response, 200, await runCertificateOperationTask(task.id, admin.id))
    return
  }

  const dnsInstructionsMatch = url.pathname.match(/^\/api\/domains\/([^/]+)\/dns-instructions$/)
  if (dnsInstructionsMatch && method === 'GET') {
    const id = decodeURIComponent(dnsInstructionsMatch[1])
    const row = db.prepare('SELECT hostname, verification_token, dns_status, certificate_status, last_verified_at FROM domains WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new HttpError(404, '域名不存在')
    sendJson(response, 200, {
      instructions: {
        type: 'TXT',
        name: '_jtwz-verify',
        fullName: `_jtwz-verify.${String(row.hostname)}`,
        value: `jtwz-verify=${String(row.verification_token)}`,
        dnsStatus: String(row.dns_status),
        certificateStatus: String(row.certificate_status),
        lastVerifiedAt: row.last_verified_at ? String(row.last_verified_at) : undefined,
        dnsProvider: dnsProviderStatus(),
        certificateProvider: certificateProviderStatus(),
      },
    })
    return
  }
  const dnsPublishMatch = url.pathname.match(/^\/api\/domains\/([^/]+)\/publish-dns$/)
  if (dnsPublishMatch && method === 'POST') {
    const id = decodeURIComponent(dnsPublishMatch[1])
    const row = db.prepare('SELECT hostname, verification_token FROM domains WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new HttpError(404, '域名不存在')
    const hostname = String(row.hostname)
    const recordName = `_jtwz-verify.${hostname}`
    const result = await publishVerificationRecord(hostname, recordName, `jtwz-verify=${String(row.verification_token)}`)
    audit(admin.id, 'dns_publish', 'domain', id, `${hostname} / ${result.action}`)
    sendJson(response, 200, { ok: true, ...result })
    return
  }
  const dnsVerifyMatch = url.pathname.match(/^\/api\/domains\/([^/]+)\/verify-dns$/)
  if (dnsVerifyMatch && method === 'POST') {
    const id = decodeURIComponent(dnsVerifyMatch[1])
    const row = db.prepare('SELECT hostname, verification_token FROM domains WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new HttpError(404, '域名不存在')
    const hostname = String(row.hostname)
    const expected = `jtwz-verify=${String(row.verification_token)}`
    const legacyExpected = `aurelia-verify=${String(row.verification_token)}`
    let records: string[][] = []
    try {
      records = await resolveTxt(`_jtwz-verify.${hostname}`).catch(() => [] as string[][])
      if (!records.some((parts) => parts.join('') === expected)) {
        const legacyRecords = await resolveTxt(`_aurelia-verify.${hostname}`).catch(() => [] as string[][])
        records.push(...legacyRecords)
      }
      if (!records.length) throw new Error('DNS TXT 记录不存在')
    } catch (error) {
      db.prepare("UPDATE domains SET dns_status = 'error', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id)
      const detail = `${hostname}: ${error instanceof Error ? error.message : 'DNS 查询失败'}`
      audit(admin.id, 'verify_failed', 'domain', id, detail)
      notifyAlert({ type: 'dns_verify_failed', title: 'DNS 所有权验证失败', detail, entityId: id })
      throw new HttpError(409, '暂未查询到验证记录。DNS 生效通常需要几分钟，请稍后重试。')
    }
    const verified = records.some((parts) => [expected, legacyExpected].includes(parts.join('')))
    if (!verified) {
      db.prepare("UPDATE domains SET dns_status = 'error', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id)
      throw new HttpError(409, 'TXT 记录已查询到，但记录值不匹配')
    }
    const timestamp = new Date().toISOString()
    let certificateStatus: 'pending' | 'active' | 'error' = 'pending'
    const settings = publicSettings()
    if (settings.autoHttps && certificateProviderStatus().configured) {
      try {
        const task = createTask({ kind: 'certificate_issue', label: `签发 ${hostname} 的 HTTPS 证书`, entityType: 'domain', entityId: id, input: { domainId: id }, retryable: true })
        await runCertificateOperationTask(task.id, admin.id)
        certificateStatus = 'active'
      } catch (error) {
        certificateStatus = 'error'
      }
    }
    db.prepare("UPDATE domains SET dns_status = 'verified', certificate_status = ?, last_verified_at = ?, status = CASE WHEN status = 'pending' THEN 'active' ELSE status END, updated_at = ? WHERE id = ?")
      .run(certificateStatus, timestamp, timestamp, id)
    audit(admin.id, 'verify', 'domain', id, hostname)
    sendJson(response, 200, { domain: mapDomain(db.prepare('SELECT * FROM domains WHERE id = ?').get(id) as Row) })
    return
  }
  const certificateIssueMatch = url.pathname.match(/^\/api\/domains\/([^/]+)\/issue-certificate$/)
  if (certificateIssueMatch && method === 'POST') {
    const id = decodeURIComponent(certificateIssueMatch[1])
    const row = db.prepare("SELECT hostname, dns_status FROM domains WHERE id = ?").get(id) as Row | undefined
    if (!row) throw new HttpError(404, '域名不存在')
    if (String(row.dns_status) !== 'verified') throw new HttpError(409, '请先完成 DNS 所有权验证')
    const task = createTask({ kind: 'certificate_issue', label: `签发 ${String(row.hostname)} 的 HTTPS 证书`, entityType: 'domain', entityId: id, input: { domainId: id }, retryable: true })
    sendJson(response, 200, await runCertificateOperationTask(task.id, admin.id))
    return
  }

  if (method === 'GET' && url.pathname === '/api/redirects') {
    sendJson(response, 200, { redirectRules: listRedirectRules() })
    return
  }
  if (method === 'POST' && url.pathname === '/api/redirects') {
    const body = await readJson<Record<string, unknown>>(request)
    const domainId = String(body.domainId || '')
    const target = normalizeTarget(String(body.target || ''))
    const sourcePath = String(body.sourcePath || '/*').trim() || '/*'
    if (!sourcePath.startsWith('/')) throw new HttpError(400, '匹配路径必须以 / 开头')
    assertRedirectRuleSafe(domainId, sourcePath, target)
    const startsAt = optionalIsoDate(body.startsAt, '生效时间')
    const expiresAt = optionalIsoDate(body.expiresAt, '失效时间')
    if (startsAt && expiresAt && Date.parse(startsAt) >= Date.parse(expiresAt)) throw new HttpError(400, '失效时间必须晚于生效时间')
    const priority = Math.min(10_000, Math.max(0, Number(body.priority ?? 100)))
    const id = randomUUID()
    const timestamp = new Date().toISOString()
    db.prepare(`INSERT INTO redirect_rules
      (id, domain_id, name, notes, source_path, target, redirect_code, preserve_path, preserve_query, enabled, priority, starts_at, expires_at, hits, updated_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`)
      .run(id, domainId, String(body.name || '').trim().slice(0, 120), String(body.notes || '').trim().slice(0, 1000), sourcePath, target,
        Number(body.redirectCode) === 301 ? 301 : 302, body.preservePath === false ? 0 : 1, body.preserveQuery === false ? 0 : 1,
        body.enabled === false ? 0 : 1, priority, startsAt, expiresAt, timestamp, timestamp)
    audit(admin.id, 'create', 'redirect_rule', id, `${sourcePath} → ${target}`)
    sendJson(response, 201, { redirectRule: listRedirectRules().find((rule) => rule.id === id) })
    return
  }
  const redirectRuleMatch = url.pathname.match(/^\/api\/redirects\/([^/]+)$/)
  if (redirectRuleMatch && method === 'PUT') {
    const id = decodeURIComponent(redirectRuleMatch[1])
    const current = db.prepare('SELECT * FROM redirect_rules WHERE id = ?').get(id) as Row | undefined
    if (!current) throw new HttpError(404, '跳转规则不存在')
    const body = await readJson<Record<string, unknown>>(request)
    const domainId = String(body.domainId ?? current.domain_id)
    const sourcePath = String(body.sourcePath ?? current.source_path).trim() || '/*'
    if (!sourcePath.startsWith('/')) throw new HttpError(400, '匹配路径必须以 / 开头')
    const target = normalizeTarget(String(body.target ?? current.target))
    assertRedirectRuleSafe(domainId, sourcePath, target, id)
    const startsAt = body.startsAt === undefined ? (current.starts_at ? String(current.starts_at) : null) : optionalIsoDate(body.startsAt, '生效时间')
    const expiresAt = body.expiresAt === undefined ? (current.expires_at ? String(current.expires_at) : null) : optionalIsoDate(body.expiresAt, '失效时间')
    if (startsAt && expiresAt && Date.parse(startsAt) >= Date.parse(expiresAt)) throw new HttpError(400, '失效时间必须晚于生效时间')
    const priority = Math.min(10_000, Math.max(0, Number(body.priority ?? current.priority)))
    const timestamp = new Date().toISOString()
    db.prepare(`UPDATE redirect_rules SET domain_id = ?, name = ?, notes = ?, source_path = ?, target = ?, redirect_code = ?,
      preserve_path = ?, preserve_query = ?, enabled = ?, priority = ?, starts_at = ?, expires_at = ?, updated_at = ? WHERE id = ?`)
      .run(domainId, String(body.name ?? current.name ?? '').trim().slice(0, 120), String(body.notes ?? current.notes ?? '').trim().slice(0, 1000),
        sourcePath, target, Number(body.redirectCode ?? current.redirect_code) === 301 ? 301 : 302,
        body.preservePath === undefined ? Number(current.preserve_path) : body.preservePath ? 1 : 0,
        body.preserveQuery === undefined ? Number(current.preserve_query) : body.preserveQuery ? 1 : 0,
        body.enabled === undefined ? Number(current.enabled) : body.enabled ? 1 : 0,
        priority, startsAt, expiresAt, timestamp, id)
    audit(admin.id, 'update', 'redirect_rule', id, `${sourcePath} → ${target}`)
    sendJson(response, 200, { redirectRule: listRedirectRules().find((rule) => rule.id === id) })
    return
  }
  if (redirectRuleMatch && method === 'DELETE') {
    const id = decodeURIComponent(redirectRuleMatch[1])
    const current = db.prepare('SELECT source_path, target FROM redirect_rules WHERE id = ?').get(id) as Row | undefined
    if (!current) throw new HttpError(404, '跳转规则不存在')
    db.prepare('DELETE FROM redirect_rules WHERE id = ?').run(id)
    audit(admin.id, 'delete', 'redirect_rule', id, `${String(current.source_path)} → ${String(current.target)}`)
    sendJson(response, 200, { ok: true })
    return
  }

  if (method === 'GET' && url.pathname === '/api/packages') {
    sendJson(response, 200, { packages: packagesWithUrls() })
    return
  }

  if (method === 'GET' && url.pathname === '/api/software') {
    const software = db.prepare('SELECT * FROM software ORDER BY created_at DESC').all().map((row) => mapSoftware(row as Row))
    sendJson(response, 200, { software })
    return
  }
  if (method === 'POST' && url.pathname === '/api/software') {
    const body = await readJson<Record<string, unknown>>(request)
    const name = String(body.name || '').trim()
    const slug = String(body.slug || '').trim().toLowerCase()
    if (!name) throw new HttpError(400, '软件名称不能为空')
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new HttpError(400, '软件标识只能使用小写字母、数字和连字符')
    const status = ['published', 'draft', 'testing'].includes(String(body.status)) ? String(body.status) : 'draft'
    if (status === 'published') throw new HttpError(409, '请先创建软件草稿、发布版本并上传安装包，再上架软件')
    const id = randomUUID()
    const timestamp = new Date().toISOString()
    const accent = name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'AP'
    try {
      db.prepare(`INSERT INTO software
        (id, name, slug, description, version, platform, architecture, size, download_url, downloads, status, accent, updated_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, '', '', 0, ?, ?, ?, ?)`)
        .run(id, name, slug, String(body.description || ''), String(body.version || '1.0.0'), String(body.platform || 'Windows'),
          String(body.architecture || 'Universal'), status, accent, timestamp, timestamp)
      const initialVersion = String(body.version || '1.0.0').trim()
      db.prepare(`INSERT INTO software_versions
        (id, software_id, version, channel, release_notes, status, is_recommended, published_at, updated_at, created_at)
        VALUES (?, ?, ?, 'stable', '', ?, ?, ?, ?, ?)`)
        .run(randomUUID(), id, initialVersion, status === 'published' ? 'published' : 'draft', status === 'published' ? 1 : 0,
          status === 'published' ? timestamp : null, timestamp, timestamp)
    } catch (error) {
      if (String(error).includes('UNIQUE')) throw new HttpError(409, '该软件标识已经存在')
      throw error
    }
    audit(admin.id, 'create', 'software', id, name)
    sendJson(response, 201, { software: mapSoftware(db.prepare('SELECT * FROM software WHERE id = ?').get(id) as Row) })
    return
  }
  const softwareMatch = url.pathname.match(/^\/api\/software\/([^/]+)$/)
  if (softwareMatch && method === 'PUT') {
    const id = decodeURIComponent(softwareMatch[1])
    const current = db.prepare('SELECT * FROM software WHERE id = ?').get(id) as Row | undefined
    if (!current) throw new HttpError(404, '软件不存在')
    const body = await readJson<Record<string, unknown>>(request)
    const name = String(body.name ?? current.name).trim()
    if (!name) throw new HttpError(400, '软件名称不能为空')
    const status = parseStatus(body.status ?? current.status, ['published', 'draft', 'testing'], String(current.status))
    if (status === 'published') {
      const deliverableCount = Number((db.prepare(`SELECT COUNT(*) AS count FROM packages
        JOIN software_versions ON software_versions.id = packages.version_id
        WHERE packages.software_id = ? AND packages.status = 'available' AND software_versions.status = 'published'`).get(id) as Row).count)
      if (!deliverableCount) throw new HttpError(409, '上架软件前需要至少一个已发布版本及可用安装包')
    }
    const timestamp = new Date().toISOString()
    db.prepare(`UPDATE software SET name = ?, description = ?, architecture = ?, status = ?, updated_at = ? WHERE id = ?`)
      .run(name, String(body.description ?? current.description), String(body.architecture ?? current.architecture), status, timestamp, id)
    audit(admin.id, 'update', 'software', id, name)
    sendJson(response, 200, { software: mapSoftware(db.prepare('SELECT * FROM software WHERE id = ?').get(id) as Row) })
    return
  }
  if (softwareMatch && method === 'DELETE') {
    const id = decodeURIComponent(softwareMatch[1])
    const current = db.prepare('SELECT name FROM software WHERE id = ?').get(id) as Row | undefined
    if (!current) throw new HttpError(404, '软件不存在')
    const packageCount = Number((db.prepare('SELECT COUNT(*) AS count FROM packages WHERE software_id = ?').get(id) as Row).count)
    if (packageCount > 0) throw new HttpError(409, `该软件仍关联 ${packageCount} 个安装包，请先删除安装包，或将软件保留为草稿`)
    db.prepare('DELETE FROM software WHERE id = ?').run(id)
    audit(admin.id, 'delete', 'software', id, String(current.name))
    sendJson(response, 200, { ok: true })
    return
  }

  if (method === 'GET' && url.pathname === '/api/packages/resumable-sessions') {
    const sessions = (db.prepare("SELECT * FROM upload_sessions WHERE status IN ('uploading', 'paused', 'failed') ORDER BY updated_at DESC").all() as Row[]).map((session) => {
      const receivedChunks = JSON.parse(String(session.received_chunks || '[]')) as number[]
      return {
        id: String(session.id), fileName: String(session.file_name), softwareId: String(session.software_id || ''), version: String(session.version), platform: String(session.platform),
        totalBytes: Number(session.total_bytes), chunkSize: Number(session.chunk_size), totalChunks: Number(session.total_chunks), receivedChunks,
        progress: Number(session.total_chunks) ? Math.round(receivedChunks.length / Number(session.total_chunks) * 100) : 0,
        status: String(session.status), updatedAt: String(session.updated_at), task: findLatestTask('package_upload', String(session.id)),
      }
    })
    sendJson(response, 200, { sessions })
    return
  }
  const resumableSessionMatch = url.pathname.match(/^\/api\/packages\/resumable\/([^/]+)$/)
  if (resumableSessionMatch && method === 'GET') {
    const uploadId = decodeURIComponent(resumableSessionMatch[1])
    const session = db.prepare("SELECT * FROM upload_sessions WHERE id = ? AND status IN ('uploading', 'paused', 'failed')").get(uploadId) as Row | undefined
    if (!session) throw new HttpError(404, '续传会话不存在')
    const receivedChunks = JSON.parse(String(session.received_chunks || '[]')) as number[]
    sendJson(response, 200, { session: { id: uploadId, fileName: String(session.file_name), totalBytes: Number(session.total_bytes), chunkSize: Number(session.chunk_size), totalChunks: Number(session.total_chunks), receivedChunks, status: String(session.status), progress: Math.round(receivedChunks.length / Number(session.total_chunks) * 100) } })
    return
  }
  const resumablePauseMatch = url.pathname.match(/^\/api\/packages\/resumable\/([^/]+)\/pause$/)
  if (resumablePauseMatch && method === 'POST') {
    const uploadId = decodeURIComponent(resumablePauseMatch[1])
    const session = db.prepare("SELECT id FROM upload_sessions WHERE id = ? AND status = 'uploading'").get(uploadId)
    if (!session) throw new HttpError(409, '上传会话当前不能暂停')
    db.prepare("UPDATE upload_sessions SET status = 'paused', updated_at = ? WHERE id = ?").run(new Date().toISOString(), uploadId)
    const task = findLatestTask('package_upload', uploadId)
    if (task) updateTask(task.id, { status: 'cancelled', message: '上传已暂停，可重新选择同一文件继续', log: { level: 'info', message: '管理员暂停上传会话' } })
    sendJson(response, 200, { ok: true })
    return
  }
  const resumableResumeMatch = url.pathname.match(/^\/api\/packages\/resumable\/([^/]+)\/resume$/)
  if (resumableResumeMatch && method === 'POST') {
    const uploadId = decodeURIComponent(resumableResumeMatch[1])
    const session = db.prepare("SELECT * FROM upload_sessions WHERE id = ? AND status IN ('paused', 'failed', 'uploading')").get(uploadId) as Row | undefined
    if (!session) throw new HttpError(404, '上传会话不存在或已经完成')
    db.prepare("UPDATE upload_sessions SET status = 'uploading', updated_at = ? WHERE id = ?").run(new Date().toISOString(), uploadId)
    const receivedChunks = JSON.parse(String(session.received_chunks || '[]')) as number[]
    const task = createTask({ kind: 'package_upload', label: `续传安装包 ${String(session.file_name)}`, entityType: 'package', entityId: uploadId, input: { uploadId }, retryable: true })
    updateTask(task.id, { status: 'running', progress: Math.round(receivedChunks.length / Number(session.total_chunks) * 90), message: '等待剩余文件分片', log: { level: 'info', message: `恢复续传，已有 ${receivedChunks.length}/${Number(session.total_chunks)} 个分片` } })
    sendJson(response, 200, { uploadId, taskId: task.id, chunkSize: Number(session.chunk_size), totalChunks: Number(session.total_chunks), receivedChunks })
    return
  }
  if (resumableSessionMatch && method === 'DELETE') {
    const uploadId = decodeURIComponent(resumableSessionMatch[1])
    const session = db.prepare("SELECT id FROM upload_sessions WHERE id = ? AND status <> 'completed'").get(uploadId)
    if (!session) throw new HttpError(404, '上传会话不存在或已经完成')
    rmSync(resolve(config.tempDir, 'uploads', uploadId), { recursive: true, force: true })
    db.prepare('DELETE FROM upload_sessions WHERE id = ?').run(uploadId)
    const task = findLatestTask('package_upload', uploadId)
    if (task && ['queued', 'running'].includes(task.status)) cancelTask(task.id)
    audit(admin.id, 'delete', 'upload_session', uploadId, '清理未完成的大文件上传')
    sendJson(response, 200, { ok: true })
    return
  }

  if (method === 'POST' && url.pathname === '/api/packages/resumable-intent') {
    if (objectStorageMode !== 'local') throw new HttpError(409, '分片续传当前仅支持本地适配器，请使用对象存储直传流程')
    const body = await readJson<Record<string, unknown>>(request)
    const softwareId = String(body.softwareId || '')
    if (!db.prepare('SELECT id FROM software WHERE id = ?').get(softwareId)) throw new HttpError(404, '请选择有效的软件产品')
    const fileName = safeFileName(String(body.fileName || ''))
    validatePackageMetadata(fileName, String(body.contentType || 'application/octet-stream'))
    const totalBytes = Number(body.totalBytes || 0)
    const version = String(body.version || '').trim()
    const platform = String(body.platform || '').trim()
    if (!version || !platform) throw new HttpError(400, '版本号和平台不能为空')
    const chunkSize = Math.min(16 * 1024 * 1024, Math.max(256 * 1024, Number(body.chunkSize || 4 * 1024 * 1024)))
    if (!Number.isFinite(totalBytes) || totalBytes <= 0 || totalBytes > config.maxPackageBytes) throw new HttpError(413, '文件大小无效或超过限制')
    const totalChunks = Math.ceil(totalBytes / chunkSize)
    const id = randomUUID()
    const objectKey = `packages/${id}/${safeObjectName(fileName)}`
    const timestamp = new Date().toISOString()
    db.prepare(`INSERT INTO upload_sessions (id, object_key, file_name, software_id, version, platform, content_type, total_bytes, chunk_size, total_chunks, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(id, objectKey, fileName, softwareId, version, platform, String(body.contentType || 'application/octet-stream'), totalBytes, chunkSize, totalChunks, timestamp, timestamp)
    const task = createTask({ kind: 'package_upload', label: `上传安装包 ${fileName}`, entityType: 'package', entityId: id, input: { uploadId: id, fileName, totalBytes }, retryable: true })
    updateTask(task.id, { status: 'running', progress: 0, message: '等待文件分片', log: { level: 'info', message: `分片会话已创建，共 ${totalChunks} 个分片` } })
    sendJson(response, 201, { uploadId: id, taskId: task.id, chunkSize, totalChunks, receivedChunks: [] })
    return
  }
  const resumableChunkMatch = url.pathname.match(/^\/api\/packages\/resumable\/([^/]+)\/chunks\/(\d+)$/)
  if (resumableChunkMatch && method === 'PUT') {
    if (objectStorageMode !== 'local') throw new HttpError(409, '分片续传当前仅支持本地适配器')
    const uploadId = decodeURIComponent(resumableChunkMatch[1])
    const index = Number(resumableChunkMatch[2])
    const session = db.prepare("SELECT * FROM upload_sessions WHERE id = ? AND status = 'uploading'").get(uploadId) as Row | undefined
    if (!session) throw new HttpError(404, '上传任务不存在或已完成')
    if (!Number.isInteger(index) || index < 0 || index >= Number(session.total_chunks)) throw new HttpError(400, '分片序号无效')
    const chunkKey = `uploads/${uploadId}/${index}.part`
    await writeRequestToFile(request, safeStoragePath(config.tempDir, chunkKey), Number(session.chunk_size) + 1024)
    const received = JSON.parse(String(session.received_chunks || '[]')) as number[]
    if (!received.includes(index)) received.push(index)
    received.sort((a, b) => a - b)
    db.prepare('UPDATE upload_sessions SET received_chunks = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(received), new Date().toISOString(), uploadId)
    const task = findLatestTask('package_upload', uploadId)
    if (task) updateTask(task.id, { status: 'running', progress: Math.min(90, Math.round(received.length / Number(session.total_chunks) * 90)), message: `已接收 ${received.length}/${Number(session.total_chunks)} 个分片` })
    sendJson(response, 200, { uploadId, receivedChunks: received, complete: received.length === Number(session.total_chunks) })
    return
  }
  const resumableCompleteMatch = url.pathname.match(/^\/api\/packages\/resumable\/([^/]+)\/complete$/)
  if (resumableCompleteMatch && method === 'POST') {
    if (objectStorageMode !== 'local') throw new HttpError(409, '分片续传当前仅支持本地适配器')
    const uploadId = decodeURIComponent(resumableCompleteMatch[1])
    const session = db.prepare("SELECT * FROM upload_sessions WHERE id = ? AND status = 'uploading'").get(uploadId) as Row | undefined
    if (!session) throw new HttpError(404, '上传任务不存在或已完成')
    const received = JSON.parse(String(session.received_chunks || '[]')) as number[]
    if (received.length !== Number(session.total_chunks)) throw new HttpError(409, '仍有分片未上传')
    const objectPath = safeStoragePath(config.storageDir, String(session.object_key))
    mkdirSync(resolve(objectPath, '..'), { recursive: true })
    rmSync(objectPath, { force: true })
    for (let index = 0; index < Number(session.total_chunks); index += 1) {
      const chunkPath = safeStoragePath(config.tempDir, `uploads/${uploadId}/${index}.part`)
      appendFileSync(objectPath, readFileSync(chunkPath))
      rmSync(chunkPath, { force: true })
    }
    const completed = await completeStorageUpload(String(session.object_key), String(session.content_type))
    try { validatePackageFile(objectPath, String(session.file_name)) } catch (error) {
      rmSync(objectPath, { force: true })
      db.prepare("UPDATE upload_sessions SET status = 'failed', updated_at = ? WHERE id = ?").run(new Date().toISOString(), uploadId)
      throw error
    }
    const timestamp = new Date().toISOString()
    const versionId = ensureSoftwareVersion(String(session.software_id), String(session.version))
    db.prepare(`INSERT INTO packages (id, file_name, software_id, version_id, version, platform, size, storage, object_key, byte_size, sha256, mime_type, downloads, status, updated_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'Local object storage', ?, ?, ?, ?, 0, 'available', ?, ?)`)
      .run(uploadId, String(session.file_name), String(session.software_id), versionId, String(session.version), String(session.platform), formatBytes(completed.byteSize), String(session.object_key), completed.byteSize, completed.sha256, String(session.content_type), timestamp, timestamp)
    db.prepare("UPDATE upload_sessions SET status = 'completed', updated_at = ? WHERE id = ?").run(timestamp, uploadId)
    const task = findLatestTask('package_upload', uploadId)
    if (task) updateTask(task.id, { status: 'succeeded', progress: 100, message: '安装包上传与校验完成', result: { packageId: uploadId, sha256: completed.sha256, byteSize: completed.byteSize }, log: { level: 'success', message: `合并与 SHA-256 校验完成：${completed.sha256}` } })
    audit(admin.id, 'upload', 'package', uploadId, `${String(session.file_name)} / resumable / SHA-256 ${completed.sha256}`)
    sendJson(response, 200, { package: packagesWithUrls().find((item) => item.id === uploadId) })
    return
  }
  if (method === 'POST' && url.pathname === '/api/packages/upload-intent') {
    if (!isStorageConfigured()) throw new HttpError(503, '对象存储尚未完成配置，请先检查 S3 连接参数')
    const body = await readJson<Record<string, unknown>>(request)
    const softwareId = String(body.softwareId || '')
    const software = db.prepare('SELECT id, name FROM software WHERE id = ?').get(softwareId) as Row | undefined
    if (!software) throw new HttpError(404, '请选择有效的软件产品')
    const fileName = safeFileName(String(body.fileName || ''))
    validatePackageMetadata(fileName, String(body.contentType || 'application/octet-stream'))
    const version = String(body.version || '').trim()
    const platform = String(body.platform || '').trim()
    const byteSize = Number(body.byteSize || 0)
    const sha256 = String(body.sha256 || '').trim().toLowerCase()
    if (!version || !platform) throw new HttpError(400, '版本号和平台不能为空')
    if (!Number.isFinite(byteSize) || byteSize <= 0 || byteSize > config.maxPackageBytes) throw new HttpError(413, `文件超过允许大小（最大 ${Math.round(config.maxPackageBytes / 1024 / 1024)} MB）`)
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new HttpError(400, '安装包 SHA-256 校验值无效')
    const id = randomUUID()
    const objectKey = `packages/${id}/${safeObjectName(fileName)}`
    const contentType = String(body.contentType || 'application/octet-stream').slice(0, 180)
    const timestamp = new Date().toISOString()
    const versionId = ensureSoftwareVersion(softwareId, version)
    db.prepare(`INSERT INTO packages
      (id, file_name, software_id, version_id, version, platform, size, storage, object_key, byte_size, sha256, mime_type, downloads, status, updated_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, ?, 0, 'processing', ?, ?)`)
      .run(id, fileName, softwareId, versionId, version, platform, objectStorageMode === 's3' ? 'S3-compatible object storage' : 'Local object storage', objectKey, byteSize, sha256, contentType, timestamp, timestamp)
    const upload = createStorageUpload(objectKey, contentType, sha256)
    if (objectStorageMode === 'local') upload.url = `/api/packages/${encodeURIComponent(id)}/upload`
    const task = createTask({ kind: 'package_upload', label: `上传安装包 ${fileName}`, entityType: 'package', entityId: id, input: { packageId: id, fileName, byteSize }, retryable: false })
    updateTask(task.id, { status: 'running', progress: 5, message: '等待浏览器直传文件', log: { level: 'info', message: `上传目标已准备：${objectStorageMode}` } })
    sendJson(response, 201, { packageId: id, taskId: task.id, upload, objectKey, maxBytes: config.maxPackageBytes })
    return
  }
  if (method === 'POST' && url.pathname === '/api/packages/multipart-intent') {
    if (objectStorageMode !== 's3' || !isStorageConfigured()) throw new HttpError(409, '当前对象存储未启用 S3 multipart')
    const body = await readJson<Record<string, unknown>>(request)
    const softwareId = String(body.softwareId || '')
    const software = db.prepare('SELECT id FROM software WHERE id = ?').get(softwareId) as Row | undefined
    if (!software) throw new HttpError(404, '请选择有效的软件产品')
    const fileName = safeFileName(String(body.fileName || ''))
    validatePackageMetadata(fileName, String(body.contentType || 'application/octet-stream'))
    const totalBytes = Number(body.totalBytes || 0)
    const version = String(body.version || '').trim()
    const platform = String(body.platform || '').trim()
    const sha256 = String(body.sha256 || '').trim().toLowerCase()
    const partSize = Math.min(64 * 1024 * 1024, Math.max(5 * 1024 * 1024, Number(body.partSize || 16 * 1024 * 1024)))
    if (!Number.isFinite(totalBytes) || totalBytes <= 0 || totalBytes > config.maxPackageBytes) throw new HttpError(413, '文件大小无效或超过限制')
    if (!version || !platform) throw new HttpError(400, '版本号和平台不能为空')
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new HttpError(400, '安装包 SHA-256 校验值无效')
    const objectKey = `packages/${randomUUID()}/${safeObjectName(fileName)}`
    const uploadId = await createMultipartUpload(objectKey, String(body.contentType || 'application/octet-stream'), sha256)
    const id = randomUUID()
    const timestamp = new Date().toISOString()
    const versionId = ensureSoftwareVersion(softwareId, version)
    db.prepare(`INSERT INTO packages (id, file_name, software_id, version_id, version, platform, size, storage, object_key, byte_size, sha256, mime_type, downloads, status, updated_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, '', 'S3-compatible object storage', ?, ?, ?, ?, 0, 'processing', ?, ?)`)
      .run(id, fileName, softwareId, versionId, version, platform, objectKey, totalBytes, sha256, String(body.contentType || 'application/octet-stream'), timestamp, timestamp)
    const totalParts = Math.ceil(totalBytes / partSize)
    const task = createTask({ kind: 'package_upload', label: `分片上传安装包 ${fileName}`, entityType: 'package', entityId: id, input: { packageId: id, fileName, totalBytes, totalParts }, retryable: false })
    updateTask(task.id, { status: 'running', progress: 5, message: `等待 ${totalParts} 个云端分片`, log: { level: 'info', message: `S3 multipart 会话已经创建：${uploadId}` } })
    sendJson(response, 201, { packageId: id, taskId: task.id, uploadId, partSize, totalParts })
    return
  }
  const multipartPartMatch = url.pathname.match(/^\/api\/packages\/([^/]+)\/multipart\/([^/]+)\/parts\/(\d+)$/)
  if (multipartPartMatch && method === 'GET') {
    const id = decodeURIComponent(multipartPartMatch[1])
    const uploadId = decodeURIComponent(multipartPartMatch[2])
    const partNumber = Number(multipartPartMatch[3])
    const row = db.prepare("SELECT object_key, status FROM packages WHERE id = ? AND status = 'processing'").get(id) as Row | undefined
    if (!row) throw new HttpError(404, '分片上传任务不存在')
    const task = findLatestTask('package_upload', id)
    if (task) {
      const totalParts = Number(task.input.totalParts || 1)
      updateTask(task.id, { status: 'running', progress: Math.min(85, 5 + Math.round(partNumber / totalParts * 75)), message: `正在上传云端分片 ${partNumber}/${totalParts}` })
    }
    sendJson(response, 200, { upload: createMultipartPartUpload(String(row.object_key), uploadId, partNumber) })
    return
  }
  const multipartCompleteMatch = url.pathname.match(/^\/api\/packages\/([^/]+)\/multipart\/([^/]+)\/complete$/)
  if (multipartCompleteMatch && method === 'POST') {
    const id = decodeURIComponent(multipartCompleteMatch[1])
    const uploadId = decodeURIComponent(multipartCompleteMatch[2])
    const row = db.prepare("SELECT * FROM packages WHERE id = ? AND status = 'processing'").get(id) as Row | undefined
    if (!row) throw new HttpError(404, '分片上传任务不存在')
    const body = await readJson<{ parts?: Array<{ partNumber?: number; etag?: string }> }>(request)
    const parts = (body.parts || []).map((part) => ({ partNumber: Number(part.partNumber), etag: String(part.etag || '') })).filter((part) => part.partNumber > 0 && part.etag)
    if (!parts.length) throw new HttpError(400, '缺少有效分片列表')
    await completeMultipartUpload(String(row.object_key), uploadId, parts)
    const completed = await completeStorageUpload(String(row.object_key), String(row.mime_type))
    if (completed.byteSize !== Number(row.byte_size)) throw new HttpError(409, '对象存储文件大小与上传声明不一致')
    if (!completed.sha256 || completed.sha256.toLowerCase() !== String(row.sha256).toLowerCase()) throw new HttpError(409, '对象存储 SHA-256 元数据校验失败')
    db.prepare("UPDATE packages SET size = ?, byte_size = ?, sha256 = ?, status = 'available', updated_at = ? WHERE id = ?")
      .run(formatBytes(completed.byteSize), completed.byteSize, completed.sha256, new Date().toISOString(), id)
    const task = findLatestTask('package_upload', id)
    if (task) updateTask(task.id, { status: 'succeeded', progress: 100, message: '安装包分片合并与校验完成', result: { packageId: id, sha256: completed.sha256, byteSize: completed.byteSize }, log: { level: 'success', message: `S3 multipart 合并完成：${completed.sha256}` } })
    audit(admin.id, 'upload', 'package', id, `${String(row.file_name)} / multipart / SHA-256 ${completed.sha256 || '未提供'}`)
    sendJson(response, 200, { package: packagesWithUrls().find((item) => item.id === id) })
    return
  }
  const packageUploadMatch = url.pathname.match(/^\/api\/packages\/([^/]+)\/upload$/)
  if (packageUploadMatch && method === 'PUT') {
    if (objectStorageMode !== 'local') throw new HttpError(409, '当前对象存储要求浏览器直接上传到 S3 地址')
    const id = decodeURIComponent(packageUploadMatch[1])
    const row = db.prepare("SELECT * FROM packages WHERE id = ? AND status = 'processing'").get(id) as Row | undefined
    if (!row) throw new HttpError(404, '上传任务不存在或已经完成')
    await uploadLocal(request, String(row.object_key), config.maxPackageBytes)
    const task = findLatestTask('package_upload', id)
    if (task) updateTask(task.id, { status: 'running', progress: 88, message: '文件上传完成，等待服务端校验', log: { level: 'success', message: '本地对象存储已完整接收文件' } })
    sendJson(response, 200, { uploaded: true })
    return
  }
  const packageCompleteMatch = url.pathname.match(/^\/api\/packages\/([^/]+)\/complete$/)
  if (packageCompleteMatch && method === 'POST') {
    const id = decodeURIComponent(packageCompleteMatch[1])
    const row = db.prepare("SELECT * FROM packages WHERE id = ? AND status = 'processing'").get(id) as Row | undefined
    if (!row) throw new HttpError(404, '上传任务不存在或已经完成')
    const completed = await completeStorageUpload(String(row.object_key), String(row.mime_type))
    if (completed.byteSize <= 0 || completed.byteSize > config.maxPackageBytes) throw new HttpError(400, '对象存储中的文件大小无效')
    if (completed.byteSize !== Number(row.byte_size)) throw new HttpError(409, '对象存储文件大小与上传声明不一致')
    if (!completed.sha256 || completed.sha256.toLowerCase() !== String(row.sha256).toLowerCase()) throw new HttpError(409, '对象存储 SHA-256 元数据校验失败')
    if (objectStorageMode === 'local') {
      try { validatePackageFile(localFilePath(String(row.object_key)), String(row.file_name)) } catch (error) {
        await removeObject(String(row.object_key))
        db.prepare("UPDATE packages SET status = 'paused', updated_at = ? WHERE id = ?").run(new Date().toISOString(), id)
        throw error
      }
    }
    db.prepare("UPDATE packages SET size = ?, byte_size = ?, sha256 = ?, status = 'available', updated_at = ? WHERE id = ?")
      .run(formatBytes(completed.byteSize), completed.byteSize, completed.sha256, new Date().toISOString(), id)
    const task = findLatestTask('package_upload', id)
    if (task) updateTask(task.id, { status: 'succeeded', progress: 100, message: '安装包上传与校验完成', result: { packageId: id, sha256: completed.sha256, byteSize: completed.byteSize }, log: { level: 'success', message: `SHA-256 校验完成：${completed.sha256}` } })
    audit(admin.id, 'upload', 'package', id, `${String(row.file_name)} / SHA-256 ${completed.sha256 || '未提供'}`)
    sendJson(response, 200, { package: packagesWithUrls().find((item) => item.id === id) })
    return
  }
  if (method === 'POST' && url.pathname === '/api/packages/upload') {
    const softwareId = String(url.searchParams.get('softwareId') || '')
    const software = db.prepare('SELECT id, name FROM software WHERE id = ?').get(softwareId) as Row | undefined
    if (!software) throw new HttpError(404, '请选择有效的软件产品')
    const fileName = safeFileName(url.searchParams.get('fileName') || '')
    validatePackageMetadata(fileName, String(request.headers['content-type'] || 'application/octet-stream'))
    const version = String(url.searchParams.get('version') || '').trim()
    const platform = String(url.searchParams.get('platform') || '').trim()
    if (!version || !platform) throw new HttpError(400, '版本号和平台不能为空')

    const id = randomUUID()
    const objectKey = `packages/${id}/${safeObjectName(fileName)}`
    const filePath = safeStoragePath(config.storageDir, objectKey)
    const upload = await writeRequestToFile(request, filePath, config.maxPackageBytes)
    try { validatePackageFile(filePath, fileName) } catch (error) { removeStoredFile(objectKey); throw error }
    const timestamp = new Date().toISOString()
    const versionId = ensureSoftwareVersion(softwareId, version)
    try {
      db.prepare(`INSERT INTO packages
        (id, file_name, software_id, version_id, version, platform, size, storage, object_key, byte_size, sha256, mime_type, downloads, status, updated_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'available', ?, ?)`)
        .run(id, fileName, softwareId, versionId, version, platform, formatBytes(upload.bytes), 'Local object storage', objectKey,
          upload.bytes, upload.sha256, String(request.headers['content-type'] || 'application/octet-stream'), timestamp, timestamp)
    } catch (error) {
      removeStoredFile(objectKey)
      throw error
    }
    audit(admin.id, 'upload', 'package', id, `${String(software.name)} ${version} / ${fileName} / SHA-256 ${upload.sha256}`)
    const item = packagesWithUrls().find((entry) => entry.id === id)
    sendJson(response, 201, { package: item })
    return
  }
  const packageMatch = url.pathname.match(/^\/api\/packages\/([^/]+)$/)
  if (packageMatch && method === 'PATCH') {
    const id = decodeURIComponent(packageMatch[1])
    const row = db.prepare('SELECT file_name, status, platform, release_notes FROM packages WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new HttpError(404, '安装包不存在')
    const body = await readJson<Record<string, unknown>>(request)
    const status = parseStatus(body.status, ['available', 'paused'], String(row.status))
    const platform = String(body.platform ?? row.platform).trim().slice(0, 120)
    const releaseNotes = String(body.releaseNotes ?? row.release_notes).trim().slice(0, 10000)
    if (!platform) throw new HttpError(400, '平台信息不能为空')
    db.prepare('UPDATE packages SET status = ?, platform = ?, release_notes = ?, updated_at = ? WHERE id = ?')
      .run(status, platform, releaseNotes, new Date().toISOString(), id)
    audit(admin.id, 'update', 'package', id, `${String(row.file_name)} / ${platform} / ${status}`)
    sendJson(response, 200, { package: packagesWithUrls().find((item) => item.id === id) })
    return
  }
  if (packageMatch && method === 'DELETE') {
    const id = decodeURIComponent(packageMatch[1])
    const row = db.prepare('SELECT file_name, object_key FROM packages WHERE id = ?').get(id) as Row | undefined
    if (!row) throw new HttpError(404, '安装包不存在')
    await removeObject(String(row.object_key))
    db.prepare('DELETE FROM packages WHERE id = ?').run(id)
    audit(admin.id, 'delete', 'package', id, String(row.file_name))
    sendJson(response, 200, { ok: true })
    return
  }
  const packageUrlMatch = url.pathname.match(/^\/api\/packages\/([^/]+)\/download-url$/)
  if (packageUrlMatch && method === 'GET') {
    const id = decodeURIComponent(packageUrlMatch[1])
    const row = db.prepare("SELECT id FROM packages WHERE id = ? AND status = 'available'").get(id)
    if (!row) throw new HttpError(404, '安装包不存在或不可下载')
    sendJson(response, 200, { downloadUrl: signedDownloadPath(id) })
    return
  }

  if (method === 'GET' && url.pathname === '/api/sites') {
    const sites = db.prepare('SELECT * FROM sites ORDER BY created_at DESC').all().map((row) => mapSite(row as Row))
    sendJson(response, 200, { sites })
    return
  }
  if (method === 'POST' && url.pathname === '/api/sites') {
    const body = await readJson<Record<string, unknown>>(request)
    const name = String(body.name || '').trim()
    if (!name) throw new HttpError(400, '网站名称不能为空')
    const id = randomUUID()
    const timestamp = new Date().toISOString()
    db.prepare(`INSERT INTO sites (id, name, path, domain, status, visits, category, current_version_id, updated_at, created_at)
      VALUES (?, ?, ?, ?, 'draft', 0, ?, NULL, ?, ?)`)
      .run(id, name, `/sites/${id}`, String(body.domain || ''), String(body.category || '静态网站'), timestamp, timestamp)
    audit(admin.id, 'create', 'site', id, name)
    sendJson(response, 201, { site: mapSite(db.prepare('SELECT * FROM sites WHERE id = ?').get(id) as Row) })
    return
  }
  const siteMatch = url.pathname.match(/^\/api\/sites\/([^/]+)$/)
  if (siteMatch && method === 'PUT') {
    const id = decodeURIComponent(siteMatch[1])
    const current = db.prepare('SELECT * FROM sites WHERE id = ?').get(id) as Row | undefined
    if (!current) throw new HttpError(404, '静态网站不存在')
    const body = await readJson<Record<string, unknown>>(request)
    const status = parseStatus(body.status ?? current.status, ['published', 'draft', 'offline'], String(current.status))
    const name = String(body.name ?? current.name).trim()
    if (!name) throw new HttpError(400, '网站名称不能为空')
    if (status === 'published' && !current.current_version_id) throw new HttpError(409, '网站尚无可发布版本，请先上传网站 ZIP')
    const timestamp = new Date().toISOString()
    db.prepare('UPDATE sites SET name = ?, domain = ?, category = ?, status = ?, updated_at = ? WHERE id = ?')
      .run(name, String(body.domain ?? current.domain), String(body.category ?? current.category), status, timestamp, id)
    audit(admin.id, 'update', 'site', id, `${name} / ${status}`)
    sendJson(response, 200, { site: mapSite(db.prepare('SELECT * FROM sites WHERE id = ?').get(id) as Row) })
    return
  }
  const sitePublishMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/publish$/)
  if (sitePublishMatch && method === 'POST') {
    const siteId = decodeURIComponent(sitePublishMatch[1])
    const site = db.prepare('SELECT * FROM sites WHERE id = ?').get(siteId) as Row | undefined
    if (!site) throw new HttpError(404, '静态网站不存在')
    const sourceName = safeFileName(url.searchParams.get('fileName') || 'website.zip')
    if (extname(sourceName).toLowerCase() !== '.zip') throw new HttpError(400, '静态网站必须上传 ZIP 文件')
    mkdirSync(config.taskArtifactsDir, { recursive: true })
    const taskId = randomUUID()
    const zipPath = resolve(config.taskArtifactsDir, `${taskId}.zip`)
    const task = createTask({ kind: 'site_publish', label: `发布静态网站 ${String(site.name)}`, entityType: 'site', entityId: siteId, input: { siteId, sourceName, zipPath }, retryable: true })
    updateTask(task.id, { status: 'running', progress: 5, message: '正在接收网站 ZIP', log: { level: 'info', message: `开始接收 ${sourceName}` } })
    try {
      const upload = await writeRequestToFile(request, zipPath, config.maxSiteZipBytes)
      updateTask(task.id, { progress: 25, message: '上传完成，正在校验 ZIP', log: { level: 'success', message: `上传完成：${formatBytes(upload.bytes)}，SHA-256 ${upload.sha256}` } })
    } catch (error) {
      const detail = error instanceof Error ? error.message : '网站 ZIP 上传失败'
      updateTask(task.id, { status: 'failed', message: '网站 ZIP 上传失败', error: detail, log: { level: 'error', message: detail } })
      rmSync(zipPath, { force: true })
      throw error
    }
    sendJson(response, 200, await publishSiteTask(task.id, admin.id))
    return
  }
  const siteVersionsMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/versions$/)
  if (siteVersionsMatch && method === 'GET') {
    const siteId = decodeURIComponent(siteVersionsMatch[1])
    const versions = db.prepare(`SELECT id, source_name AS sourceName, file_count AS fileCount, byte_size AS byteSize,
      sha256, created_at AS createdAt FROM site_versions WHERE site_id = ? ORDER BY created_at DESC`).all(siteId)
    sendJson(response, 200, { versions })
    return
  }
  const siteRollbackMatch = url.pathname.match(/^\/api\/sites\/([^/]+)\/rollback$/)
  if (siteRollbackMatch && method === 'POST') {
    const siteId = decodeURIComponent(siteRollbackMatch[1])
    const body = await readJson<{ versionId?: string }>(request)
    const versionId = String(body.versionId || '')
    const site = db.prepare('SELECT name FROM sites WHERE id = ?').get(siteId) as Row | undefined
    if (!site) throw new HttpError(404, '静态网站不存在')
    const task = createTask({ kind: 'site_rollback', label: `回滚静态网站 ${String(site.name)}`, entityType: 'site', entityId: siteId, input: { siteId, versionId }, retryable: true })
    sendJson(response, 200, await rollbackSiteTask(task.id, admin.id))
    return
  }
  const siteDeleteMatch = url.pathname.match(/^\/api\/sites\/([^/]+)$/)
  if (siteDeleteMatch && method === 'DELETE') {
    const siteId = decodeURIComponent(siteDeleteMatch[1])
    const site = db.prepare('SELECT name FROM sites WHERE id = ?').get(siteId) as Row | undefined
    if (!site) throw new HttpError(404, '静态网站不存在')
    const boundDomains = db.prepare("SELECT hostname FROM domains WHERE mode = 'site' AND target = ? ORDER BY hostname").all(siteId) as Row[]
    if (boundDomains.length) throw new HttpError(409, `该网站仍绑定 ${boundDomains.length} 个域名（${boundDomains.map((item) => String(item.hostname)).join('、')}），请先解除域名绑定`)
    db.prepare('DELETE FROM sites WHERE id = ?').run(siteId)
    rmSync(resolve(config.siteReleasesDir, siteId), { recursive: true, force: true })
    audit(admin.id, 'delete', 'site', siteId, String(site.name))
    sendJson(response, 200, { ok: true })
    return
  }

  if (method === 'GET' && url.pathname === '/api/settings') {
    sendJson(response, 200, { settings: publicSettings() })
    return
  }
  if (method === 'PUT' && url.pathname === '/api/settings') {
    const body = await readJson<Record<string, unknown>>(request)
    const name = String(body.name || '').trim()
    const supportEmail = String(body.supportEmail || '').trim()
    if (!name) throw new HttpError(400, '品牌名称不能为空')
    if (supportEmail && !/^\S+@\S+\.\S+$/.test(supportEmail)) throw new HttpError(400, '支持邮箱格式不正确')
    db.prepare(`UPDATE settings SET name = ?, tagline = ?, support_email = ?, footer_text = ?,
      default_redirect_code = ?, auto_https = ?, traffic_alerts = ?, public_maintenance = ?,
      maintenance_message = ?, updated_at = ? WHERE id = 1`)
      .run(name, String(body.tagline || ''), supportEmail, String(body.footerText || ''),
        Number(body.defaultRedirectCode) === 301 ? 301 : 302, body.autoHttps === false ? 0 : 1,
        body.trafficAlerts === false ? 0 : 1, body.publicMaintenance === true ? 1 : 0,
        String(body.maintenanceMessage || '').trim().slice(0, 500), new Date().toISOString())
    audit(admin.id, 'update', 'settings', '1', name)
    sendJson(response, 200, { settings: publicSettings() })
    return
  }

  if (method === 'GET' && url.pathname === '/api/audit-logs') {
    const requestedPage = Math.max(1, Number(url.searchParams.get('page') || 1))
    const pageSize = Math.min(100, Math.max(10, Number(url.searchParams.get('pageSize') || 25)))
    const action = String(url.searchParams.get('action') || '').trim()
    const entityType = String(url.searchParams.get('entityType') || '').trim()
    const query = String(url.searchParams.get('q') || '').trim()
    const clauses: string[] = []
    const params: string[] = []
    if (action) { clauses.push('audit_logs.action = ?'); params.push(action) }
    if (entityType) { clauses.push('audit_logs.entity_type = ?'); params.push(entityType) }
    if (query) { clauses.push('(audit_logs.action LIKE ? OR audit_logs.entity_type LIKE ? OR audit_logs.entity_id LIKE ? OR audit_logs.detail LIKE ? OR admins.username LIKE ? OR admins.display_name LIKE ? OR audit_logs.request_id LIKE ?)'); params.push(`%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`, `%${query}%`) }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
    const total = Number((db.prepare(`SELECT COUNT(*) AS count FROM audit_logs LEFT JOIN admins ON admins.id = audit_logs.admin_id ${where}`).get(...params) as Row).count)
    const offset = (requestedPage - 1) * pageSize
    const logs = db.prepare(`SELECT audit_logs.action, audit_logs.entity_type AS entityType, audit_logs.entity_id AS entityId, audit_logs.detail,
      audit_logs.request_id AS requestId, audit_logs.ip_address AS ipAddress, COALESCE(admins.display_name, admins.username, '系统') AS adminName,
      audit_logs.created_at AS createdAt FROM audit_logs LEFT JOIN admins ON admins.id = audit_logs.admin_id ${where} ORDER BY audit_logs.created_at DESC LIMIT ? OFFSET ?`).all(...params, pageSize, offset)
    sendJson(response, 200, { logs, total, page: requestedPage, pageSize, pageCount: Math.max(1, Math.ceil(total / pageSize)) })
    return
  }

  throw new HttpError(404, '接口不存在')
}

function pathMatches(pattern: string, pathname: string) {
  if (pattern === '/*' || pattern === '*') return true
  if (pattern.endsWith('*')) return pathname.startsWith(pattern.slice(0, -1))
  return pathname === pattern
}

function buildRedirectTarget(base: string, url: URL, preservePath: boolean, preserveQuery: boolean) {
  const target = new URL(base)
  if (preservePath && url.pathname !== '/') {
    target.pathname = `${target.pathname.replace(/\/$/, '')}/${url.pathname.replace(/^\//, '')}`
  }
  if (preserveQuery) {
    for (const [key, value] of url.searchParams) target.searchParams.append(key, value)
  }
  return target.toString()
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character] || character)
}

function maintenanceHtml(brand: string, hostname: string, detail = '') {
  const message = detail.trim() ? escapeHtml(detail.trim()).replace(/\r?\n/g, '<br>') : `${escapeHtml(brand)} 正在为这个入口进行维护与升级。<br>请稍后重新访问。`
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>系统维护中</title><style>:root{color-scheme:light dark}*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(circle at 20% 10%,#c9a22722,transparent 30%),#f7f5f2;color:#2c2a26;font-family:Inter,"Microsoft YaHei",sans-serif}.card{width:min(560px,calc(100% - 32px));padding:48px;border:1px solid #ddd5c5;border-radius:28px;background:#ffffffcc;box-shadow:0 24px 80px #c9a22722;text-align:center}.mark{display:grid;place-items:center;width:58px;height:58px;margin:0 auto 24px;border-radius:18px;background:linear-gradient(135deg,#c9a227,#b8911f);color:#f7f5f2;font-size:28px}h1{font-family:Georgia,serif;font-size:42px;margin:0 0 14px}p{color:#5c574e;line-height:1.8}.host{display:inline-block;margin-top:12px;padding:8px 14px;border-radius:999px;background:#c9a22722;color:#5c574e}@media(prefers-color-scheme:dark){body{background:radial-gradient(circle at 20% 10%,#e0b83a22,transparent 30%),#1a1916;color:#f0ebe3}.card{border-color:#3d3932;background:#2a2722e8}p,.host{color:#c9c2b5}}</style></head><body><main class="card"><div class="mark">✦</div><h1>稍作休息，很快回来。</h1><p>${message}</p><span class="host">${escapeHtml(hostname)}</span></main></body></html>`
}

function tryDomainRuntime(request: IncomingMessage, response: ServerResponse, url: URL) {
  const hostname = normalizeHostname(String(request.headers.host || ''))
  const row = db.prepare("SELECT * FROM domains WHERE hostname = ? AND status = 'active'").get(hostname) as Row | undefined
  if (!row) return false
  const domain = mapDomain(row)

  if (domain.forceHttps && domain.certificateStatus === 'active' && config.isProduction && request.headers['x-forwarded-proto'] !== 'https') {
    response.writeHead(308, { Location: `https://${hostname}${url.pathname}${url.search}` })
    response.end()
    return true
  }

  if (domain.mode === 'maintenance') {
    recordEvent('maintenance_view', domain.id, url.pathname, String(request.headers.referer || ''), String(request.headers['user-agent'] || ''))
    sendHtml(response, 503, maintenanceHtml(publicSettings().name, hostname, domain.target))
    return true
  }

  if (domain.mode === 'redirect' || domain.mode === 'download') {
    const timestamp = new Date().toISOString()
    const rules = db.prepare(`SELECT * FROM redirect_rules WHERE domain_id = ? AND enabled = 1
      AND (starts_at IS NULL OR starts_at <= ?) AND (expires_at IS NULL OR expires_at > ?)
      ORDER BY priority ASC, created_at ASC`).all(domain.id, timestamp, timestamp) as Row[]
    const rule = rules.find((item) => pathMatches(String(item.source_path), url.pathname))
    const target = rule ? String(rule.target) : domain.target
    if (!isHttpUrl(target)) {
      sendHtml(response, 502, maintenanceHtml(publicSettings().name, hostname))
      return true
    }
    const preservePath = rule ? Boolean(rule.preserve_path) : domain.preservePath
    const preserveQuery = rule ? Boolean(rule.preserve_query) : domain.preserveQuery
    const code = rule ? Number(rule.redirect_code) : domain.redirectCode
    if (rule) db.prepare('UPDATE redirect_rules SET hits = hits + 1, updated_at = ? WHERE id = ?').run(new Date().toISOString(), String(rule.id))
    recordEvent(domain.mode === 'download' ? 'download_redirect' : 'redirect', domain.id, url.pathname, String(request.headers.referer || ''), String(request.headers['user-agent'] || ''))
    response.writeHead(code, { Location: buildRedirectTarget(target, url, preservePath, preserveQuery), 'Cache-Control': 'no-store' })
    response.end()
    return true
  }

  if (domain.mode === 'site') {
    recordEvent('site_view', domain.id, url.pathname, String(request.headers.referer || ''), String(request.headers['user-agent'] || ''))
    const site = db.prepare(`SELECT sites.*, site_versions.release_path FROM sites
      JOIN site_versions ON site_versions.id = sites.current_version_id
      WHERE sites.status = 'published' AND (sites.id = ? OR sites.domain = ?) LIMIT 1`).get(domain.target, hostname) as Row | undefined
    if (site && serveSiteRelease(response, String(site.release_path), url.pathname, false)) return true
    sendHtml(response, 404, maintenanceHtml(publicSettings().name, hostname).replace('稍作休息，很快回来。', '网站尚未发布。').replace('正在为这个入口进行维护与升级。<br>请稍后重新访问。', '请在管理后台上传包含 index.html 的网站 ZIP，并将域名目标设置为对应网站。'))
    return true
  }
  return false
}

const mimeTypes: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
}

function serveSiteRelease(response: ServerResponse, releasePath: string, requestPath: string, preview: boolean) {
  const releaseRoot = resolve(releasePath)
  if (!releaseRoot.startsWith(`${config.siteReleasesDir}${sep}`) || !existsSync(releaseRoot)) return false
  let decodedPath: string
  try {
    decodedPath = decodeURIComponent(requestPath).replace(/\\/g, '/')
  } catch {
    throw new HttpError(400, '请求路径编码无效')
  }
  const relative = decodedPath.replace(/^\/+/, '') || 'index.html'
  let filePath = resolve(releaseRoot, relative)
  let responseStatus = 200
  if (!filePath.startsWith(`${releaseRoot}${sep}`)) throw new HttpError(400, '请求路径无效')
  if (existsSync(filePath) && statSync(filePath).isDirectory()) filePath = resolve(filePath, 'index.html')
  if (!existsSync(filePath) || !statSync(filePath).isFile()) {
    const customNotFound = resolve(releaseRoot, '404.html')
    if (existsSync(customNotFound) && statSync(customNotFound).isFile()) {
      filePath = customNotFound
      responseStatus = 404
    } else {
      if (extname(relative)) return false
      filePath = resolve(releaseRoot, 'index.html')
    }
  }
  if (!existsSync(filePath)) return false
  const headers: Record<string, string | number> = {
    'Content-Type': mimeTypes[extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': statSync(filePath).size,
    'Cache-Control': extname(filePath).toLowerCase() === '.html' ? 'no-cache' : 'public, max-age=3600',
  }
  if (preview && extname(filePath).toLowerCase() === '.html') {
    headers['Content-Security-Policy'] = "sandbox allow-scripts; default-src 'self' data: blob:; connect-src 'none'; form-action 'none'; base-uri 'none'"
  }
  response.writeHead(responseStatus, headers)
  createReadStream(filePath).pipe(response)
  return true
}

function trySitePreview(request: IncomingMessage, response: ServerResponse, url: URL) {
  const match = url.pathname.match(/^\/preview\/([^/]+)(\/.*)?$/)
  if (!match) return false
  if (!getAuthenticatedAdmin(request)) {
    sendHtml(response, 401, maintenanceHtml(publicSettings().name, 'Preview').replace('稍作休息，很快回来。', '请先登录管理后台。'))
    return true
  }
  const siteId = decodeURIComponent(match[1])
  const site = db.prepare(`SELECT site_versions.release_path FROM sites
    JOIN site_versions ON site_versions.id = sites.current_version_id WHERE sites.id = ?`).get(siteId) as Row | undefined
  if (!site || !serveSiteRelease(response, String(site.release_path), match[2] || '/', true)) {
    sendHtml(response, 404, maintenanceHtml(publicSettings().name, 'Preview').replace('稍作休息，很快回来。', '预览文件不存在。'))
  }
  return true
}

function serveFrontend(response: ServerResponse, pathname: string) {
  if (pathname === '/login') {
    response.writeHead(308, { Location: `${activeAdminBasePath}/login` })
    response.end()
    return
  }
  const disabledAdminRequest = [...disabledAdminBasePaths].some((path) => pathname === path || pathname.startsWith(`${path}/`))
  if (disabledAdminRequest) {
    sendHtml(response, 404, '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>404</title><body><h1>404</h1><p>页面不存在。</p></body></html>')
    return
  }
  const adminAssetRequest = pathname === '/admin-assets' || pathname.startsWith('/admin-assets/')
  const adminRequest = pathname === activeAdminBasePath || pathname.startsWith(`${activeAdminBasePath}/`)
  const distDir = adminRequest || adminAssetRequest ? config.adminDistDir : config.publicDistDir
  if (!existsSync(distDir)) throw new HttpError(404, `${adminRequest ? '管理端' : '公开端'}尚未构建，请先运行 npm run build`)
  const requestPath = adminAssetRequest ? pathname.slice('/admin-assets'.length) || '/' : adminRequest ? pathname.slice(activeAdminBasePath.length) || '/' : pathname
  const candidate = resolve(distDir, `.${decodeURIComponent(requestPath)}`)
  const safe = candidate === distDir || candidate.startsWith(`${distDir}${sep}`)
  if (adminAssetRequest && (!safe || !existsSync(candidate) || !statSync(candidate).isFile())) throw new HttpError(404, '管理端静态资源不存在')
  let filePath = safe && existsSync(candidate) && statSync(candidate).isFile() ? candidate : resolve(distDir, 'index.html')
  if (!existsSync(filePath)) filePath = resolve(distDir, 'index.html')
  if (adminRequest && extname(filePath) === '.html') {
    const html = readFileSync(filePath, 'utf8').replaceAll('__JTWZ_ADMIN_BASE_PATH__', activeAdminBasePath)
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Content-Length': Buffer.byteLength(html), 'Cache-Control': 'no-cache', 'X-Robots-Tag': 'noindex, nofollow, noarchive' })
    response.end(html)
    return
  }
  response.writeHead(200, { 'Content-Type': mimeTypes[extname(filePath)] || 'application/octet-stream', 'Cache-Control': extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable' })
  createReadStream(filePath).pipe(response)
}

const server = createServer(async (request: AuthenticatedRequest, response) => {
  applySecurityHeaders(request, response)
  await runWithRequestContext(request, response, async () => {
    try {
    const url = new URL(request.url || '/', `http://${request.headers.host || config.appHost}`)
    if (request.method === 'OPTIONS' && url.pathname.startsWith('/api/')) {
      const origin = request.headers.origin
      if (origin && !originAllowed(request, origin)) throw new HttpError(403, '请求来源未被允许')
      response.writeHead(204)
      response.end()
      return
    }
    if (url.pathname.startsWith('/api/')) {
      await api(request, response, url)
      return
    }
    if (trySitePreview(request, response, url)) return
    if (tryDomainRuntime(request, response, url)) return
    serveFrontend(response, url.pathname)
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500
      const message = error instanceof HttpError ? error.message : '服务器内部错误'
      if (status === 500) console.error(error)
      if (!response.headersSent) sendJson(response, status, { error: message })
      else response.end()
    }
  })
})

server.listen(config.port, config.host, () => {
  console.log(`[API] http://${config.host}:${config.port}`)
  console.log(`[DB] ${config.dbPath}`)
  recoverInterruptedTasks()
  startBackupScheduler()
  startCertificateRenewalScheduler()
})

