import { useCallback, useEffect, useState } from 'react'
import { Route, Routes } from 'react-router-dom'
import { defaultSettings } from './data'
import { apiRequest } from './lib/api'
import { DownloadCenterPage } from './pages/DownloadCenterPage'
import { LandingPage } from './pages/LandingPage'
import { NotFoundPage } from './pages/NotFoundPage'
import { SoftwareDetailPage } from './pages/SoftwareDetailPage'
import { PublicStatePage } from './components/PublicState'
import type { AnnouncementRecord, BrandSettings, SoftwareRecord } from './types'

export default function PublicApp() {
  const [settings, setSettings] = useState(defaultSettings)
  const [software, setSoftware] = useState<SoftwareRecord[]>([])
  const [announcements, setAnnouncements] = useState<AnnouncementRecord[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const loadPublicData = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    const [settingsResult, softwareResult, announcementResult] = await Promise.allSettled([
      apiRequest<{ settings: BrandSettings }>('/api/public/settings'),
      apiRequest<{ software: SoftwareRecord[] }>('/api/public/software'),
      apiRequest<{ announcements: AnnouncementRecord[] }>('/api/public/announcements'),
    ])
    if (settingsResult.status === 'fulfilled') setSettings(settingsResult.value.settings)
    if (softwareResult.status === 'fulfilled') setSoftware(softwareResult.value.software)
    if (announcementResult.status === 'fulfilled') setAnnouncements(announcementResult.value.announcements)
    const failures = [settingsResult, softwareResult, announcementResult].filter((result) => result.status === 'rejected').length
    if (failures) setLoadError(failures === 3 ? '公开服务暂时无法连接。' : '部分公开内容未能加载，当前显示已成功读取的数据。')
    setLoading(false)
  }, [])

  useEffect(() => { void loadPublicData() }, [loadPublicData])

  if (loading) return <PublicStatePage settings={settings} mode="loading" />
  if (settings.publicMaintenance) return <PublicStatePage settings={settings} mode="maintenance" />
  if (loadError && !software.length && !announcements.length) return <PublicStatePage settings={settings} mode="error" onRetry={() => void loadPublicData()} />

  return (
    <Routes>
      <Route path="/" element={<LandingPage settings={settings} software={software} announcements={announcements} notice={loadError} onRetry={() => void loadPublicData()} />} />
      <Route path="/downloads" element={<DownloadCenterPage settings={settings} software={software} announcements={announcements} notice={loadError} onRetry={() => void loadPublicData()} />} />
      <Route path="/downloads/:slug" element={<SoftwareDetailPage settings={settings} />} />
      <Route path="*" element={<NotFoundPage settings={settings} />} />
    </Routes>
  )
}
