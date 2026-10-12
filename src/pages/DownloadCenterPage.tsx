import { ArrowRight, Download, Search, ShieldCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import type { AnnouncementRecord, BrandSettings, SoftwareRecord } from '../types'
import { PublicNav } from '../components/PublicNav'
import { useToast } from '../contexts/ToastContext'
import { apiRequest } from '../lib/api'
import { apiUrl } from '../lib/appUrls'

export function DownloadCenterPage({ settings, software }: { settings: BrandSettings; software: SoftwareRecord[] }) {
  const [query, setQuery] = useState('')
  const [announcements, setAnnouncements] = useState<AnnouncementRecord[]>([])
  const { notify } = useToast()
  useEffect(() => { void apiRequest<{ announcements: AnnouncementRecord[] }>('/api/public/announcements').then((result) => setAnnouncements(result.announcements)).catch(() => undefined) }, [])
  const filtered = useMemo(
    () => software.filter((item) => `${item.name} ${item.platform} ${item.description}`.toLowerCase().includes(query.toLowerCase())),
    [query, software],
  )

  return (
    <div className="marketing-page downloads-page">
      <PublicNav settings={settings} />
      <main className="shell downloads-main">
        <section className="downloads-hero">
          <div>
            <p className="eyebrow">Software Distribution</p>
            <h1>软件与版本，<span>安全交付。</span></h1>
            <p>选择适合你的平台和架构。正式接入对象存储后，文件将从存储或 CDN 直接下载。</p>
          </div>
          <label className="downloads-search">
            <Search />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索软件或平台…" />
          </label>
        </section>

        {announcements.length ? <section className="announcement-strip glass-card"><span className="overline">Latest updates</span><div>{announcements.slice(0, 2).map((item) => <article key={item.id}><strong>{item.title}</strong><span>{item.body}</span></article>)}</div></section> : null}

        <div className="software-public-grid">
          {filtered.map((item) => (
            <article className="glass-card public-software-card" key={item.id}>
              <div className="software-monogram">{item.accent}</div>
              <div className="public-software-copy">
                <span className="overline">{item.platform} · {item.architecture}</span>
                <h2>{item.name}</h2>
                <p>{item.description}</p>
                <div className="software-meta-line">
                  <span>v{item.version}</span>
                  <span>{item.size}</span>
                  <span>{item.downloads.toLocaleString()} 次下载</span>
                </div>
              </div>
              <button className="button button--primary" type="button" onClick={() => {
                if (item.downloadUrl) window.location.assign(apiUrl(item.downloadUrl))
                else notify(`${item.name} 尚未配置安装包下载地址`, 'info')
              }}>
                <Download /> 立即下载
              </button>
              <Link className="text-link" to={`/downloads/${encodeURIComponent(item.slug)}`}>查看版本详情 <ArrowRight /></Link>
            </article>
          ))}
        </div>

        {filtered.length === 0 ? <div className="empty-state"><Search /><h2>没有找到相关软件</h2><p>请尝试其他软件名称或平台关键词。</p></div> : null}

        <section className="download-safety glass-card">
          <ShieldCheck />
          <div><strong>文件完整性保护</strong><span>正式版本会展示 SHA-256 校验值，并支持签名下载地址。</span></div>
        </section>
      </main>
    </div>
  )
}
