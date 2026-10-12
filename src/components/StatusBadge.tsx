import type { DomainMode, DomainStatus } from '../types'

const statusLabels: Record<DomainStatus, string> = {
  active: '正常运行',
  pending: '等待配置',
  paused: '已暂停',
  error: '配置异常',
}

const modeLabels: Record<DomainMode, string> = {
  redirect: '域名跳转',
  site: '静态网站',
  download: '软件下载',
  maintenance: '维护页面',
}

export function DomainStatusBadge({ status }: { status: DomainStatus }) {
  return (
    <span className="status-badge" data-status={status}>
      <span className="status-dot" />
      {statusLabels[status]}
    </span>
  )
}

export function DomainModeBadge({ mode }: { mode: DomainMode }) {
  return <span className="mode-badge">{modeLabels[mode]}</span>
}
