import { useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { defaultSettings, defaultSoftware } from './data'
import { usePersistentState } from './hooks/usePersistentState'
import { apiRequest } from './lib/api'
import { DownloadCenterPage } from './pages/DownloadCenterPage'
import { LandingPage } from './pages/LandingPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SoftwareDetailPage } from './pages/SoftwareDetailPage'
import type { AnnouncementRecord, BrandSettings, SoftwareRecord } from './types'

export default function PublicApp() {
  const [settings, setSettings] = usePersistentState('jtwz-settings', defaultSettings)
  const [software, setSoftware] = usePersistentState('jtwz-software', defaultSoftware)
  const [announcements, setAnnouncements] = useState<AnnouncementRecord[]>([])

  useEffect(() => {
    void Promise.all([
      apiRequest<{ settings: BrandSettings }>('/api/public/settings').then((result) => setSettings(result.settings)),
      apiRequest<{ software: SoftwareRecord[] }>('/api/public/software').then((result) => setSoftware(result.software)),
      apiRequest<{ announcements: AnnouncementRecord[] }>('/api/public/announcements').then((result) => setAnnouncements(result.announcements)),
    ]).catch(() => undefined)
  }, [setSettings, setSoftware])

  return (
    <Routes>
      <Route path="/" element={<LandingPage settings={settings} software={software} announcements={announcements} />} />
      <Route path="/downloads" element={<DownloadCenterPage settings={settings} software={software} />} />
      <Route path="/downloads/:slug" element={<SoftwareDetailPage settings={settings} />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  )
}
