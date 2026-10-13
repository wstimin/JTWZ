import type { DatabaseSync } from 'node:sqlite'

type Row = Record<string, unknown>

function ensureColumn(db: DatabaseSync, table: string, column: string, definition: string) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all() as Row[]
  if (!columns.some((item) => String(item.name) === column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)
}

export function runMigrations(db: DatabaseSync) {
  ensureColumn(db, 'sites', 'current_version_id', 'TEXT')
  ensureColumn(db, 'domains', 'verification_token', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'domains', 'dns_status', "TEXT NOT NULL DEFAULT 'unverified'")
  ensureColumn(db, 'domains', 'certificate_status', "TEXT NOT NULL DEFAULT 'pending'")
  ensureColumn(db, 'domains', 'last_verified_at', 'TEXT')
  ensureColumn(db, 'redirect_rules', 'name', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'redirect_rules', 'notes', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'redirect_rules', 'starts_at', 'TEXT')
  ensureColumn(db, 'redirect_rules', 'expires_at', 'TEXT')
  ensureColumn(db, 'packages', 'byte_size', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'packages', 'sha256', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'packages', 'mime_type', "TEXT NOT NULL DEFAULT 'application/octet-stream'")
  ensureColumn(db, 'packages', 'updated_at', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'packages', 'release_notes', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'packages', 'version_id', 'TEXT')
  ensureColumn(db, 'settings', 'logo_path', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'settings', 'public_maintenance', 'INTEGER NOT NULL DEFAULT 0')
  ensureColumn(db, 'settings', 'maintenance_message', "TEXT NOT NULL DEFAULT ''")

  ensureColumn(db, 'admins', 'display_name', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'admins', 'role', "TEXT NOT NULL DEFAULT 'owner'")
  ensureColumn(db, 'admins', 'status', "TEXT NOT NULL DEFAULT 'active'")
  ensureColumn(db, 'admins', 'totp_secret', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'admins', 'totp_pending_secret', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'admins', 'recovery_codes', "TEXT NOT NULL DEFAULT '[]'")
  ensureColumn(db, 'admins', 'last_login_at', 'TEXT')
  ensureColumn(db, 'admins', 'updated_at', "TEXT NOT NULL DEFAULT ''")

  ensureColumn(db, 'sessions', 'csrf_token', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'sessions', 'ip_address', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'sessions', 'user_agent', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'sessions', 'device_name', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'sessions', 'last_seen_at', "TEXT NOT NULL DEFAULT ''")

  ensureColumn(db, 'audit_logs', 'request_id', "TEXT NOT NULL DEFAULT ''")
  ensureColumn(db, 'audit_logs', 'ip_address', "TEXT NOT NULL DEFAULT ''")

  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_login_events (
      id TEXT PRIMARY KEY,
      admin_id TEXT REFERENCES admins(id) ON DELETE SET NULL,
      username TEXT NOT NULL DEFAULT '',
      success INTEGER NOT NULL DEFAULT 0,
      reason TEXT NOT NULL DEFAULT '',
      ip_address TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      device_name TEXT NOT NULL DEFAULT '',
      request_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_login_events_admin ON admin_login_events(admin_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS login_challenges (
      id TEXT PRIMARY KEY,
      admin_id TEXT NOT NULL REFERENCES admins(id) ON DELETE CASCADE,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      ip_address TEXT NOT NULL DEFAULT '',
      user_agent TEXT NOT NULL DEFAULT '',
      request_id TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_login_challenges_expiry ON login_challenges(expires_at);
  `)

  const timestamp = new Date().toISOString()
  db.prepare("UPDATE admins SET display_name = username WHERE display_name = ''").run()
  db.prepare("UPDATE admins SET updated_at = created_at WHERE updated_at = ''").run()
  db.prepare("UPDATE sessions SET last_seen_at = created_at WHERE last_seen_at = ''").run()
  if (!db.prepare('SELECT name FROM schema_migrations WHERE name = ?').get('professional-security-schema-v1')) {
    db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run('professional-security-schema-v1', timestamp)
  }
  if (!db.prepare('SELECT name FROM schema_migrations WHERE name = ?').get('invalidate-legacy-sessions-v1')) {
    db.prepare("DELETE FROM sessions WHERE csrf_token = ''").run()
    db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run('invalidate-legacy-sessions-v1', timestamp)
  }
}
