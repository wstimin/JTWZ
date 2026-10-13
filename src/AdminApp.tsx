import { useCallback, useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminShell } from './components/AdminShell'
import { ProtectedRoute } from './components/ProtectedRoute'
import { PermissionRoute } from './components/PermissionRoute'
import { useAuth } from './contexts/AuthContext'
import { defaultSettings } from './data'
import { apiRequest } from './lib/api'
import { LoginPage } from './pages/LoginPage'
import { AnalyticsPage } from './pages/admin/AnalyticsPage'
import { AnnouncementsPage } from './pages/admin/AnnouncementsPage'
import { AuditLogsPage } from './pages/admin/AuditLogsPage'
import { DashboardPage } from './pages/admin/DashboardPage'
import { DomainsPage } from './pages/admin/DomainsPage'
import { RedirectsPage } from './pages/admin/RedirectsPage'
import { SettingsPage } from './pages/admin/SettingsPage'
import { SitesPage } from './pages/admin/SitesPage'
import { SoftwarePage } from './pages/admin/SoftwarePage'
import { TasksPage } from './pages/admin/TasksPage'
import { SecurityPage } from './pages/admin/SecurityPage'
import type { AnalyticsData, AuditLogRecord, BrandSettings, DomainRecord, PackageRecord, PlatformAlert, PlatformIntegrations, RedirectRuleRecord, SiteRecord, SoftwareRecord, StorageStatus } from './types'

export default function AdminApp() {
  const { admin } = useAuth()
  const [settings, setSettings] = useState(defaultSettings)
  const [domains, setDomains] = useState<DomainRecord[]>([])
  const [sites, setSites] = useState<SiteRecord[]>([])
  const [software, setSoftware] = useState<SoftwareRecord[]>([])
  const [packages, setPackages] = useState<PackageRecord[]>([])
  const [redirectRules, setRedirectRules] = useState<RedirectRuleRecord[]>([])
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [audits, setAudits] = useState<AuditLogRecord[]>([])
  const [storage, setStorage] = useState<StorageStatus>({ provider: 'local', directUpload: true, configured: true })
  const [alerts, setAlerts] = useState<PlatformAlert[]>([])
  const [integrations, setIntegrations] = useState<PlatformIntegrations>({ storage, dns: { provider: 'manual', configured: false }, certificate: { provider: 'manual', configured: false }, notifications: { configured: false } })
  const [bootstrapStatus, setBootstrapStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle')
  const [bootstrapError, setBootstrapError] = useState('')

  useEffect(() => {
    void apiRequest<{ settings: BrandSettings }>('/api/public/settings')
      .then((result) => setSettings(result.settings))
      .catch(() => undefined)
  }, [])

  const loadAdminData = useCallback(async () => {
    if (!admin) return
    setBootstrapStatus('loading')
    setBootstrapError('')
    try {
      const result = await apiRequest<{
      settings: BrandSettings
      domains: DomainRecord[]
      sites: SiteRecord[]
      software: SoftwareRecord[]
      packages: PackageRecord[]
      redirectRules: RedirectRuleRecord[]
      analytics: AnalyticsData | null
      audits: AuditLogRecord[]
      storage: StorageStatus
      alerts: PlatformAlert[]
      dns: PlatformIntegrations['dns']
      certificate: PlatformIntegrations['certificate']
      notifications: PlatformIntegrations['notifications']
      }>('/api/admin/bootstrap')
      setSettings(result.settings)
      setDomains(result.domains)
      setSites(result.sites)
      setSoftware(result.software)
      setPackages(result.packages)
      setRedirectRules(result.redirectRules)
      setAnalytics(result.analytics)
      setAudits(result.audits)
      setStorage(result.storage)
      setAlerts(result.alerts)
      setIntegrations({ storage: result.storage, dns: result.dns, certificate: result.certificate, notifications: result.notifications })
      setBootstrapStatus('ready')
    } catch (reason) {
      setBootstrapStatus('error')
      setBootstrapError(reason instanceof Error ? reason.message : '管理数据加载失败')
    }
  }, [admin])

  useEffect(() => { if (admin) void loadAdminData() }, [admin, loadAdminData])

  return (
    <Routes>
      <Route path="/login" element={<LoginPage settings={settings} />} />
      <Route path="/" element={<ProtectedRoute><AdminShell settings={settings} bootstrapStatus={bootstrapStatus} bootstrapError={bootstrapError} onRetry={() => void loadAdminData()} /></ProtectedRoute>}>
        <Route index element={<DashboardPage domains={domains} sites={sites} software={software} analytics={analytics} setAnalytics={setAnalytics} audits={audits} alerts={alerts} />} />
        <Route path="domains" element={<DomainsPage domains={domains} setDomains={setDomains} sites={sites} />} />
        <Route path="redirects" element={<RedirectsPage domains={domains} rules={redirectRules} setRules={setRedirectRules} />} />
        <Route path="sites" element={<SitesPage sites={sites} setSites={setSites} domains={domains} />} />
        <Route path="software" element={<SoftwarePage software={software} setSoftware={setSoftware} packages={packages} setPackages={setPackages} storage={storage} />} />
        <Route path="software/:softwareId" element={<SoftwarePage software={software} setSoftware={setSoftware} packages={packages} setPackages={setPackages} storage={storage} />} />
        <Route path="versions" element={<Navigate to="/software" replace />} />
        <Route path="packages" element={<Navigate to="/software" replace />} />
        <Route path="announcements" element={<AnnouncementsPage />} />
        <Route path="analytics" element={<PermissionRoute permission="analytics.read"><AnalyticsPage domains={domains} software={software} analytics={analytics} setAnalytics={setAnalytics} /></PermissionRoute>} />
        <Route path="audit-logs" element={<PermissionRoute permission="audit.read"><AuditLogsPage /></PermissionRoute>} />
        <Route path="tasks" element={<PermissionRoute permission="tasks.manage"><TasksPage /></PermissionRoute>} />
        <Route path="security" element={<SecurityPage />} />
        <Route path="settings" element={<PermissionRoute permission="system.manage"><SettingsPage settings={settings} setSettings={setSettings} integrations={integrations} /></PermissionRoute>} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
