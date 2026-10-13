import { ArrowLeft, Download, FileArchive, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import type { BrandSettings, PackageRecord, SoftwareRecord } from '../types'
import { PublicNav } from '../components/PublicNav'
import { PublicMeta } from '../components/PublicMeta'
import { apiRequest } from '../lib/api'
import { useToast } from '../contexts/ToastContext'
import { apiUrl } from '../lib/appUrls'

type PublicPackage = Pick<PackageRecord, 'id' | 'fileName' | 'version' | 'platform' | 'size' | 'byteSize' | 'sha256' | 'downloads' | 'releaseNotes' | 'createdAt'> & { downloadUrl: string }

export function SoftwareDetailPage({ settings }: { settings: BrandSettings }) {
  const { slug } = useParams()
  const [software, setSoftware] = useState<SoftwareRecord | null>(null)
  const [packages, setPackages] = useState<PublicPackage[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const { notify } = useToast()

  useEffect(() => {
    if (!slug) return
    setLoading(true)
    void apiRequest<{ software: SoftwareRecord; packages: PublicPackage[] }>(`/api/public/software/${encodeURIComponent(slug)}`).then((result) => {
      setSoftware(result.software)
      setPackages(result.packages)
    }).catch((reason) => setError(reason instanceof Error ? reason.message : '软件详情加载失败')).finally(() => setLoading(false))
  }, [slug])

  return (
    <div className="marketing-page downloads-page">
      <PublicMeta title={software?.name || '软件详情'} description={software?.description || '查看软件版本、安装包和完整性校验信息。'} brand={settings.name} noIndex={Boolean(error)} />
      <PublicNav settings={settings} />
      <main className="shell detail-main">
        <Link className="text-link detail-back" to="/downloads"><ArrowLeft /> 返回软件下载中心</Link>
        {loading ? <div className="empty-state"><FileArchive /><h2>正在读取软件详情</h2><p>请稍候…</p></div> : null}
        {error ? <div className="empty-state"><FileArchive /><h2>无法加载软件</h2><p>{error}</p><Link className="button button--secondary" to="/downloads">返回软件下载中心</Link></div> : null}
        {software ? <>
          <section className="software-detail-hero glass-card">
            <div className="software-monogram">{software.accent}</div>
            <div><p className="eyebrow">Software detail · {software.platform}</p><h1>{software.name}</h1><p className="detail-copy">{software.description}</p><div className="software-meta-line"><span>当前版本 v{software.version}</span><span>{software.architecture}</span><span>{software.downloads.toLocaleString()} 次下载</span></div></div>
          </section>
          <section className="detail-section"><div className="panel-heading"><div><span className="overline">Release history</span><h2>版本与安装包</h2></div><span className="table-muted">{packages.length} 个可下载版本</span></div><div className="public-version-list">{packages.map((item) => <article className="public-version-card" key={item.id}><div className="public-version-heading"><div><strong>v{item.version}</strong><span>{item.platform} · {item.size}</span></div><a className="button button--primary button--small" href={apiUrl(item.downloadUrl)} onClick={(event) => { if (!item.downloadUrl) { event.preventDefault(); notify('该版本暂不可下载', 'info') } }}><Download /> 下载</a></div>{item.releaseNotes ? <p>{item.releaseNotes}</p> : <p className="table-muted">此版本暂无更新说明。</p>}<small>SHA-256 · {item.sha256 ? `${item.sha256.slice(0, 24)}…` : '上传后生成'} · {item.downloads.toLocaleString()} 次下载</small></article>)}</div>{packages.length === 0 ? <div className="table-empty"><FileArchive /><strong>暂无可下载版本</strong><span>请稍后再来查看。</span></div> : null}</section>
          <section className="download-safety glass-card"><ShieldCheck /><div><strong>安全交付</strong><span>安装包由签名地址直达对象存储，服务端不代理大文件流量。</span></div></section>
        </> : null}
      </main>
    </div>
  )
}
