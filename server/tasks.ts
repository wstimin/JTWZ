import { randomUUID } from 'node:crypto'
import { db } from './db.js'

type Row = Record<string, unknown>
export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export type TaskLog = { at: string; level: 'info' | 'success' | 'error'; message: string }

function parseJson<T>(value: unknown, fallback: T): T {
  try { return JSON.parse(String(value || '')) as T } catch { return fallback }
}

export function mapTask(row: Row) {
  return {
    id: String(row.id), kind: String(row.kind), label: String(row.label), entityType: String(row.entity_type || ''), entityId: String(row.entity_id || ''),
    status: String(row.status) as TaskStatus, progress: Number(row.progress || 0), message: String(row.message || ''),
    input: parseJson<Record<string, unknown>>(row.input_json, {}), result: parseJson<Record<string, unknown>>(row.result_json, {}),
    error: String(row.error || ''), logs: parseJson<TaskLog[]>(row.logs_json, []), retryable: Boolean(row.retryable), retryOf: String(row.retry_of || ''),
    createdAt: String(row.created_at), startedAt: row.started_at ? String(row.started_at) : undefined,
    finishedAt: row.finished_at ? String(row.finished_at) : undefined, updatedAt: String(row.updated_at),
  }
}

export function createTask(options: { kind: string; label: string; entityType?: string; entityId?: string; input?: Record<string, unknown>; retryable?: boolean; retryOf?: string }) {
  const id = randomUUID()
  const timestamp = new Date().toISOString()
  const logs: TaskLog[] = [{ at: timestamp, level: 'info', message: '任务已创建' }]
  db.prepare(`INSERT INTO operation_tasks
    (id, kind, label, entity_type, entity_id, status, progress, message, input_json, result_json, error, logs_json, retryable, retry_of, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'queued', 0, '等待处理', ?, '{}', '', ?, ?, ?, ?, ?)`)
    .run(id, options.kind, options.label, options.entityType || '', options.entityId || '', JSON.stringify(options.input || {}), JSON.stringify(logs), options.retryable ? 1 : 0, options.retryOf || '', timestamp, timestamp)
  return getTask(id)!
}

export function getTask(id: string) {
  const row = db.prepare('SELECT * FROM operation_tasks WHERE id = ?').get(id) as Row | undefined
  return row ? mapTask(row) : undefined
}

export function listTasks(options: { status?: string; entityType?: string; entityId?: string; limit?: number } = {}) {
  const filters: string[] = []
  const params: Array<string | number | null> = []
  if (options.status) { filters.push('status = ?'); params.push(options.status) }
  if (options.entityType) { filters.push('entity_type = ?'); params.push(options.entityType) }
  if (options.entityId) { filters.push('entity_id = ?'); params.push(options.entityId) }
  const limit = Math.min(200, Math.max(1, Number(options.limit || 50)))
  return db.prepare(`SELECT * FROM operation_tasks ${filters.length ? `WHERE ${filters.join(' AND ')}` : ''} ORDER BY created_at DESC LIMIT ?`).all(...params, limit).map((row) => mapTask(row as Row))
}

export function findLatestTask(kind: string, entityId: string) {
  const row = db.prepare('SELECT * FROM operation_tasks WHERE kind = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 1').get(kind, entityId) as Row | undefined
  return row ? mapTask(row) : undefined
}

export function updateTask(id: string, changes: { status?: TaskStatus; progress?: number; message?: string; result?: Record<string, unknown>; error?: string; log?: Omit<TaskLog, 'at'> }) {
  const current = getTask(id)
  if (!current) return undefined
  const timestamp = new Date().toISOString()
  const status = changes.status || current.status
  const logs = [...current.logs]
  if (changes.log) logs.push({ at: timestamp, ...changes.log })
  const progress = Math.min(100, Math.max(0, Math.round(changes.progress ?? current.progress)))
  const startedAt = current.startedAt || (status === 'running' ? timestamp : null)
  const finishedAt = ['succeeded', 'failed', 'cancelled'].includes(status) ? timestamp : current.finishedAt || null
  db.prepare(`UPDATE operation_tasks SET status = ?, progress = ?, message = ?, result_json = ?, error = ?, logs_json = ?, started_at = ?, finished_at = ?, updated_at = ? WHERE id = ?`)
    .run(status, progress, changes.message ?? current.message, JSON.stringify(changes.result ?? current.result), changes.error ?? current.error, JSON.stringify(logs.slice(-200)), startedAt, finishedAt, timestamp, id)
  return getTask(id)
}

export function cancelTask(id: string) {
  const current = getTask(id)
  if (!current || !['queued', 'running'].includes(current.status)) return current
  return updateTask(id, { status: 'cancelled', message: '已由管理员取消', log: { level: 'error', message: '管理员取消任务' } })
}

export function recoverInterruptedTasks() {
  const interrupted = db.prepare("SELECT id FROM operation_tasks WHERE status IN ('queued', 'running')").all() as Row[]
  for (const item of interrupted) updateTask(String(item.id), { status: 'failed', message: '服务重启导致任务中断', error: '任务执行期间服务重启，可从任务中心重试', log: { level: 'error', message: '服务重启，任务已转为可恢复失败状态' } })
}
