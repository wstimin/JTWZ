import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function loadEnvFile() {
  const envPath = resolve(process.cwd(), '.env')
  if (!existsSync(envPath)) return

  for (const rawLine of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const separator = line.indexOf('=')
    if (separator < 1) continue
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
    if (process.env[key] === undefined) process.env[key] = value
  }
}

loadEnvFile()

const rootDir = resolve(process.cwd())
const dataDir = resolve(rootDir, 'data')
mkdirSync(dataDir, { recursive: true })

const isProduction = process.env.NODE_ENV === 'production'
const configuredPassword = process.env.ADMIN_PASSWORD
const configuredSecret = process.env.APP_SECRET
const storageProvider = (process.env.STORAGE_PROVIDER || 'local').toLowerCase()
const packageMetadata = JSON.parse(readFileSync(resolve(rootDir, 'package.json'), 'utf8')) as { version?: string }
const allowLocalStorageInProduction = ['1', 'true', 'yes'].includes(String(process.env.ALLOW_LOCAL_STORAGE_IN_PRODUCTION || '').toLowerCase())
const allowedOrigins = [
  process.env.APP_ORIGIN,
  process.env.PUBLIC_APP_ORIGIN || 'http://127.0.0.1:4173',
  process.env.ADMIN_APP_ORIGIN || 'http://127.0.0.1:4174',
]
  .flatMap((value) => String(value || '').split(','))
  .map((value) => value.trim().replace(/\/$/, ''))
  .filter((value, index, values) => Boolean(value) && values.indexOf(value) === index)

if (isProduction && (!configuredPassword || !configuredSecret)) {
  throw new Error('生产环境必须设置 ADMIN_PASSWORD 和 APP_SECRET，服务已拒绝启动。')
}
if (isProduction && storageProvider === 'local' && !allowLocalStorageInProduction) {
  throw new Error('生产环境禁止使用本地安装包存储。请配置 STORAGE_PROVIDER=s3；仅受控测试环境可显式设置 ALLOW_LOCAL_STORAGE_IN_PRODUCTION=true。')
}

export const config = {
  rootDir,
  dataDir,
  distDir: resolve(rootDir, 'dist'),
  publicDistDir: resolve(rootDir, 'dist', 'public'),
  adminDistDir: resolve(rootDir, 'dist', 'admin'),
  dbPath: resolve(dataDir, 'platform.db'),
  storageDir: resolve(dataDir, 'storage'),
  siteReleasesDir: resolve(dataDir, 'site-releases'),
  tempDir: resolve(dataDir, 'temp'),
  backupDir: resolve(dataDir, 'backups'),
  brandAssetsDir: resolve(dataDir, 'brand-assets'),
  host: process.env.API_HOST || '127.0.0.1',
  port: Number(process.env.API_PORT || 8787),
  appOrigin: process.env.APP_ORIGIN || 'http://127.0.0.1:4173',
  allowedOrigins,
  appHost: process.env.APP_HOST || '127.0.0.1',
  adminUsername: process.env.ADMIN_USERNAME || 'admin',
  adminPassword: configuredPassword || 'local-development-password',
  appSecret: configuredSecret || 'aurelia-development-secret-change-before-production',
  storageProvider,
  allowLocalStorageInProduction,
  dnsProvider: (process.env.DNS_PROVIDER || 'manual').toLowerCase(),
  certificateProvider: (process.env.CERTIFICATE_PROVIDER || 'manual').toLowerCase(),
  cloudflareApiToken: process.env.CLOUDFLARE_API_TOKEN || '',
  cloudflareApiBase: (process.env.CLOUDFLARE_API_BASE || 'https://api.cloudflare.com/client/v4').replace(/\/$/, ''),
  dnsWebhookUrl: process.env.DNS_WEBHOOK_URL || '',
  dnsWebhookSecret: process.env.DNS_WEBHOOK_SECRET || '',
  s3Endpoint: process.env.S3_ENDPOINT || '',
  s3Region: process.env.S3_REGION || 'auto',
  s3Bucket: process.env.S3_BUCKET || '',
  s3AccessKey: process.env.S3_ACCESS_KEY || '',
  s3SecretKey: process.env.S3_SECRET_KEY || '',
  s3PublicBaseUrl: (process.env.S3_PUBLIC_BASE_URL || '').replace(/\/$/, ''),
  storageUrlTtl: Math.min(3600, Math.max(60, Number(process.env.STORAGE_URL_TTL || 900))),
  maxPackageBytes: Math.max(1024 * 1024, Number(process.env.MAX_PACKAGE_BYTES || 2 * 1024 * 1024 * 1024)),
  maxSiteZipBytes: Math.max(1024 * 1024, Number(process.env.MAX_SITE_ZIP_BYTES || 50 * 1024 * 1024)),
  maxBackupBytes: Math.max(20 * 1024 * 1024, Number(process.env.MAX_BACKUP_BYTES || 20 * 1024 * 1024 * 1024)),
  maxUpdateBytes: Math.max(20 * 1024 * 1024, Number(process.env.MAX_UPDATE_BYTES || 2 * 1024 * 1024 * 1024)),
  sessionDays: Math.max(1, Number(process.env.SESSION_DAYS || 7)),
  backupIntervalHours: Math.max(0, Number(process.env.BACKUP_INTERVAL_HOURS || 24)),
  backupRetentionDays: Math.max(1, Number(process.env.BACKUP_RETENTION_DAYS || 30)),
  backupRemote: ['1', 'true', 'yes'].includes(String(process.env.BACKUP_REMOTE || '').toLowerCase()),
  alertWebhookUrl: process.env.ALERT_WEBHOOK_URL || '',
  alertWebhookSecret: process.env.ALERT_WEBHOOK_SECRET || '',
  certificateCallbackSecret: process.env.CERTIFICATE_CALLBACK_SECRET || configuredSecret || 'aurelia-development-secret-change-before-production',
  systemVersion: String(packageMetadata.version || '0.0.0'),
  updateManifestUrl: process.env.UPDATE_MANIFEST_URL || '',
  updateApplyCommand: process.env.UPDATE_APPLY_COMMAND || '',
  updateApplyArgsJson: process.env.UPDATE_APPLY_ARGS_JSON || '[]',
  isProduction,
  cookieName: 'aurelia_session',
}

