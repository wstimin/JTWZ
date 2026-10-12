import { ArrowRight, CalendarClock, Check, Edit3, Globe2, PauseCircle, PlayCircle, Plus, Trash2, Waypoints } from 'lucide-react'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { DomainRecord, RedirectRuleRecord } from '../../types'
import { DomainStatusBadge } from '../../components/StatusBadge'
import { Modal } from '../../components/Modal'
import { useToast } from '../../contexts/ToastContext'
import { apiJson } from '../../lib/api'

function toDateTimeLocal(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
  return local.toISOString().slice(0, 16)
}

export function RedirectsPage({ domains, rules, setRules }: { domains: DomainRecord[]; rules: RedirectRuleRecord[]; setRules: Dispatch<SetStateAction<RedirectRuleRecord[]>> }) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [notes, setNotes] = useState('')
  const [domainId, setDomainId] = useState(domains[0]?.id || '')
  const [sourcePath, setSourcePath] = useState('/*')
  const [target, setTarget] = useState('')
  const [redirectCode, setRedirectCode] = useState<301 | 302>(302)
  const [preservePath, setPreservePath] = useState(true)
  const [preserveQuery, setPreserveQuery] = useState(true)
  const [priority, setPriority] = useState(100)
  const [startsAt, setStartsAt] = useState('')
  const [expiresAt, setExpiresAt] = useState('')
  const [saving, setSaving] = useState(false)
  const { notify } = useToast()

  useEffect(() => {
    if (!domainId && domains[0]) setDomainId(domains[0].id)
  }, [domainId, domains])

  const sortedRules = useMemo(() => [...rules].sort((left, right) => left.priority - right.priority || right.updatedAt.localeCompare(left.updatedAt)), [rules])

  function resetForm() {
    setEditingId(null)
    setName('')
    setNotes('')
    setDomainId(domains[0]?.id || '')
    setSourcePath('/*')
    setTarget('')
    setRedirectCode(302)
    setPreservePath(true)
    setPreserveQuery(true)
    setPriority(100)
    setStartsAt('')
    setExpiresAt('')
  }

  function openCreate() {
    resetForm()
    setOpen(true)
  }

  function openEdit(rule: RedirectRuleRecord) {
    setEditingId(rule.id)
    setName(rule.name)
    setNotes(rule.notes)
    setDomainId(rule.domainId)
    setSourcePath(rule.sourcePath)
    setTarget(rule.target)
    setRedirectCode(rule.redirectCode)
    setPreservePath(rule.preservePath)
    setPreserveQuery(rule.preserveQuery)
    setPriority(rule.priority)
    setStartsAt(toDateTimeLocal(rule.startsAt))
    setExpiresAt(toDateTimeLocal(rule.expiresAt))
    setOpen(true)
  }

  async function saveRule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = { name, notes, domainId, sourcePath, target, redirectCode, preservePath, preserveQuery, priority, startsAt: startsAt || null, expiresAt: expiresAt || null }
      const result = editingId
        ? await apiJson<{ redirectRule: RedirectRuleRecord }>(`/api/redirects/${encodeURIComponent(editingId)}`, 'PUT', payload)
        : await apiJson<{ redirectRule: RedirectRuleRecord }>('/api/redirects', 'POST', payload)
      setRules((current) => editingId
        ? current.map((entry) => entry.id === editingId ? result.redirectRule : entry)
        : [result.redirectRule, ...current])
      setOpen(false)
      resetForm()
      notify(editingId ? '跳转规则已更新' : '跳转规则已保存并进入路由引擎')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '跳转规则保存失败', 'info')
    } finally {
      setSaving(false)
    }
  }

  async function toggleRule(rule: RedirectRuleRecord) {
    try {
      const result = await apiJson<{ redirectRule: RedirectRuleRecord }>(`/api/redirects/${encodeURIComponent(rule.id)}`, 'PUT', { enabled: !rule.enabled })
      setRules((current) => current.map((entry) => entry.id === rule.id ? result.redirectRule : entry))
      notify(rule.enabled ? '跳转规则已停用' : '跳转规则已启用')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '跳转规则状态更新失败', 'info')
    }
  }

  async function removeRule(rule: RedirectRuleRecord) {
    if (!window.confirm(`确定删除跳转规则“${rule.name || rule.sourcePath}”吗？此操作无法撤销。`)) return
    try {
      await apiJson(`/api/redirects/${encodeURIComponent(rule.id)}`, 'DELETE')
      setRules((current) => current.filter((entry) => entry.id !== rule.id))
      notify('跳转规则已删除', 'info')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '跳转规则删除失败', 'info')
    }
  }

  return (
    <div className="page-stack">
      <section className="rules-hero panel">
        <div><span className="overline">Routing engine</span><h2>让每个路径抵达正确的页面。</h2><p>支持路径级规则、优先级、有效期、冲突检测和循环跳转保护。</p></div>
        <button className="button button--primary" type="button" onClick={openCreate}><Plus /> 新建规则</button>
      </section>

      <section className="rules-grid">
        {sortedRules.map((rule, index) => (
          <article className="panel rule-card" key={rule.id}>
            <div className="rule-card-head">
              <span className="rule-index">{String(index + 1).padStart(2, '0')}</span>
              <div><strong>{rule.name || rule.sourcePath}</strong>{rule.notes ? <small>{rule.notes}</small> : null}</div>
              <DomainStatusBadge status={rule.enabled ? 'active' : 'paused'} />
              <div className="row-actions">
                <button aria-label="编辑跳转规则" title="编辑跳转规则" type="button" onClick={() => openEdit(rule)}><Edit3 /></button>
                <button aria-label={rule.enabled ? '停用跳转规则' : '启用跳转规则'} title={rule.enabled ? '停用跳转规则' : '启用跳转规则'} type="button" onClick={() => void toggleRule(rule)}>{rule.enabled ? <PauseCircle /> : <PlayCircle />}</button>
                <button className="danger-icon" aria-label="删除跳转规则" title="删除跳转规则" type="button" onClick={() => void removeRule(rule)}><Trash2 /></button>
              </div>
            </div>
            <div className="rule-route">
              <div><small>来源</small><strong><Globe2 /> {rule.hostname}</strong><span>{rule.sourcePath} · {rule.preservePath ? '保留原始路径' : '统一跳转目标'}</span></div>
              <ArrowRight />
              <div><small>目标</small><strong>{rule.target}</strong><span>{rule.redirectCode} {rule.redirectCode === 301 ? '永久跳转' : '临时跳转'}</span></div>
            </div>
            <div className="rule-footer">
              <span><Waypoints /> {rule.hits.toLocaleString()} 次跳转 · 优先级 {rule.priority}</span>
              <span><CalendarClock /> {rule.startsAt ? `${new Date(rule.startsAt).toLocaleString('zh-CN')} 生效` : '立即生效'}{rule.expiresAt ? ` · ${new Date(rule.expiresAt).toLocaleString('zh-CN')} 失效` : ''}</span>
            </div>
          </article>
        ))}
        {!sortedRules.length ? <div className="panel table-empty"><Waypoints /><strong>还没有路径级跳转规则</strong><span>新建规则后，系统会在域名默认目标之前按优先级匹配。</span><button className="button button--primary" type="button" onClick={openCreate}><Plus /> 新建第一条规则</button></div> : null}
      </section>

      <Modal open={open} onClose={() => { if (!saving) { setOpen(false); resetForm() } }} eyebrow="Redirect rule" title={editingId ? '编辑跳转规则' : '新建跳转规则'} footer={<><button className="button button--secondary" type="button" onClick={() => { setOpen(false); resetForm() }} disabled={saving}>取消</button><button className="button button--primary" type="submit" form="redirect-rule-form" disabled={saving}><Check /> {saving ? '正在保存…' : '保存规则'}</button></>}>
        <form id="redirect-rule-form" className="form-stack" onSubmit={saveRule}>
          <div className="field-grid"><label className="field"><span>规则名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：活动页面跳转" maxLength={120} /></label><label className="field"><span>来源域名</span><select value={domainId} onChange={(event) => setDomainId(event.target.value)} required>{domains.map((domain) => <option value={domain.id} key={domain.id}>{domain.hostname}</option>)}</select></label></div>
          <div className="field-grid"><label className="field"><span>匹配路径</span><input value={sourcePath} onChange={(event) => setSourcePath(event.target.value)} placeholder="/*" required /></label><label className="field"><span>跳转类型</span><select value={redirectCode} onChange={(event) => setRedirectCode(Number(event.target.value) as 301 | 302)}><option value={302}>302 临时跳转</option><option value={301}>301 永久跳转</option></select></label></div>
          <label className="field"><span>目标地址</span><input value={target} onChange={(event) => setTarget(event.target.value)} placeholder="https://target.example/page" type="url" required /></label>
          <div className="field-grid"><label className="field"><span>生效时间（可选）</span><input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /></label><label className="field"><span>失效时间（可选）</span><input type="datetime-local" value={expiresAt} min={startsAt || undefined} onChange={(event) => setExpiresAt(event.target.value)} /></label></div>
          <div className="field-grid"><label className="field"><span>优先级</span><input type="number" min={0} max={10000} value={priority} onChange={(event) => setPriority(Number(event.target.value))} /><small>数字越小越先匹配。</small></label><label className="field"><span>用途和备注</span><input value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="说明该规则的业务用途" maxLength={1000} /></label></div>
          <div className="switch-list"><label><span><strong>保留原路径</strong><small>将访问路径追加到目标地址</small></span><input type="checkbox" checked={preservePath} onChange={(event) => setPreservePath(event.target.checked)} /></label><label><span><strong>保留查询参数</strong><small>传递 URL 中的查询参数</small></span><input type="checkbox" checked={preserveQuery} onChange={(event) => setPreserveQuery(event.target.checked)} /></label></div>
        </form>
      </Modal>
    </div>
  )
}
