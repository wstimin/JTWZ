import {
  ArrowUpRight,
  Box,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FileCode2,
  Globe2,
  MoreHorizontal,
  Waypoints,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { AnalyticsData, AuditLogRecord, DomainRecord, PlatformAlert, SiteRecord, SoftwareRecord } from '../../types'
import { apiRequest } from '../../lib/api'
import { MetricChart } from '../../components/MetricChart'
import { DomainModeBadge, DomainStatusBadge } from '../../components/StatusBadge'

interface DashboardProps {
  domains: DomainRecord[]
  sites: SiteRecord[]
  software: SoftwareRecord[]
  analytics: AnalyticsData | null
  setAnalytics: Dispatch<SetStateAction<AnalyticsData | null>>
  audits: AuditLogRecord[]
  alerts: PlatformAlert[]
}

const actionLabels: Record<string, string> = {
  login: '管理员安全登录', create: '创建了新内容', update: '更新了配置', delete: '删除了内容',
  upload: '上传了安装包', publish: '发布了静态网站', rollback: '回滚了网站版本', verify: '完成了 DNS 验证', verify_failed: 'DNS 验证未通过',
}

export function DashboardPage({ domains, sites, software, analytics, setAnalytics, audits, alerts }: DashboardProps) {
  const [days, setDays] = useState(12)
  const [loadingTrend, setLoadingTrend] = useState(false)
  const totalVisits = domains.reduce((sum, domain) => sum + domain.visits, 0)
  const downloads = software.reduce((sum, item) => sum + item.downloads, 0)
  const trend = analytics?.trend ?? []
  const alertSummary = alerts.slice(0, 2).map((alert) => alert.title).join(' · ')

  async function changeTrend(nextDays: number) {
    setDays(nextDays)
    setLoadingTrend(true)
    try {
      const result = await apiRequest<{ analytics: AnalyticsData }>(`/api/analytics?days=${nextDays}`)
      setAnalytics(result.analytics)
    } finally {
      setLoadingTrend(false)
    }
  }

  const metrics = [
    { label: '累计访问', value: (analytics?.summary.totalVisits ?? totalVisits).toLocaleString(), detail: '真实访问累计', icon: Globe2 },
    { label: '跳转次数', value: (analytics?.summary.redirects ?? 0).toLocaleString(), detail: '跳转事件累计', icon: Waypoints },
    { label: '下载次数', value: (analytics?.summary.downloads ?? downloads).toLocaleString(), detail: '软件累计下载', icon: Download },
    { label: '域名总数', value: String(domains.length), detail: `${domains.filter((item) => item.status === 'active').length} 正常运行`, icon: Box },
  ]

  return (
    <div className="dashboard-stack">
      {alerts.length ? <section className="dashboard-alert-banner panel" role="status"><Clock3 /><strong>{alerts.length} 项异常需要处理</strong><span title={alerts.map((alert) => `${alert.title}：${alert.detail}`).join('\n')}>{alertSummary}{alerts.length > 2 ? ` · 另有 ${alerts.length - 2} 项` : ''}</span><Link className="text-link" to="/audit-logs">查看详情 <ArrowUpRight /></Link></section> : null}
      <section className="metric-grid">
        {metrics.map((metric) => {
          const Icon = metric.icon
          return (
            <article className="panel metric-card" key={metric.label}>
              <div className="metric-icon"><Icon /></div>
              <div>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.detail}</small>
              </div>
            </article>
          )
        })}
      </section>

      <section className="dashboard-grid">
        <article className="panel chart-panel">
          <div className="panel-heading">
            <div><span className="overline">Traffic</span><h2>访问趋势</h2></div>
            <div className="segmented">{[12, 30, 90].map((period) => <button type="button" className={days === period ? 'is-active' : ''} disabled={loadingTrend} onClick={() => void changeTrend(period)} key={period}>近 {period} 天</button>)}</div>
          </div>
          <MetricChart data={trend.map((item) => item.visits)} secondary={trend.map((item) => item.conversions)} labels={trend.map((item) => item.date.slice(5))} />
        </article>

        <article className="panel activity-panel">
          <div className="panel-heading"><div><span className="overline">Live feed</span><h2>最近活动</h2></div><button className="icon-button"><MoreHorizontal /></button></div>
          <div className="activity-list">{audits.slice(0, 4).map((item, index) => {
            const Icon = item.entityType === 'site' ? CheckCircle2 : item.entityType === 'package' ? Download : item.entityType === 'domain' || item.entityType === 'redirect_rule' ? Waypoints : Clock3
            return <div className="activity-item" key={`${item.createdAt}-${index}`}><span data-tone={item.action === 'publish' || item.action === 'verify' ? 'green' : item.action === 'upload' ? 'blue' : 'gold'}><Icon /></span><div><strong>{actionLabels[item.action] || item.action}</strong><small>{item.detail || item.entityType} · {new Date(item.createdAt).toLocaleString('zh-CN')}</small></div></div>
          })}{audits.length === 0 ? <div className="activity-item"><span data-tone="neutral"><Clock3 /></span><div><strong>暂无操作记录</strong><small>新的管理操作会显示在这里</small></div></div> : null}</div>
        </article>
      </section>

      <section className="panel table-panel">
        <div className="panel-heading">
          <div><span className="overline">Domains</span><h2>域名状态</h2></div>
          <Link className="text-link" to="/domains">查看全部 <ArrowUpRight /></Link>
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead><tr><th>域名</th><th>类型</th><th>目标 / 说明</th><th>状态</th><th>今日访问</th><th>最近更新</th><th aria-label="操作" /></tr></thead>
            <tbody>
              {domains.slice(0, 5).map((domain) => (
                <tr key={domain.id}>
                  <td><div className="table-title"><span className="table-icon"><Globe2 /></span><strong>{domain.hostname}</strong></div></td>
                  <td><DomainModeBadge mode={domain.mode} /></td>
                  <td><span className="table-muted table-target">{domain.target}</span></td>
                  <td><DomainStatusBadge status={domain.status} /></td>
                  <td><strong>{domain.visits.toLocaleString()}</strong></td>
                  <td><span className="table-muted">{domain.updatedAt}</span></td>
                  <td><Link className="table-action" to="/domains" aria-label={`管理 ${domain.hostname}`}><ExternalLink /></Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mini-card-grid">
        <article className="panel mini-card"><FileCode2 /><div><span>静态网站</span><strong>{sites.length}</strong></div><small>{sites.filter((site) => site.status === 'published').length} 个已发布</small></article>
        <article className="panel mini-card"><Box /><div><span>软件产品</span><strong>{software.length}</strong></div><small>{software.filter((item) => item.status === 'published').length} 个正式发布</small></article>
        <article className="panel mini-card"><CheckCircle2 /><div><span>系统状态</span><strong>正常</strong></div><small>所有核心服务可用</small></article>
      </section>
    </div>
  )
}
