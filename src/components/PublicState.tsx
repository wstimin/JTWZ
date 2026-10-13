import { AlertTriangle, Clock3, RefreshCw, Wrench } from 'lucide-react'
import type { BrandSettings } from '../types'
import { PublicNav } from './PublicNav'
import { PublicMeta } from './PublicMeta'

export function PublicNotice({ message, onRetry }: { message: string; onRetry: () => void }) {
  return <div className="public-notice" role="status"><AlertTriangle /><span>{message}</span><button type="button" onClick={onRetry}>重新加载</button></div>
}

export function PublicStatePage({ settings, mode, onRetry }: { settings: BrandSettings; mode: 'loading' | 'maintenance' | 'error'; onRetry?: () => void }) {
  const maintenance = mode === 'maintenance'
  const loading = mode === 'loading'
  const title = loading ? '正在加载' : maintenance ? '网站维护中' : '暂时无法连接服务'
  const description = loading
    ? '正在读取公开内容。'
    : maintenance
      ? settings.maintenanceMessage || '我们正在进行必要的维护与升级，请稍后再来。'
      : '公开内容暂时无法读取，请稍后重试。'
  const Icon = loading ? Clock3 : maintenance ? Wrench : AlertTriangle

  return <div className="marketing-page public-state-page">
    <PublicMeta title={title} description={description} brand={settings.name} noIndex={maintenance || mode === 'error'} />
    <PublicNav settings={settings} minimal={maintenance || mode === 'error'} />
    <main className="shell public-state-main">
      <div className="glass-card public-state-card" role={loading ? 'status' : 'alert'}>
        <span className={loading ? 'public-state-icon is-loading' : 'public-state-icon'}><Icon /></span>
        <p className="eyebrow">{loading ? 'Loading public content' : maintenance ? 'Scheduled maintenance' : 'Service unavailable'}</p>
        <h1>{title}</h1>
        <p>{description}</p>
        {!loading && !maintenance && onRetry ? <button className="button button--primary" type="button" onClick={onRetry}><RefreshCw /> 重新连接</button> : null}
        {settings.supportEmail && !loading ? <a className="text-link" href={`mailto:${settings.supportEmail}`}>联系支持：{settings.supportEmail}</a> : null}
      </div>
    </main>
  </div>
}
