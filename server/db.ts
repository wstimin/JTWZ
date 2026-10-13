import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { config } from './config.js'
import { hashPassword } from './auth.js'
import { runMigrations } from './migrations/index.js'
import { currentRequestContext, safeAuditDetail } from './middleware/requestContext.js'

export type DomainMode = 'redirect' | 'site' | 'download' | 'maintenance'
export type DomainStatus = 'active' | 'pending' | 'paused' | 'error'

type Row = Record<string, unknown>

export const db = new DatabaseSync(config.dbPath)
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')

db.exec(`
  CREATE TABLE IF NOT EXISTS admins (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash);

  CREATE TABLE IF NOT EXISTS domains (
    id TEXT PRIMARY KEY,
    hostname TEXT NOT NULL UNIQUE,
    mode TEXT NOT NULL CHECK(mode IN ('redirect', 'site', 'download', 'maintenance')),
    target TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL CHECK(status IN ('active', 'pending', 'paused', 'error')),
    redirect_code INTEGER NOT NULL DEFAULT 302 CHECK(redirect_code IN (301, 302)),
    preserve_path INTEGER NOT NULL DEFAULT 1,
    preserve_query INTEGER NOT NULL DEFAULT 1,
    force_https INTEGER NOT NULL DEFAULT 1,
    verification_token TEXT NOT NULL DEFAULT '',
    dns_status TEXT NOT NULL DEFAULT 'unverified',
    certificate_status TEXT NOT NULL DEFAULT 'pending',
    last_verified_at TEXT,
    visits INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS certificates (
    id TEXT PRIMARY KEY,
    domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    provider TEXT NOT NULL DEFAULT 'manual',
    issuer TEXT NOT NULL DEFAULT '',
    serial_number TEXT NOT NULL DEFAULT '',
    external_ref TEXT NOT NULL DEFAULT '',
    issued_at TEXT,
    expires_at TEXT,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'active', 'expiring', 'expired', 'error', 'revoked')),
    auto_renew INTEGER NOT NULL DEFAULT 1,
    note TEXT NOT NULL DEFAULT '',
    last_error TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_certificates_domain ON certificates(domain_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS redirect_rules (
    id TEXT PRIMARY KEY,
    domain_id TEXT NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    source_path TEXT NOT NULL DEFAULT '/*',
    target TEXT NOT NULL,
    redirect_code INTEGER NOT NULL DEFAULT 302 CHECK(redirect_code IN (301, 302)),
    preserve_path INTEGER NOT NULL DEFAULT 1,
    preserve_query INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    priority INTEGER NOT NULL DEFAULT 100,
    starts_at TEXT,
    expires_at TEXT,
    hits INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_redirect_rules_domain ON redirect_rules(domain_id, enabled, priority);

  CREATE TABLE IF NOT EXISTS sites (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    path TEXT NOT NULL,
    domain TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft',
    visits INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL DEFAULT '',
    current_version_id TEXT,
    updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS site_versions (
    id TEXT PRIMARY KEY,
    site_id TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    release_path TEXT NOT NULL,
    source_name TEXT NOT NULL DEFAULT '',
    file_count INTEGER NOT NULL DEFAULT 0,
    byte_size INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_site_versions_site ON site_versions(site_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS software (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    version TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT '',
    architecture TEXT NOT NULL DEFAULT '',
    size TEXT NOT NULL DEFAULT '',
    download_url TEXT NOT NULL DEFAULT '',
    downloads INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'draft',
    accent TEXT NOT NULL DEFAULT 'AP',
    updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS software_versions (
    id TEXT PRIMARY KEY,
    software_id TEXT NOT NULL REFERENCES software(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'stable' CHECK(channel IN ('stable', 'beta', 'alpha')),
    release_notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft', 'published', 'archived')),
    is_recommended INTEGER NOT NULL DEFAULT 0,
    published_at TEXT,
    updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    UNIQUE(software_id, version)
  );
  CREATE INDEX IF NOT EXISTS idx_software_versions_software ON software_versions(software_id, created_at DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_software_versions_recommended ON software_versions(software_id) WHERE is_recommended = 1;

  CREATE TABLE IF NOT EXISTS packages (
    id TEXT PRIMARY KEY,
    file_name TEXT NOT NULL,
    software_id TEXT REFERENCES software(id) ON DELETE SET NULL,
    version_id TEXT REFERENCES software_versions(id) ON DELETE SET NULL,
    version TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT '',
    size TEXT NOT NULL DEFAULT '',
    storage TEXT NOT NULL DEFAULT '',
    object_key TEXT NOT NULL DEFAULT '',
    byte_size INTEGER NOT NULL DEFAULT 0,
    sha256 TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    downloads INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'processing',
    release_notes TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    body TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('published', 'draft')),
    pinned INTEGER NOT NULL DEFAULT 0,
    published_at TEXT,
    updated_at TEXT NOT NULL,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_announcements_public ON announcements(status, pinned, published_at);

  CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY CHECK(id = 1),
    name TEXT NOT NULL,
    tagline TEXT NOT NULL,
    support_email TEXT NOT NULL,
    footer_text TEXT NOT NULL,
    logo_path TEXT NOT NULL DEFAULT '',
    default_redirect_code INTEGER NOT NULL DEFAULT 302,
    auto_https INTEGER NOT NULL DEFAULT 1,
    traffic_alerts INTEGER NOT NULL DEFAULT 1,
    public_maintenance INTEGER NOT NULL DEFAULT 0,
    maintenance_message TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analytics_events (
    id TEXT PRIMARY KEY,
    event_type TEXT NOT NULL,
    domain_id TEXT REFERENCES domains(id) ON DELETE SET NULL,
    path TEXT NOT NULL DEFAULT '',
    referrer TEXT NOT NULL DEFAULT '',
    user_agent TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_analytics_created ON analytics_events(created_at);

  CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    admin_id TEXT REFERENCES admins(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT NOT NULL,
    entity_id TEXT NOT NULL DEFAULT '',
    detail TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS upload_sessions (
    id TEXT PRIMARY KEY,
    object_key TEXT NOT NULL,
    file_name TEXT NOT NULL,
    software_id TEXT REFERENCES software(id) ON DELETE CASCADE,
    version TEXT NOT NULL,
    platform TEXT NOT NULL,
    content_type TEXT NOT NULL DEFAULT 'application/octet-stream',
    total_bytes INTEGER NOT NULL,
    chunk_size INTEGER NOT NULL,
    total_chunks INTEGER NOT NULL,
    received_chunks TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'uploading',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_upload_sessions_status ON upload_sessions(status, updated_at);

  CREATE TABLE IF NOT EXISTS operation_tasks (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    label TEXT NOT NULL,
    entity_type TEXT NOT NULL DEFAULT '',
    entity_id TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued', 'running', 'succeeded', 'failed', 'cancelled')),
    progress INTEGER NOT NULL DEFAULT 0,
    message TEXT NOT NULL DEFAULT '',
    input_json TEXT NOT NULL DEFAULT '{}',
    result_json TEXT NOT NULL DEFAULT '{}',
    error TEXT NOT NULL DEFAULT '',
    logs_json TEXT NOT NULL DEFAULT '[]',
    retryable INTEGER NOT NULL DEFAULT 0,
    retry_of TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    started_at TEXT,
    finished_at TEXT,
    updated_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_operation_tasks_status ON operation_tasks(status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    applied_at TEXT NOT NULL
  );
`)

runMigrations(db)

const now = new Date().toISOString()
const existingAdmin = db.prepare('SELECT id FROM admins WHERE username = ?').get(config.adminUsername)
if (!existingAdmin) {
  db.prepare(`INSERT INTO admins (id, username, password_hash, display_name, role, status, updated_at, created_at)
    VALUES (?, ?, ?, ?, 'owner', 'active', ?, ?)`).run(randomUUID(), config.adminUsername, hashPassword(config.adminPassword), config.adminUsername, now, now)
}

db.prepare(`INSERT OR IGNORE INTO settings
  (id, name, tagline, support_email, footer_text, default_redirect_code, auto_https, traffic_alerts, updated_at)
  VALUES (1, ?, ?, ?, ?, 302, 1, 1, ?)`)
  .run('JTWZ', '统一管理数字入口、静态网站与软件分发。', '', '多域名跳转、静态网站发布与软件分发平台。', now)

// Remove records created by the previous development seed and smoke-test runs.
// The migration is exact so operator-created records are never removed by a
// broad name or hostname match.
if (!db.prepare('SELECT name FROM schema_migrations WHERE name = ?').get('remove-development-demo-content-v1')) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const demoSoftware = db.prepare("SELECT id FROM software WHERE slug IN ('aurelia-desktop', 'aurelia-connect', 'aurelia-mobile')").all() as Row[]
    for (const row of demoSoftware) {
      db.prepare('DELETE FROM packages WHERE software_id = ?').run(String(row.id))
      db.prepare('DELETE FROM software WHERE id = ?').run(String(row.id))
    }
    db.prepare("DELETE FROM packages WHERE file_name LIKE 'aurelia-%'").run()
    db.prepare("DELETE FROM sites WHERE path IN ('/sites/golden-love', '/sites/autumn-launch', '/sites/product-docs') OR name IN ('金色告白', 'Autumn Launch', '产品文档')").run()
    db.prepare("DELETE FROM domains WHERE hostname IN ('love.example', 'event.example', 'download.example', 'docs.example', 'legacy.example')").run()
    db.prepare('DELETE FROM analytics_events').run()
    db.prepare('DELETE FROM audit_logs').run()
    db.prepare('DELETE FROM sessions').run()
    db.prepare('DELETE FROM upload_sessions').run()
    db.prepare("UPDATE settings SET name = 'JTWZ', tagline = '统一管理数字入口、静态网站与软件分发。', support_email = '', footer_text = '多域名跳转、静态网站发布与软件分发平台。', updated_at = ? WHERE name = 'Aurelia' AND support_email = 'support@example.com'").run(now)
    db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run('remove-development-demo-content-v1', now)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

// The previous local database was created with a development-only credential.
// Refresh it once so the checked-in cleanup never leaves the old credential
// active. A configured ADMIN_PASSWORD is always respected.
if (!process.env.ADMIN_PASSWORD && !db.prepare('SELECT name FROM schema_migrations WHERE name = ?').get('refresh-local-admin-credential-v1')) {
  db.prepare('UPDATE admins SET password_hash = ? WHERE username = ?').run(hashPassword(config.adminPassword), config.adminUsername)
  db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run('refresh-local-admin-credential-v1', now)
}

for (const row of db.prepare("SELECT id FROM domains WHERE verification_token = ''").all() as Row[]) {
  db.prepare('UPDATE domains SET verification_token = ? WHERE id = ?').run(randomUUID(), String(row.id))
}
if (!config.isProduction) {
  db.prepare("UPDATE domains SET dns_status = 'verified', certificate_status = 'active', last_verified_at = COALESCE(last_verified_at, ?) WHERE status = 'active' AND hostname LIKE '%.example'")
    .run(now)
}

// Migrate legacy package-derived releases into first-class software versions.
for (const softwareRow of db.prepare("SELECT id, version, status, updated_at, created_at FROM software WHERE version <> ''").all() as Row[]) {
  const existing = db.prepare('SELECT id FROM software_versions WHERE software_id = ? AND version = ?').get(String(softwareRow.id), String(softwareRow.version)) as Row | undefined
  if (!existing) {
    const versionId = randomUUID()
    const published = String(softwareRow.status) === 'published'
    db.prepare(`INSERT INTO software_versions
      (id, software_id, version, channel, release_notes, status, is_recommended, published_at, updated_at, created_at)
      VALUES (?, ?, ?, 'stable', '', ?, ?, ?, ?, ?)`)
      .run(versionId, String(softwareRow.id), String(softwareRow.version), published ? 'published' : 'draft', published ? 1 : 0,
        published ? String(softwareRow.updated_at) : null, String(softwareRow.updated_at), String(softwareRow.created_at))
  }
}

for (const packageRow of db.prepare("SELECT id, software_id, version, release_notes, updated_at, created_at FROM packages WHERE software_id IS NOT NULL AND version <> ''").all() as Row[]) {
  let versionRow = db.prepare('SELECT id FROM software_versions WHERE software_id = ? AND version = ?').get(String(packageRow.software_id), String(packageRow.version)) as Row | undefined
  if (!versionRow) {
    const versionId = randomUUID()
    db.prepare(`INSERT INTO software_versions
      (id, software_id, version, channel, release_notes, status, is_recommended, published_at, updated_at, created_at)
      VALUES (?, ?, ?, 'stable', ?, 'draft', 0, NULL, ?, ?)`)
      .run(versionId, String(packageRow.software_id), String(packageRow.version), String(packageRow.release_notes || ''),
        String(packageRow.updated_at || packageRow.created_at), String(packageRow.created_at))
    versionRow = { id: versionId }
  }
  db.prepare('UPDATE packages SET version_id = ? WHERE id = ?').run(String(versionRow.id), String(packageRow.id))
}
db.prepare("UPDATE software_versions SET channel = 'alpha' WHERE channel = 'stable' AND LOWER(version) LIKE '%alpha%'").run()
db.prepare("UPDATE software_versions SET channel = 'beta' WHERE channel = 'stable' AND (LOWER(version) LIKE '%beta%' OR LOWER(version) LIKE '%-rc%')").run()

export function normalizeHostname(value: string) {
  return value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '').split('/')[0].replace(/\.$/, '').replace(/:\d+$/, '')
}

export function isValidHostname(hostname: string) {
  return hostname === 'localhost' || /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(hostname)
}

export function isHttpUrl(value: string) {
  try {
    return ['http:', 'https:'].includes(new URL(value).protocol)
  } catch {
    return false
  }
}

export function mapDomain(row: Row) {
  return {
    id: String(row.id),
    hostname: String(row.hostname),
    mode: row.mode as DomainMode,
    target: String(row.target),
    status: row.status as DomainStatus,
    redirectCode: Number(row.redirect_code) as 301 | 302,
    preservePath: Boolean(row.preserve_path),
    preserveQuery: Boolean(row.preserve_query),
    forceHttps: Boolean(row.force_https),
    verificationToken: String(row.verification_token || ''),
    dnsStatus: String(row.dns_status || 'unverified'),
    certificateStatus: String(row.certificate_status || 'pending'),
    lastVerifiedAt: row.last_verified_at ? String(row.last_verified_at) : undefined,
    visits: Number(row.visits),
    updatedAt: String(row.updated_at),
  }
}

export function mapCertificate(row: Row) {
  const expiresAt = row.expires_at ? String(row.expires_at) : undefined
  const expiresInDays = expiresAt ? Math.ceil((Date.parse(expiresAt) - Date.now()) / (24 * 60 * 60 * 1000)) : undefined
  return {
    id: String(row.id),
    domainId: String(row.domain_id),
    hostname: String(row.hostname || ''),
    provider: String(row.provider || 'manual'),
    issuer: String(row.issuer || ''),
    serialNumber: String(row.serial_number || ''),
    externalRef: String(row.external_ref || ''),
    issuedAt: row.issued_at ? String(row.issued_at) : undefined,
    expiresAt,
    expiresInDays,
    status: String(row.status || 'pending'),
    autoRenew: Boolean(row.auto_renew),
    note: String(row.note || ''),
    lastError: String(row.last_error || ''),
    updatedAt: String(row.updated_at),
    createdAt: String(row.created_at),
  }
}

export function mapSettings(row: Row) {
  return {
    name: String(row.name),
    tagline: String(row.tagline),
    supportEmail: String(row.support_email),
    footerText: String(row.footer_text),
    logoUrl: row.logo_path ? `/api/public/brand/logo?v=${encodeURIComponent(String(row.updated_at))}` : '',
    defaultRedirectCode: Number(row.default_redirect_code) as 301 | 302,
    autoHttps: Boolean(row.auto_https),
    trafficAlerts: Boolean(row.traffic_alerts),
    publicMaintenance: Boolean(row.public_maintenance),
    maintenanceMessage: String(row.maintenance_message || ''),
  }
}

export function mapSoftware(row: Row) {
  return {
    id: String(row.id),
    name: String(row.name),
    slug: String(row.slug),
    description: String(row.description),
    version: String(row.version),
    platform: String(row.platform),
    architecture: String(row.architecture),
    size: String(row.size),
    downloadUrl: String(row.download_url),
    downloads: Number(row.downloads),
    status: String(row.status),
    updatedAt: String(row.updated_at).slice(0, 10),
    accent: String(row.accent),
  }
}

export function mapSite(row: Row) {
  return {
    id: String(row.id),
    name: String(row.name),
    path: String(row.path),
    domain: String(row.domain),
    status: String(row.status),
    visits: Number(row.visits),
    updatedAt: String(row.updated_at),
    category: String(row.category),
    currentVersionId: row.current_version_id ? String(row.current_version_id) : undefined,
  }
}

export function mapPackage(row: Row) {
  return {
    id: String(row.id),
    fileName: String(row.file_name),
    software: String(row.software_name || '未关联软件'),
    softwareId: row.software_id ? String(row.software_id) : '',
    versionId: row.version_id ? String(row.version_id) : '',
    version: String(row.version),
    platform: String(row.platform),
    size: String(row.size),
    byteSize: Number(row.byte_size),
    sha256: String(row.sha256),
    storage: String(row.storage),
    downloads: Number(row.downloads),
    status: String(row.status),
    releaseNotes: String(row.release_notes || ''),
    createdAt: String(row.created_at),
  }
}

export function mapSoftwareVersion(row: Row) {
  return {
    id: String(row.id),
    softwareId: String(row.software_id),
    software: String(row.software_name || '未关联软件'),
    version: String(row.version),
    channel: String(row.channel),
    releaseNotes: String(row.release_notes || ''),
    status: String(row.status),
    isRecommended: Boolean(row.is_recommended),
    packageCount: Number(row.package_count || 0),
    downloads: Number(row.downloads || 0),
    platforms: String(row.platforms || '').split(',').filter(Boolean),
    publishedAt: row.published_at ? String(row.published_at) : undefined,
    updatedAt: String(row.updated_at),
    createdAt: String(row.created_at),
  }
}

export function audit(adminId: string | null, action: string, entityType: string, entityId = '', detail = '') {
  const context = currentRequestContext()
  db.prepare(`INSERT INTO audit_logs (id, admin_id, action, entity_type, entity_id, detail, request_id, ip_address, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(randomUUID(), adminId, action, entityType, entityId, safeAuditDetail(detail), context.requestId, context.ipAddress, new Date().toISOString())
}

export function recordEvent(eventType: string, domainId: string, path: string, referrer: string, userAgent: string) {
  const timestamp = new Date().toISOString()
  db.prepare('UPDATE domains SET visits = visits + 1, updated_at = ? WHERE id = ?').run(timestamp, domainId)
  db.prepare(`INSERT INTO analytics_events (id, event_type, domain_id, path, referrer, user_agent, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`)
    .run(randomUUID(), eventType, domainId, path.slice(0, 1000), referrer.slice(0, 1000), userAgent.slice(0, 1000), timestamp)
}

