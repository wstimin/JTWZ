import { useEffect, useState } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AdminShell } from './components/AdminShell'
import { ProtectedRoute } from './components/ProtectedRoute'
import { useAuth } from './contexts/AuthContext'
import { defaultDomains, defaultPackages, defaultSettings, defaultSites, defaultSoftware } from './data'
import { usePersistentState } from './hooks/usePersistentState'
import { apiRequest } from './lib/api'
import { LoginPage } from './pages/LoginPage'
import { AnalyticsPage } from './pages/admin/AnalyticsPage'
import { AnnouncementsPage } from './pages/admin/AnnouncementsPage'
import { AuditLogsPage } from './pages/admin/AuditLogsPage'
import { DashboardPage } from './pages/admin/DashboardPage'
import { DomainsPage } from './pages/admin/DomainsPage'
import { PackagesPage } from './pages/admin/PackagesPage'
import { RedirectsPage } from './pages/admin/RedirectsPage'
import { SettingsPage } from './pages/admin/SettingsPage'
import { SitesPage } from './pages/admin/SitesPage'
import { SoftwarePage } from './pages/admin/SoftwarePage'
import { VersionsPage } from './pages/admin/VersionsPage'
import type { AnalyticsData, AuditLogRecord, BrandSettings, DomainRecord, PackageRecord, PlatformAlert, PlatformIntegrations, RedirectRuleRecord, SiteRecord, SoftwareRecord, StorageStatus } from './types'

export default function AdminApp() {
  const { admin } = useAuth()
  const [settings, setSettings] = usePersistentState('jtwz-settings', defaultSettings)
  const [domains, setDomains] = usePersistentState('jtwz-domains', defaultDomains)
  const [sites, setSites] = usePersistentState('jtwz-sites', defaultSites)
  const [software, setSoftware] = usePersistentState('jtwz-software', defaultSoftware)
  const [packages, setPackages] = usePersistentState('jtwz-packages', defaultPackages)
  const [redirectRules, setRedirectRules] = useState<RedirectRuleRecord[]>([])
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null)
  const [audits, setAudits] = useState<AuditLogRecord[]>([])
  const [storage, setStorage] = useState<StorageStatus>({ provider: 'local', directUpload: true, configured: true })
  const [alerts, setAlerts] = useState<PlatformAlert[]>([])
  const [integrations, setIntegrations] = useState<PlatformIntegrations>({ storage, dns: { provider: 'manual', configured: false }, certificate: { provider: 'manual', configured: false }, notifications: { configured: false } })

  useEffect(() => {
    void apiRequest<{ settings: BrandSettings }>('/api/public/settings')
      .then((result) => setSettings(result.settings))
      .catch(() => undefined)
  }, [setSettings])

  useEffect(() => {
    if (!admin) return
    void apiRequest<{
      settings: BrandSettings
      domains: DomainRecord[]
      sites: SiteRecord[]
      software: SoftwareRecord[]
      packages: PackageRecord[]
      redirectRules: RedirectRuleRecord[]
      analytics: AnalyticsData
      audits: AuditLogRecord[]
      storage: StorageStatus
      alerts: PlatformAlert[]
      dns: PlatformIntegrations['dns']
      certificate: PlatformIntegrations['certificate']
      notifications: PlatformIntegrations['notifications']
    }>('/api/admin/bootstrap').then((result) => {
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
    }).catch(() => undefined)
  }, [admin, setDomains, setPackages, setSettings, setSites, setSoftware])

  return (
    <Routes>
      <Route path="/" element={<Navigate to="/admin" replace />} />
      <Route path="/admin/login" element={<LoginPage settings={settings} />} />
      <Route path="/admin" element={<ProtectedRoute><AdminShell settings={settings} /></ProtectedRoute>}>
        <Route index element={<DashboardPage domains={domains} sites={sites} software={software} analytics={analytics} setAnalytics={setAnalytics} audits={audits} alerts={alerts} />} />
        <Route path="domains" element={<DomainsPage domains={domains} setDomains={setDomains} sites={sites} />} />
        <Route path="redirects" element={<RedirectsPage domains={domains} rules={redirectRules} setRules={setRedirectRules} />} />
        <Route path="sites" element={<SitesPage sites={sites} setSites={setSites} />} />
        <Route path="software" element={<SoftwarePage software={software} setSoftware={setSoftware} />} />
        <Route path="versions" element={<VersionsPage software={software} />} />
        <Route path="packages" element={<PackagesPage packages={packages} setPackages={setPackages} software={software} setSoftware={setSoftware} storage={storage} />} />
        <Route path="announcements" element={<AnnouncementsPage />} />
        <Route path="analytics" element={<AnalyticsPage domains={domains} software={software} analytics={analytics} setAnalytics={setAnalytics} />} />
        <Route path="audit-logs" element={<AuditLogsPage />} />
        <Route path="settings" element={<SettingsPage settings={settings} setSettings={setSettings} integrations={integrations} />} />
      </Route>
      <Route path="*" element={<Navigate to="/admin" replace />} />
    </Routes>
  )
}
