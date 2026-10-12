import { BarChart3, Download, Globe2, Monitor, Smartphone, Waypoints } from 'lucide-react'
import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { MetricChart } from '../../components/MetricChart'
import type { AnalyticsData, DomainRecord, SoftwareRecord } from '../../types'
import { apiRequest } from '../../lib/api'

export function AnalyticsPage({ domains, software, analytics, setAnalytics }: { domains: DomainRecord[]; software: SoftwareRecord[]; analytics: AnalyticsData | null; setAnalytics: Dispatch<SetStateAction<AnalyticsData | null>> }) {
  const [days, setDays] = useState(30)
  const [loading, setLoading] = useState(false)
  const totalVisits = analytics?.summary.totalVisits ?? domains.reduce((sum, item) => sum + item.visits, 0)
  const totalDownloads = analytics?.summary.downloads ?? software.reduce((sum, item) => sum + item.downloads, 0)
  const trend = analytics?.trend ?? []
  const topDomains = analytics?.topDomains ?? [...domains].sort((a, b) => b.visits - a.visits).slice(0, 5)
  const topSoftware = analytics?.topSoftware ?? [...software].sort((a, b) => b.downloads - a.downloads).slice(0, 5)
  const deviceTotal = (analytics?.devices.desktop ?? 0) + (analytics?.devices.mobile ?? 0)
  const desktopPercent = deviceTotal ? Math.round(((analytics?.devices.desktop ?? 0) / deviceTotal) * 100) : 0

  async function changeDays(nextDays: number) {
    setDays(nextDays)
    setLoading(true)
    try {
      const result = await apiRequest<{ analytics: AnalyticsData }>(`/api/analytics?days=${nextDays}`)
      setAnalytics(result.analytics)
    } finally {
      setLoading(false)
    }
  }

  const maxDomainVisits = Math.max(1, ...topDomains.map((item) => item.visits))
  const maxDownloads = Math.max(1, ...topSoftware.map((item) => item.downloads))

  return (
    <div className="page-stack">
      <section className="analytics-metrics">
        <article className="panel analytics-metric"><Globe2 /><span>总访问量</span><strong>{totalVisits.toLocaleString()}</strong><small>{analytics?.summary.periodEvents ?? 0} 条周期事件</small></article>
        <article className="panel analytics-metric"><Waypoints /><span>跳转次数</span><strong>{(analytics?.summary.redirects ?? 0).toLocaleString()}</strong><small>真实路由事件</small></article>
        <article className="panel analytics-metric"><Download /><span>累计下载</span><strong>{totalDownloads.toLocaleString()}</strong><small>安装包交付累计</small></article>
        <article className="panel analytics-metric"><BarChart3 /><span>转化率</span><strong>{analytics?.summary.conversionRate ?? 0}%</strong><small>跳转与下载 / 周期事件</small></article>
      </section>

      <section className="analytics-grid">
        <article className="panel analytics-chart-panel">
          <div className="panel-heading"><div><span className="overline">Overview</span><h2>访问与转化趋势</h2></div><select className="inline-select" value={days} disabled={loading} onChange={(event) => void changeDays(Number(event.target.value))}><option value={30}>最近 30 天</option><option value={90}>最近 90 天</option><option value={14}>最近 14 天</option></select></div>
          <MetricChart data={trend.map((item) => item.visits)} secondary={trend.map((item) => item.conversions)} labels={trend.map((item) => item.date.slice(5))} />
          <div className="chart-legend"><span><i data-series="visits" /> 页面访问</span><span><i data-series="redirects" /> 跳转与下载</span></div>
        </article>

        <article className="panel device-panel">
          <div className="panel-heading"><div><span className="overline">Devices</span><h2>设备分布</h2></div></div>
          <div className="donut" style={{ background: `conic-gradient(var(--accent) 0 ${desktopPercent}%, var(--bg-tertiary) ${desktopPercent}% 100%)` }} aria-label="设备占比"><span><strong>{desktopPercent}%</strong><small>桌面端</small></span></div>
          <div className="device-legend"><div><span><Monitor /> 桌面设备</span><strong>{desktopPercent}%</strong></div><div><span><Smartphone /> 移动设备</span><strong>{100 - desktopPercent}%</strong></div></div>
        </article>
      </section>

      <section className="analytics-grid analytics-grid--bottom">
        <article className="panel ranking-panel">
          <div className="panel-heading"><div><span className="overline">Top domains</span><h2>域名访问排行</h2></div></div>
          <div className="ranking-list">{topDomains.map((domain, index) => <div key={domain.id}><span className="rank-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{domain.hostname}</strong><span><i style={{ width: `${Math.max(5, (domain.visits / maxDomainVisits) * 100)}%` }} /></span></div><b>{domain.visits.toLocaleString()}</b></div>)}</div>
        </article>
        <article className="panel ranking-panel">
          <div className="panel-heading"><div><span className="overline">Top downloads</span><h2>软件热度排行</h2></div></div>
          <div className="ranking-list">{topSoftware.map((item, index) => <div key={item.id}><span className="rank-number">{String(index + 1).padStart(2, '0')}</span><div><strong>{item.name}</strong><span><i style={{ width: `${Math.max(5, (item.downloads / maxDownloads) * 100)}%` }} /></span></div><b>{item.downloads.toLocaleString()}</b></div>)}</div>
        </article>
      </section>
    </div>
  )
}
