import { AlertTriangle, Ban, CheckCircle2, ChevronDown, Clock3, ListChecks, RefreshCw, RotateCcw, XCircle } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { OperationTaskRecord } from '../../types'
import { apiJson, apiRequest } from '../../lib/api'
import { useToast } from '../../contexts/ToastContext'

const statusLabels: Record<OperationTaskRecord['status'], string> = { queued: '等待中', running: '执行中', succeeded: '已完成', failed: '失败', cancelled: '已取消' }
const kindLabels: Record<string, string> = { certificate_issue: '证书签发', certificate_renew: '证书续期', site_publish: '网站发布', site_rollback: '网站回滚', package_upload: '安装包上传' }

function TaskIcon({ status }: { status: OperationTaskRecord['status'] }) {
  if (status === 'succeeded') return <CheckCircle2 />
  if (status === 'failed') return <XCircle />
  if (status === 'cancelled') return <Ban />
  if (status === 'running') return <RefreshCw className="is-spinning" />
  return <Clock3 />
}

export function TasksPage() {
  const [tasks, setTasks] = useState<OperationTaskRecord[]>([])
  const [status, setStatus] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState('')
  const { notify } = useToast()

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      const result = await apiRequest<{ tasks: OperationTaskRecord[] }>(`/api/tasks?limit=100${status ? `&status=${encodeURIComponent(status)}` : ''}`)
      setTasks(result.tasks)
    } catch (reason) {
      if (!quiet) notify(reason instanceof Error ? reason.message : '任务列表加载失败', 'info')
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [notify, status])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (!tasks.some((item) => ['queued', 'running'].includes(item.status))) return
    const timer = window.setInterval(() => { void load(true) }, 3000)
    return () => window.clearInterval(timer)
  }, [load, tasks])

  const summary = useMemo(() => ({
    active: tasks.filter((item) => ['queued', 'running'].includes(item.status)).length,
    failed: tasks.filter((item) => item.status === 'failed').length,
    completed: tasks.filter((item) => item.status === 'succeeded').length,
  }), [tasks])

  async function retry(item: OperationTaskRecord) {
    setBusyId(item.id)
    try {
      await apiJson(`/api/tasks/${encodeURIComponent(item.id)}/retry`, 'POST')
      notify('任务重试已执行')
      await load(true)
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '任务重试失败', 'info')
      await load(true)
    } finally {
      setBusyId('')
    }
  }

  async function cancel(item: OperationTaskRecord) {
    setBusyId(item.id)
    try {
      const result = await apiJson<{ task: OperationTaskRecord }>(`/api/tasks/${encodeURIComponent(item.id)}/cancel`, 'POST')
      setTasks((current) => current.map((entry) => entry.id === item.id ? result.task : entry))
      notify('任务已取消', 'info')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '任务取消失败', 'info')
    } finally {
      setBusyId('')
    }
  }

  return <div className="page-stack">
    <section className="task-summary-grid">
      <article className="panel summary-card"><span>活动任务</span><strong>{summary.active}</strong><small>等待或正在执行</small></article>
      <article className="panel summary-card"><span>执行成功</span><strong>{summary.completed}</strong><small>最近 100 条记录</small></article>
      <article className="panel summary-card"><span>需要处理</span><strong>{summary.failed}</strong><small>可查看日志并重试</small></article>
    </section>

    <section className="panel task-center-panel">
      <div className="toolbar"><div className="toolbar-copy"><span className="overline">Operation center</span><h2>任务中心</h2><p>统一追踪证书、网站发布、版本回滚和大文件上传任务。</p></div><div className="toolbar-actions"><label className="select-control"><select aria-label="按任务状态筛选" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部状态</option><option value="running">执行中</option><option value="succeeded">已完成</option><option value="failed">失败</option><option value="cancelled">已取消</option></select><ChevronDown /></label><button className="button button--secondary" type="button" onClick={() => void load()} disabled={loading}><RefreshCw /> 刷新</button></div></div>
      <div className="task-list">
        {tasks.map((item) => <details className="task-card" key={item.id} open={item.status === 'failed'}>
          <summary>
            <span className="task-status-icon" data-status={item.status}><TaskIcon status={item.status} /></span>
            <span className="task-main"><strong>{item.label}</strong><small>{kindLabels[item.kind] || item.kind} · {new Date(item.createdAt).toLocaleString('zh-CN')}</small></span>
            <span className="task-progress"><i><b style={{ width: `${item.progress}%` }} /></i><em>{item.progress}%</em></span>
            <span className="content-status" data-status={item.status === 'succeeded' ? 'available' : item.status === 'failed' || item.status === 'cancelled' ? 'paused' : 'processing'}>{statusLabels[item.status]}</span>
          </summary>
          <div className="task-detail">
            <div className="task-message"><span>{item.message}</span>{item.error ? <strong><AlertTriangle /> {item.error}</strong> : null}</div>
            <div className="task-log">{item.logs.map((log, index) => <div data-level={log.level} key={`${log.at}-${index}`}><time>{new Date(log.at).toLocaleTimeString('zh-CN')}</time><span>{log.message}</span></div>)}</div>
            <div className="task-actions">{item.status === 'failed' && item.retryable ? <button className="button button--secondary" type="button" disabled={busyId === item.id} onClick={() => void retry(item)}><RotateCcw /> 重试任务</button> : null}{['queued', 'running'].includes(item.status) ? <button className="button button--secondary" type="button" disabled={busyId === item.id} onClick={() => void cancel(item)}><Ban /> 取消任务</button> : null}<code>{item.id}</code></div>
          </div>
        </details>)}
        {!loading && !tasks.length ? <div className="table-empty"><ListChecks /><strong>暂无任务记录</strong><span>证书、网站发布和大文件操作会显示在这里。</span></div> : null}
        {loading ? <div className="version-loading">正在读取任务记录…</div> : null}
      </div>
    </section>
  </div>
}
