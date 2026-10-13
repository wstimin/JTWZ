export type Theme = 'light' | 'dark'

export type DomainMode = 'redirect' | 'site' | 'download' | 'maintenance'
export type DomainStatus = 'active' | 'pending' | 'paused' | 'error'

export interface DomainRecord {
  id: string
  hostname: string
  mode: DomainMode
  target: string
  status: DomainStatus
  redirectCode: 301 | 302
  preservePath: boolean
  preserveQuery: boolean
  forceHttps?: boolean
  verificationToken?: string
  dnsStatus?: 'unverified' | 'verified' | 'error'
  certificateStatus?: 'pending' | 'active' | 'error'
  lastVerifiedAt?: string
  visits: number
  updatedAt: string
}

export interface CertificateRecord {
  id: string
  domainId: string
  hostname: string
  provider: string
  issuer: string
  serialNumber: string
  externalRef: string
  issuedAt?: string
  expiresAt?: string
  expiresInDays?: number
  status: 'pending' | 'active' | 'expiring' | 'expired' | 'error' | 'revoked'
  autoRenew: boolean
  note: string
  lastError: string
  updatedAt: string
  createdAt: string
}

export interface OperationTaskRecord {
  id: string
  kind: string
  label: string
  entityType: string
  entityId: string
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  progress: number
  message: string
  input: Record<string, unknown>
  result: Record<string, unknown>
  error: string
  logs: Array<{ at: string; level: 'info' | 'success' | 'error'; message: string }>
  retryable: boolean
  retryOf: string
  createdAt: string
  startedAt?: string
  finishedAt?: string
  updatedAt: string
}

export interface RedirectRuleRecord {
  id: string
  domainId: string
  hostname: string
  name: string
  notes: string
  sourcePath: string
  target: string
  redirectCode: 301 | 302
  preservePath: boolean
  preserveQuery: boolean
  enabled: boolean
  priority: number
  startsAt?: string
  expiresAt?: string
  hits: number
  updatedAt: string
}

export interface SiteRecord {
  id: string
  name: string
  path: string
  domain: string
  status: 'published' | 'draft' | 'offline'
  visits: number
  updatedAt: string
  category: string
  currentVersionId?: string
}

export interface SoftwareRecord {
  id: string
  name: string
  slug: string
  description: string
  version: string
  platform: string
  architecture: string
  size: string
  downloads: number
  status: 'published' | 'draft' | 'testing'
  updatedAt: string
  accent: string
  downloadUrl?: string
}

export interface PackageRecord {
  id: string
  fileName: string
  software: string
  softwareId?: string
  versionId?: string
  version: string
  platform: string
  size: string
  storage: string
  byteSize?: number
  sha256?: string
  downloadUrl?: string
  downloads: number
  status: 'available' | 'paused' | 'processing'
  releaseNotes?: string
  createdAt?: string
}

export interface SoftwareVersionRecord {
  id: string
  softwareId: string
  software: string
  version: string
  channel: 'stable' | 'beta' | 'alpha'
  releaseNotes: string
  status: 'draft' | 'published' | 'archived'
  isRecommended: boolean
  packageCount: number
  downloads: number
  platforms: string[]
  publishedAt?: string
  updatedAt: string
  createdAt: string
}

export interface AnnouncementRecord {
  id: string
  title: string
  body: string
  status: 'published' | 'draft'
  pinned: boolean
  publishedAt?: string
  updatedAt: string
  createdAt: string
}

export interface BrandSettings {
  name: string
  tagline: string
  supportEmail: string
  footerText: string
  logoUrl?: string
  defaultRedirectCode?: 301 | 302
  autoHttps?: boolean
  trafficAlerts?: boolean
  publicMaintenance?: boolean
  maintenanceMessage?: string
}

export interface AdminUser {
  id: string
  username: string
  displayName: string
  role: 'owner' | 'admin' | 'editor' | 'analyst'
  permissions: Array<'system.manage' | 'admins.manage' | 'content.manage' | 'content.read' | 'analytics.read' | 'audit.read' | 'tasks.manage'>
  twoFactorEnabled: boolean
}

export interface SiteVersionRecord {
  id: string
  sourceName: string
  fileCount: number
  byteSize: number
  sha256: string
  createdAt: string
}

export interface AuditLogRecord {
  action: string
  entityType: string
  entityId: string
  detail: string
  adminName?: string
  requestId?: string
  ipAddress?: string
  createdAt: string
}

export interface AnalyticsData {
  summary: {
    totalVisits: number
    redirects: number
    downloads: number
    conversionRate: number
    periodEvents: number
  }
  trend: Array<{ date: string; visits: number; conversions: number }>
  devices: { desktop: number; mobile: number }
  topDomains: Array<{ id: string; hostname: string; visits: number }>
  topSoftware: Array<{ id: string; name: string; downloads: number }>
}

export interface StorageStatus {
  provider: 'local' | 's3'
  directUpload: boolean
  configured: boolean
}

export interface PlatformAlert {
  id: string
  severity: 'warning' | 'error'
  title: string
  detail: string
  createdAt: string
}

export interface PlatformIntegrations {
  storage: StorageStatus
  dns: { provider: 'manual' | 'cloudflare' | 'webhook'; configured: boolean }
  certificate: { provider: 'manual' | 'cloudflare' | 'webhook'; configured: boolean }
  notifications: { configured: boolean }
}

export interface SystemHealth {
  overall: 'ok' | 'degraded'
  checkedAt: string
  checks: Array<{
    id: string
    label: string
    status: 'ok' | 'warning' | 'error'
    detail: string
  }>
}

export interface SystemUpdateStatus {
  configured: boolean
  configurationError?: string
  currentVersion: string
  latestVersion?: string
  updateAvailable: boolean
  applyConfigured: boolean
  signatureConfigured?: boolean
  signatureVerified?: boolean
  checkedAt?: string
  manifest?: {
    version: string
    publishedAt?: string
    notes?: string
  }
  state?: Record<string, unknown> | null
}
