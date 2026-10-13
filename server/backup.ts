import { createHash } from 'node:crypto'
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readdirSync, readFileSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { copyFile, rename } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { createGunzip, createGzip } from 'node:zlib'
import { db } from './db.js'
import { config, normalizeAdminBasePath } from './config.js'
import { createStorageDownload, createStorageUpload, isStorageConfigured, objectStorageMode } from './objectStorage.js'

type Row = Record<string, unknown>
type FileEntry = { archivePath: string; byteSize: number; sha256?: string; sourcePath?: string; objectKey?: string }
type BackupConfiguration = { environment: Record<string, string>; adminBasePath: string; containsSecrets: boolean }
type MigrationManifest = {
  format: 'jtwz-portable-backup' | 'aurelia-portable-backup'
  version: 2 | 3
  exportedAt: string
  systemVersion: string
  databaseSchemaVersion: number
  minimumSystemVersion: string
  storageProvider: string
  totalFiles: number
  totalBytes: number
  tables: Record<string, unknown[]>
  files: { siteReleases: FileEntry[]; brandAssets: FileEntry[]; objects: FileEntry[] }
  configuration?: BackupConfiguration
  contentSha256?: string
}

const backupTables = ['admins', 'settings', 'domains', 'certificates', 'redirect_rules', 'sites', 'site_versions', 'software', 'software_versions', 'packages', 'announcements', 'analytics_events', 'audit_logs', 'admin_login_events', 'operation_tasks'] as const
const restoreDeleteOrder = ['login_challenges', 'sessions', 'admin_login_events', 'analytics_events', 'redirect_rules', 'certificates', 'site_versions', 'packages', 'software_versions', 'domains', 'sites', 'software', 'announcements', 'audit_logs', 'operation_tasks', 'admins'] as const
const restoreInsertOrder = ['settings', 'admins', 'domains', 'certificates', 'redirect_rules', 'sites', 'site_versions', 'software', 'software_versions', 'packages', 'announcements', 'analytics_events', 'audit_logs', 'admin_login_events', 'operation_tasks'] as const
const migrationEnvironmentKeys = [
  'NODE_ENV', 'COOKIE_SECURE', 'API_HOST', 'API_PORT', 'APP_HOST', 'PUBLIC_ADDRESS', 'ADMIN_ADDRESS', 'PUBLIC_DOMAIN', 'ADMIN_DOMAIN',
  'ADMIN_BASE_PATH', 'ADMIN_DISABLED_PATHS', 'PUBLIC_URL', 'ADMIN_LOGIN_URL', 'APP_ORIGIN', 'PUBLIC_APP_ORIGIN', 'ADMIN_APP_ORIGIN', 'ADMIN_USERNAME',
  'APP_SECRET', 'SESSION_DAYS', 'STORAGE_PROVIDER', 'ALLOW_LOCAL_STORAGE_IN_PRODUCTION', 'S3_ENDPOINT', 'S3_REGION', 'S3_BUCKET', 'S3_ACCESS_KEY',
  'S3_SECRET_KEY', 'S3_PUBLIC_BASE_URL', 'STORAGE_URL_TTL', 'MAX_PACKAGE_BYTES', 'MAX_SITE_ZIP_BYTES', 'MAX_BACKUP_BYTES', 'MAX_UPDATE_BYTES',
  'BACKUP_INTERVAL_HOURS', 'BACKUP_RETENTION_DAYS', 'BACKUP_REMOTE', 'ALERT_WEBHOOK_URL', 'ALERT_WEBHOOK_SECRET', 'CERTIFICATE_CALLBACK_SECRET',
  'DNS_PROVIDER', 'CERTIFICATE_PROVIDER', 'CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_BASE', 'DNS_WEBHOOK_URL', 'DNS_WEBHOOK_SECRET',
  'UPDATE_MANIFEST_URL', 'UPDATE_PUBLIC_KEY_B64', 'UPDATE_PUBLIC_KEY', 'UPDATE_APPLY_COMMAND', 'UPDATE_APPLY_ARGS_JSON',
  'DOMAIN_APPLY_COMMAND', 'DOMAIN_APPLY_ARGS_JSON', 'SUPPORT_EMAIL',
] as const

mkdirSync(config.backupDir, { recursive: true })

function parseEnvironmentFile() {
  const values: Record<string, string> = {}
  if (!existsSync(config.envPath)) return values
  for (const rawLine of readFileSync(config.envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    values[line.slice(0, separator).trim()] = line.slice(separator + 1).trim()
  }
  return values
}

function captureConfiguration(): BackupConfiguration {
  const fileValues = parseEnvironmentFile()
  const environment: Record<string, string> = {}
  for (const key of migrationEnvironmentKeys) {
    const value = process.env[key] ?? fileValues[key]
    if (value !== undefined) environment[key] = String(value)
  }
  const admin = db.prepare('SELECT username FROM admins ORDER BY created_at ASC LIMIT 1').get() as Row | undefined
  if (admin?.username) environment.ADMIN_USERNAME = String(admin.username)
  environment.ADMIN_BASE_PATH = String(environment.ADMIN_BASE_PATH || config.adminBasePath)
  return { environment, adminBasePath: environment.ADMIN_BASE_PATH, containsSecrets: true }
}

function integrityPayload(manifest: MigrationManifest) {
  return {
    format: manifest.format, version: manifest.version, exportedAt: manifest.exportedAt, systemVersion: manifest.systemVersion,
    databaseSchemaVersion: manifest.databaseSchemaVersion, minimumSystemVersion: manifest.minimumSystemVersion,
    storageProvider: manifest.storageProvider, totalFiles: manifest.totalFiles, totalBytes: manifest.totalBytes,
    tables: manifest.tables, files: manifest.files, configuration: manifest.configuration,
  }
}

function manifestIntegrity(manifest: MigrationManifest) {
  return createHash('sha256').update(JSON.stringify(integrityPayload(manifest))).digest('hex')
}

function sha256FileSync(filePath: string) {
  const descriptor = openSync(filePath, 'r')
  const hash = createHash('sha256')
  const buffer = Buffer.allocUnsafe(1024 * 1024)
  try {
    let bytes = 0
    while ((bytes = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes))
    return hash.digest('hex')
  } finally {
    closeSync(descriptor)
  }
}

function listFiles(root: string, prefix: string): FileEntry[] {
  if (!existsSync(root)) return []
  const entries: FileEntry[] = []
  const walk = (folder: string) => {
    for (const item of readdirSync(folder, { withFileTypes: true })) {
      const absolute = resolve(folder, item.name)
      if (item.isDirectory()) walk(absolute)
      else if (item.isFile()) entries.push({ archivePath: `${prefix}/${relative(root, absolute).replace(/\\/g, '/')}`, sourcePath: absolute, byteSize: statSync(absolute).size, sha256: sha256FileSync(absolute) })
    }
  }
  walk(root)
  return entries
}

function tarPathParts(value: string) {
  const normalized = value.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalized || normalized.includes('../') || normalized.length > 255) throw new Error(`备份路径无效或过长：${normalized}`)
  if (Buffer.byteLength(normalized) <= 100) return { name: normalized, prefix: '' }
  const slashPositions = [...normalized.matchAll(/\//g)].map((match) => match.index || 0).reverse()
  for (const index of slashPositions) {
    const prefix = normalized.slice(0, index)
    const name = normalized.slice(index + 1)
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix }
  }
  throw new Error(`备份路径无法写入归档：${normalized}`)
}

function writeText(target: Buffer, offset: number, length: number, value: string) {
  target.write(value, offset, Math.min(length, Buffer.byteLength(value)), 'utf8')
}

function writeOctal(target: Buffer, offset: number, length: number, value: number) {
  const encoded = Math.max(0, Math.floor(value)).toString(8).padStart(length - 1, '0').slice(-(length - 1))
  target.write(`${encoded}\0`, offset, length, 'ascii')
}

function tarHeader(archivePath: string, size: number) {
  const header = Buffer.alloc(512)
  const parts = tarPathParts(archivePath)
  writeText(header, 0, 100, parts.name)
  writeOctal(header, 100, 8, 0o640)
  writeOctal(header, 108, 8, 0)
  writeOctal(header, 116, 8, 0)
  writeOctal(header, 124, 12, size)
  writeOctal(header, 136, 12, Math.floor(Date.now() / 1000))
  header.fill(0x20, 148, 156)
  header[156] = '0'.charCodeAt(0)
  writeText(header, 257, 6, 'ustar')
  writeText(header, 263, 2, '00')
  writeText(header, 265, 32, 'jtwz')
  writeText(header, 297, 32, 'jtwz')
  writeText(header, 345, 155, parts.prefix)
  const checksum = header.reduce((sum, byte) => sum + byte, 0).toString(8).padStart(6, '0').slice(-6)
  header.write(`${checksum}\0 `, 148, 8, 'ascii')
  return header
}

async function writeChunk(stream: NodeJS.WritableStream, chunk: Buffer) {
  if (!stream.write(chunk)) await new Promise<void>((resolvePromise, reject) => {
    stream.once('drain', resolvePromise)
    stream.once('error', reject)
  })
}

async function addTarEntry(output: NodeJS.WritableStream, entry: FileEntry, source: Readable) {
  await writeChunk(output, tarHeader(entry.archivePath, entry.byteSize))
  let written = 0
  for await (const chunk of source) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    written += bytes.length
    if (written > entry.byteSize) throw new Error(`文件大小超出清单：${entry.archivePath}`)
    await writeChunk(output, bytes)
  }
  if (written !== entry.byteSize) throw new Error(`文件大小与清单不一致：${entry.archivePath}`)
  const padding = (512 - (written % 512)) % 512
  if (padding) await writeChunk(output, Buffer.alloc(padding))
}

async function remoteObjectStream(objectKey: string) {
  const url = createStorageDownload(objectKey)
  if (!url) throw new Error(`无法生成对象下载地址：${objectKey}`)
  const response = await fetch(url)
  if (!response.ok || !response.body) throw new Error(`无法读取对象 ${objectKey}（${response.status}）`)
  return Readable.fromWeb(response.body as never)
}

function buildManifest(): MigrationManifest {
  const siteReleases = listFiles(config.siteReleasesDir, 'site-releases')
  const brandAssets = listFiles(config.brandAssetsDir, 'brand-assets')
  const objects: FileEntry[] = (db.prepare("SELECT object_key, byte_size, sha256 FROM packages WHERE object_key <> '' AND status <> 'processing'").all() as Row[])
    .map((row) => ({ archivePath: `storage/${String(row.object_key).replace(/\\/g, '/')}`, objectKey: String(row.object_key), byteSize: Number(row.byte_size), sha256: String(row.sha256 || '') }))
  const seen = new Set<string>()
  const uniqueObjects = objects.filter((item) => item.byteSize >= 0 && !seen.has(item.archivePath) && Boolean(seen.add(item.archivePath)))
  if (objectStorageMode === 'local') {
    for (const entry of uniqueObjects) {
      entry.sourcePath = resolve(config.storageDir, entry.objectKey || '')
      if (!entry.sourcePath.startsWith(`${config.storageDir}${sep}`) || !existsSync(entry.sourcePath)) throw new Error(`安装包文件缺失，无法生成完整备份：${entry.objectKey}`)
      entry.byteSize = statSync(entry.sourcePath).size
      entry.sha256 = sha256FileSync(entry.sourcePath)
    }
  } else if (uniqueObjects.some((entry) => !/^[a-f0-9]{64}$/i.test(entry.sha256 || ''))) {
    throw new Error('对象存储中存在缺少 SHA-256 的安装包，无法生成可校验的完整备份')
  }
  const allFiles = [...siteReleases, ...brandAssets, ...uniqueObjects]
  const manifest: MigrationManifest = {
    format: 'jtwz-portable-backup',
    version: 3,
    exportedAt: new Date().toISOString(),
    systemVersion: config.systemVersion,
    databaseSchemaVersion: 2,
    minimumSystemVersion: '1.0.0',
    storageProvider: objectStorageMode,
    totalFiles: allFiles.length,
    totalBytes: allFiles.reduce((sum, item) => sum + item.byteSize, 0),
    tables: Object.fromEntries(backupTables.map((table) => [table, db.prepare(`SELECT * FROM ${table}`).all()])),
    files: { siteReleases, brandAssets, objects: uniqueObjects },
    configuration: captureConfiguration(),
  }
  manifest.contentSha256 = manifestIntegrity(manifest)
  return manifest
}

export async function createBackup() {
  const manifest = buildManifest()
  const stamp = manifest.exportedAt.replace(/[:.]/g, '-').replace('Z', 'Z')
  const fileName = `jtwz-${stamp}.jtwz-backup`
  const destination = resolve(config.backupDir, fileName)
  const temporary = `${destination}.tmp`
  const gzip = createGzip({ level: 6 })
  const file = createWriteStream(temporary, { flags: 'wx' })
  gzip.pipe(file)
  try {
    const manifestBytes = Buffer.from(JSON.stringify(manifest), 'utf8')
    await addTarEntry(gzip, { archivePath: 'manifest.json', byteSize: manifestBytes.length }, Readable.from(manifestBytes))
    for (const entry of manifest.files.siteReleases) await addTarEntry(gzip, entry, createReadStream(entry.sourcePath!))
    for (const entry of manifest.files.brandAssets) await addTarEntry(gzip, entry, createReadStream(entry.sourcePath!))
    for (const entry of manifest.files.objects) {
      const source = objectStorageMode === 's3' ? await remoteObjectStream(entry.objectKey!) : createReadStream(entry.sourcePath!)
      await addTarEntry(gzip, entry, source)
    }
    await writeChunk(gzip, Buffer.alloc(1024))
    gzip.end()
    await Promise.all([finished(gzip), finished(file)])
    await rename(temporary, destination)
  } catch (error) {
    gzip.destroy()
    file.destroy()
    rmSync(temporary, { force: true })
    throw error
  }

  let remote = false
  if (config.backupRemote && objectStorageMode === 's3' && isStorageConfigured()) {
    const upload = createStorageUpload(`backups/${fileName}`, 'application/gzip')
    const response = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: createReadStream(destination), duplex: 'half' } as unknown as RequestInit)
    if (!response.ok) throw new Error(`远端备份上传失败（${response.status}）`)
    remote = true
  }
  pruneBackups()
  return { fileName, createdAt: manifest.exportedAt, byteSize: statSync(destination).size, sha256: sha256FileSync(destination), remote, formatVersion: manifest.version, containsSecrets: true }
}

class StreamReader {
  private iterator: AsyncIterator<unknown>
  private buffered = Buffer.alloc(0)
  private ended = false

  constructor(stream: Readable) {
    this.iterator = stream[Symbol.asyncIterator]()
  }

  private async fill() {
    if (this.ended) return
    const next = await this.iterator.next()
    if (next.done) this.ended = true
    else this.buffered = Buffer.concat([this.buffered, Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value as Uint8Array)])
  }

  async readExact(size: number) {
    while (this.buffered.length < size && !this.ended) await this.fill()
    if (this.buffered.length < size) throw new Error('迁移备份意外结束')
    const result = this.buffered.subarray(0, size)
    this.buffered = this.buffered.subarray(size)
    return result
  }

  async pipeExact(size: number, destination: NodeJS.WritableStream | null, collectLimit = 0) {
    let remaining = size
    const collected: Buffer[] = []
    while (remaining > 0) {
      if (!this.buffered.length) await this.fill()
      if (!this.buffered.length) throw new Error('迁移备份中的文件不完整')
      const length = Math.min(remaining, this.buffered.length)
      const chunk = this.buffered.subarray(0, length)
      this.buffered = this.buffered.subarray(length)
      remaining -= length
      if (destination) await writeChunk(destination, chunk)
      if (collectLimit) {
        if (size > collectLimit) throw new Error('迁移清单超过安全大小限制')
        collected.push(Buffer.from(chunk))
      }
    }
    return Buffer.concat(collected)
  }
}

function readTarString(buffer: Buffer, offset: number, length: number) {
  return buffer.subarray(offset, offset + length).toString('utf8').replace(/\0.*$/, '')
}

function validateTarHeader(header: Buffer) {
  const expected = Number.parseInt(readTarString(header, 148, 8).trim() || '0', 8)
  const copy = Buffer.from(header)
  copy.fill(0x20, 148, 156)
  const actual = copy.reduce((sum, byte) => sum + byte, 0)
  if (expected !== actual) throw new Error('迁移备份头校验失败')
}

function safeStagingPath(root: string, archivePath: string) {
  const normalized = archivePath.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) throw new Error('迁移备份包含不安全路径')
  const destination = resolve(root, normalized)
  if (!destination.startsWith(`${root}${sep}`)) throw new Error('迁移备份路径越界')
  return destination
}

async function extractArchive(filePath: string, staging: string) {
  const gunzip = createGunzip()
  createReadStream(filePath).pipe(gunzip)
  const reader = new StreamReader(gunzip)
  let manifestBytes: Buffer | null = null
  while (true) {
    const header = await reader.readExact(512)
    if (header.every((byte) => byte === 0)) break
    validateTarHeader(header)
    const name = readTarString(header, 0, 100)
    const prefix = readTarString(header, 345, 155)
    const archivePath = prefix ? `${prefix}/${name}` : name
    const size = Number.parseInt(readTarString(header, 124, 12).trim() || '0', 8)
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('迁移备份包含无效文件大小')
    if (archivePath === 'manifest.json') manifestBytes = await reader.pipeExact(size, null, 50 * 1024 * 1024)
    else {
      if (!archivePath.startsWith('storage/') && !archivePath.startsWith('site-releases/') && !archivePath.startsWith('brand-assets/')) throw new Error(`迁移备份包含未知路径：${archivePath}`)
      const destination = safeStagingPath(staging, archivePath)
      mkdirSync(dirname(destination), { recursive: true })
      const output = createWriteStream(destination, { flags: 'wx' })
      await reader.pipeExact(size, output)
      output.end()
      await finished(output)
    }
    const padding = (512 - (size % 512)) % 512
    if (padding) await reader.readExact(padding)
  }
  if (!manifestBytes) throw new Error('迁移备份缺少 manifest.json')
  const manifest = JSON.parse(manifestBytes.toString('utf8')) as MigrationManifest
  if (!['jtwz-portable-backup', 'aurelia-portable-backup'].includes(manifest.format) || ![2, 3].includes(manifest.version) || !manifest.tables || !manifest.files) throw new Error('不支持的迁移备份格式')
  if (manifest.version >= 3 && (!/^[a-f0-9]{64}$/i.test(manifest.contentSha256 || '') || manifestIntegrity(manifest) !== manifest.contentSha256)) throw new Error('迁移备份清单完整性校验失败')
  return manifest
}

async function sha256File(filePath: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function installFiles(manifest: MigrationManifest, staging: string) {
  for (const entry of manifest.files.siteReleases) {
    const source = safeStagingPath(staging, entry.archivePath)
    if (!existsSync(source) || statSync(source).size !== entry.byteSize) throw new Error(`静态网站文件缺失：${entry.archivePath}`)
    if (entry.sha256 && await sha256File(source) !== entry.sha256.toLowerCase()) throw new Error(`静态网站文件校验失败：${entry.archivePath}`)
    const relativePath = entry.archivePath.slice('site-releases/'.length)
    const destination = resolve(config.siteReleasesDir, relativePath)
    if (!destination.startsWith(`${config.siteReleasesDir}${sep}`)) throw new Error('静态网站恢复路径越界')
    mkdirSync(dirname(destination), { recursive: true })
    await copyFile(source, destination)
  }
  for (const entry of manifest.files.brandAssets || []) {
    const source = safeStagingPath(staging, entry.archivePath)
    if (!existsSync(source) || statSync(source).size !== entry.byteSize) throw new Error(`品牌资源文件缺失：${entry.archivePath}`)
    if (entry.sha256 && await sha256File(source) !== entry.sha256.toLowerCase()) throw new Error(`品牌资源文件校验失败：${entry.archivePath}`)
    const relativePath = entry.archivePath.slice('brand-assets/'.length)
    const destination = resolve(config.brandAssetsDir, relativePath)
    if (!destination.startsWith(`${config.brandAssetsDir}${sep}`)) throw new Error('品牌资源恢复路径越界')
    mkdirSync(dirname(destination), { recursive: true })
    await copyFile(source, destination)
  }
  for (const entry of manifest.files.objects) {
    const source = safeStagingPath(staging, entry.archivePath)
    if (!existsSync(source) || statSync(source).size !== entry.byteSize) throw new Error(`安装包文件缺失：${entry.archivePath}`)
    if (entry.sha256 && /^[a-f0-9]{64}$/i.test(entry.sha256) && await sha256File(source) !== entry.sha256.toLowerCase()) throw new Error(`安装包校验失败：${entry.objectKey}`)
    if (objectStorageMode === 's3') {
      if (!isStorageConfigured()) throw new Error('当前对象存储未配置，无法恢复安装包')
      const upload = createStorageUpload(entry.objectKey!, 'application/octet-stream', entry.sha256 || '')
      const response = await fetch(upload.url, { method: 'PUT', headers: upload.headers, body: createReadStream(source), duplex: 'half' } as unknown as RequestInit)
      if (!response.ok) throw new Error(`安装包恢复到对象存储失败：${entry.objectKey}（${response.status}）`)
    } else {
      const destination = resolve(config.storageDir, entry.objectKey!)
      if (!destination.startsWith(`${config.storageDir}${sep}`)) throw new Error('安装包恢复路径越界')
      mkdirSync(dirname(destination), { recursive: true })
      await copyFile(source, destination)
    }
  }
}

function restoreDatabase(manifest: MigrationManifest) {
  db.exec('BEGIN IMMEDIATE')
  try {
    const restoresAdmins = Array.isArray(manifest.tables.admins) && manifest.tables.admins.length > 0
    for (const table of restoreDeleteOrder) {
      if ((table === 'sessions' || table === 'admins') && !restoresAdmins) continue
      db.prepare(`DELETE FROM ${table}`).run()
    }
    db.prepare('DELETE FROM settings').run()
    for (const table of restoreInsertOrder) {
      const availableColumns = new Set((db.prepare(`PRAGMA table_info(${table})`).all() as Row[]).map((column) => String(column.name)))
      const rows = Array.isArray(manifest.tables[table]) ? manifest.tables[table] as Row[] : []
      for (const original of rows) {
        const row = { ...original }
        if (table === 'site_versions' && row.site_id && row.id) row.release_path = resolve(config.siteReleasesDir, String(row.site_id), String(row.id))
        const columns = Object.keys(row).filter((column) => availableColumns.has(column))
        if (!columns.length) continue
        const placeholders = columns.map(() => '?').join(', ')
        db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...columns.map((column) => {
          const value = row[column]
          return value == null || ['string', 'number', 'bigint'].includes(typeof value) || value instanceof Uint8Array ? value as string | number | bigint | Uint8Array | null : String(value)
        }))
      }
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

async function restoreConfiguration(manifest: MigrationManifest) {
  if (manifest.version < 3 || !manifest.configuration?.environment) return null
  const allowed = new Set<string>(migrationEnvironmentKeys)
  const restored = Object.fromEntries(Object.entries(manifest.configuration.environment)
    .filter(([key]) => allowed.has(key))
    .map(([key, value]) => [key, String(value).replace(/\r?\n/g, '\\n')]))
  restored.ADMIN_BASE_PATH = normalizeAdminBasePath(String(restored.ADMIN_BASE_PATH || manifest.configuration.adminBasePath || '/admin'))
  const currentLines = existsSync(config.envPath) ? readFileSync(config.envPath, 'utf8').split(/\r?\n/) : []
  const written = new Set<string>()
  const nextLines = currentLines.filter((line, index) => line || index < currentLines.length - 1).map((line) => {
    const separator = line.indexOf('=')
    if (separator < 1) return line
    const key = line.slice(0, separator).trim()
    if (!(key in restored)) return line
    written.add(key)
    return `${key}=${restored[key]}`
  })
  for (const [key, value] of Object.entries(restored)) if (!written.has(key)) nextLines.push(`${key}=${value}`)
  const temporary = `${config.envPath}.restore-${Date.now()}.tmp`
  mkdirSync(dirname(config.envPath), { recursive: true })
  writeFileSync(temporary, `${nextLines.join('\n').replace(/\n+$/, '')}\n`, { encoding: 'utf8', mode: 0o600 })
  await rename(temporary, config.envPath)
  return restored.ADMIN_BASE_PATH
}

export async function restoreBackup(filePath: string) {
  const staging = resolve(config.tempDir, `restore-${Date.now()}`)
  if (!staging.startsWith(`${config.tempDir}${sep}`)) throw new Error('恢复临时目录无效')
  mkdirSync(staging, { recursive: true })
  try {
    const manifest = await extractArchive(filePath, staging)
    await installFiles(manifest, staging)
    restoreDatabase(manifest)
    const adminBasePath = await restoreConfiguration(manifest)
    return {
      importedAt: new Date().toISOString(), sourceExportedAt: manifest.exportedAt,
      files: manifest.files.siteReleases.length + (manifest.files.brandAssets?.length || 0) + manifest.files.objects.length,
      formatVersion: manifest.version, adminBasePath, restartRequired: Boolean(adminBasePath),
    }
  } finally {
    rmSync(staging, { recursive: true, force: true })
  }
}

export async function restoreBackupWithRollback(filePath: string) {
  const rollbackBackup = await createBackup()
  try {
    const restored = await restoreBackup(filePath)
    return { restored, rollbackBackup, rolledBack: false }
  } catch (error) {
    try {
      await restoreBackup(backupFilePath(rollbackBackup.fileName))
    } catch (rollbackError) {
      throw new Error(`迁移恢复失败，自动回滚也失败：${error instanceof Error ? error.message : String(error)}；回滚错误：${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`)
    }
    throw new Error(`迁移恢复失败，已自动恢复原网站：${error instanceof Error ? error.message : String(error)}`)
  }
}

export function listBackups() {
  return readdirSync(config.backupDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && (/^jtwz-[\w.-]+\.jtwz-backup$/.test(entry.name) || /^platform-[\w.-]+\.aurelia-backup$/.test(entry.name)))
    .map((entry) => {
      const fileName = basename(entry.name)
      const filePath = resolve(config.backupDir, fileName)
      return { fileName, byteSize: statSync(filePath).size, createdAt: statSync(filePath).mtime.toISOString() }
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

export function backupFilePath(fileName: string) {
  const safeName = basename(fileName)
  if (safeName !== fileName || (!/^jtwz-[\w.-]+\.jtwz-backup$/.test(safeName) && !/^platform-[\w.-]+\.aurelia-backup$/.test(safeName))) throw new Error('备份文件名无效')
  const filePath = resolve(config.backupDir, safeName)
  if (!filePath.startsWith(`${config.backupDir}${sep}`) || !existsSync(filePath)) throw new Error('备份文件不存在')
  return filePath
}

function pruneBackups() {
  const cutoff = Date.now() - config.backupRetentionDays * 24 * 60 * 60 * 1000
  for (const backup of listBackups()) {
    if (new Date(backup.createdAt).getTime() < cutoff) rmSync(resolve(config.backupDir, backup.fileName), { force: true })
  }
}

export function startBackupScheduler() {
  if (!Number.isFinite(config.backupIntervalHours) || config.backupIntervalHours <= 0) return
  const timer = setInterval(() => {
    void createBackup().catch((error) => console.error('[BACKUP] 自动备份失败', error))
  }, config.backupIntervalHours * 60 * 60 * 1000)
  timer.unref()
}
