import { ChevronLeft, ChevronRight, ClipboardList, RefreshCw, Search, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AuditLogRecord } from '../../types'
import { apiRequest } from '../../lib/api'

const actionLabels: Record<string, string> = { create: '创建', update: '更新', delete: '删除', upload: '上传', publish: '发布', rollback: '回滚', verify: '验证', verify_failed: '验证失败', login: '登录', logout: '退出登录' }

function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function AuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogRecord[]>([])
  const [query, setQuery] = useState('')
  const [action, setAction] = useState('')
  const [page, setPage] = useState(1)
  const [pageCount, setPageCount] = useState(1)
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadLogs() {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: '25' })
      if (query.trim()) params.set('q', query.trim())
      if (action) params.set('action', action)
      const result = await apiRequest<{ logs: AuditLogRecord[]; pageCount: number; total: number }>(`/api/audit-logs?${params.toString()}`)
      setLogs(result.logs)
      setPageCount(result.pageCount)
      setTotal(result.total)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '审计日志加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadLogs() }, [page, query, action])

  return (
    <div className="page-stack">
      <section className="security-note panel">
        <ShieldCheck />
        <div><strong>关键操作均已记录</strong><p>审计日志支持服务端筛选与分页，便于在大量记录中定位安全事件。</p></div>
      </section>

      <section className="panel table-panel">
        <div className="toolbar">
          <div className="toolbar-copy"><span className="overline">Audit trail</span><h2>操作日志</h2></div>
          <div className="toolbar-actions">
            <label className="search-control"><Search /><input value={query} onChange={(event) => { setQuery(event.target.value); setPage(1) }} placeholder="搜索操作、对象或详情…" aria-label="搜索审计日志" /></label>
            <select className="inline-select" value={action} onChange={(event) => { setAction(event.target.value); setPage(1) }} aria-label="按操作筛选"><option value="">全部操作</option><option value="create">创建</option><option value="update">更新</option><option value="delete">删除</option><option value="upload">上传</option><option value="publish">发布</option><option value="rollback">回滚</option><option value="verify">验证</option><option value="verify_failed">验证失败</option></select>
            <button className="button button--secondary" type="button" onClick={() => void loadLogs()} disabled={loading}><RefreshCw className={loading ? 'is-spinning' : undefined} /> 刷新</button>
          </div>
        </div>

        {error ? <div className="form-error" role="alert">{error}</div> : null}
        <div className="data-table-wrap">
          <table className="data-table audit-table">
            <thead><tr><th>时间</th><th>操作</th><th>对象</th><th>详情</th></tr></thead>
            <tbody>
              {logs.map((log, index) => (
                <tr key={`${log.createdAt}-${log.entityId}-${index}`}>
                  <td data-label="时间"><time dateTime={log.createdAt}>{formatDate(log.createdAt)}</time></td>
                  <td data-label="操作"><span className="content-status" data-status={log.action === 'verify_failed' ? 'paused' : 'available'}>{actionLabels[log.action] || log.action}</span></td>
                  <td data-label="对象"><div className="table-stack"><strong>{log.entityType}</strong><small>{log.entityId || '—'}</small></div></td>
                  <td data-label="详情"><span className="table-muted">{log.detail || '—'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && logs.length === 0 ? <div className="table-empty"><ClipboardList /><strong>{query || action ? '没有匹配的日志' : '暂无审计日志'}</strong><span>{query || action ? '尝试更换筛选条件。' : '管理员操作会在这里留下记录。'}</span></div> : null}
        {loading ? <div className="table-empty"><RefreshCw className="is-spinning" /><strong>正在读取审计日志</strong><span>请稍候…</span></div> : null}
        {!loading && total > 0 ? <div className="table-pagination"><span>共 {total} 条 · 第 {page} / {pageCount} 页</span><div><button className="button button--secondary button--small" type="button" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}><ChevronLeft /> 上一页</button><button className="button button--secondary button--small" type="button" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>下一页 <ChevronRight /></button></div></div> : null}
      </section>
    </div>
  )
}
