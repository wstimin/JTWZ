import { Archive, Check, Edit3, PackageOpen, Plus, Search, Star, Trash2 } from 'lucide-react'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import type { SoftwareRecord, SoftwareVersionRecord } from '../../types'
import { apiJson, apiRequest } from '../../lib/api'
import { Modal } from '../../components/Modal'
import { useToast } from '../../contexts/ToastContext'
import { useAuth } from '../../contexts/AuthContext'

type VersionDraft = {
  softwareId: string
  version: string
  channel: SoftwareVersionRecord['channel']
  releaseNotes: string
  status: SoftwareVersionRecord['status']
  isRecommended: boolean
}

const emptyDraft: VersionDraft = { softwareId: '', version: '', channel: 'stable', releaseNotes: '', status: 'draft', isRecommended: false }
const statusLabels = { draft: '草稿', published: '已发布', archived: '已归档' }
const channelLabels = { stable: '正式版', beta: 'Beta', alpha: 'Alpha' }

export function VersionsPage({ software }: { software: SoftwareRecord[] }) {
  const [versions, setVersions] = useState<SoftwareVersionRecord[]>([])
  const [softwareId, setSoftwareId] = useState('')
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState('')
  const [draft, setDraft] = useState<VersionDraft>(emptyDraft)
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const { notify, confirm } = useToast()
  const { admin } = useAuth()
  const canManage = Boolean(admin?.permissions.includes('content.manage'))

  async function load() {
    try {
      const result = await apiRequest<{ versions: SoftwareVersionRecord[] }>(`/api/versions${softwareId ? `?softwareId=${encodeURIComponent(softwareId)}` : ''}`)
      setVersions(result.versions)
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '版本列表加载失败', 'info')
    }
  }

  useEffect(() => { void load() }, [softwareId])

  const filtered = useMemo(() => versions.filter((item) => `${item.software} ${item.version} ${item.channel} ${item.platforms.join(' ')}`.toLowerCase().includes(query.toLowerCase())), [versions, query])
  const editingVersion = versions.find((item) => item.id === editingId)

  function openCreate() {
    setEditingId('')
    setDraft({ ...emptyDraft, softwareId: softwareId || software[0]?.id || '' })
    setOpen(true)
  }

  function openEdit(item: SoftwareVersionRecord) {
    setEditingId(item.id)
    setDraft({ softwareId: item.softwareId, version: item.version, channel: item.channel, releaseNotes: item.releaseNotes, status: item.status, isRecommended: item.isRecommended })
    setOpen(true)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!draft.softwareId) return notify('请先选择软件产品', 'info')
    setSaving(true)
    try {
      const result = editingId
        ? await apiJson<{ version: SoftwareVersionRecord }>(`/api/versions/${encodeURIComponent(editingId)}`, 'PUT', draft)
        : await apiJson<{ version: SoftwareVersionRecord }>('/api/versions', 'POST', draft)
      setVersions((current) => editingId ? current.map((item) => item.id === editingId ? result.version : item) : [result.version, ...current])
      if (result.version.isRecommended) {
        setVersions((current) => current.map((item) => item.softwareId === result.version.softwareId && item.id !== result.version.id ? { ...item, isRecommended: false } : item))
      }
      setOpen(false)
      notify(editingId ? '版本资料已更新' : '发布版本已创建')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '版本保存失败', 'info')
    } finally {
      setSaving(false)
    }
  }

  async function markRecommended(item: SoftwareVersionRecord) {
    try {
      const result = await apiJson<{ version: SoftwareVersionRecord }>(`/api/versions/${encodeURIComponent(item.id)}`, 'PUT', { isRecommended: true })
      setVersions((current) => current.map((entry) => entry.softwareId === item.softwareId ? (entry.id === item.id ? result.version : { ...entry, isRecommended: false }) : entry))
      notify(`v${item.version} 已设为推荐版本`)
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '推荐版本设置失败', 'info')
    }
  }

  async function archiveVersion(item: SoftwareVersionRecord) {
    try {
      const result = await apiJson<{ version: SoftwareVersionRecord }>(`/api/versions/${encodeURIComponent(item.id)}`, 'PUT', { status: item.status === 'archived' ? 'draft' : 'archived', isRecommended: false })
      setVersions((current) => current.map((entry) => entry.id === item.id ? result.version : entry))
      notify(result.version.status === 'archived' ? '版本已归档' : '版本已恢复为草稿', 'info')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '版本状态更新失败', 'info')
    }
  }

  async function removeVersion(item: SoftwareVersionRecord) {
    if (!await confirm({ title: '删除版本记录', message: `确定删除 ${item.software} v${item.version} 吗？关联安装包存在时系统会阻止删除。`, confirmLabel: '删除版本', tone: 'danger' })) return
    try {
      await apiJson(`/api/versions/${encodeURIComponent(item.id)}`, 'DELETE')
      setVersions((current) => current.filter((entry) => entry.id !== item.id))
      notify('版本记录已删除', 'info')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '版本删除失败', 'info')
    }
  }

  return <div className="page-stack">
    <section className="panel table-panel">
      <div className="toolbar">
        <div className="toolbar-copy"><span className="overline">Release management</span><h2>软件版本管理</h2><p>版本是独立发布记录，安装包按平台归属到对应版本。</p></div>
        <div className="toolbar-actions"><label className="select-control"><select value={softwareId} onChange={(event) => setSoftwareId(event.target.value)}><option value="">全部软件</option>{software.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="search-control"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索版本、通道或平台…" /></label>{canManage ? <button className="button button--primary" type="button" onClick={openCreate}><Plus /> 新建版本</button> : null}</div>
      </div>
      <div className="data-table-wrap"><table className="data-table"><thead><tr><th>软件 / 版本</th><th>通道</th><th>安装包</th><th>下载</th><th>状态</th><th>更新时间</th>{canManage ? <th /> : null}</tr></thead><tbody>{filtered.map((item) => <tr key={item.id}><td><div className="table-stack"><strong>{item.software} · v{item.version}</strong><small>{item.isRecommended ? '推荐版本' : item.releaseNotes ? item.releaseNotes.slice(0, 44) : '暂无更新说明'}</small></div></td><td>{channelLabels[item.channel]}</td><td><div className="table-stack"><strong>{item.packageCount} 个</strong><small>{item.platforms.join(' / ') || '尚未上传'}</small></div></td><td>{item.downloads.toLocaleString()}</td><td><span className="content-status" data-status={item.status}>{statusLabels[item.status]}</span></td><td>{new Date(item.updatedAt).toLocaleDateString('zh-CN')}</td>{canManage ? <td><div className="row-actions">{!item.isRecommended && item.status !== 'archived' && item.packageCount > 0 ? <button aria-label="设为推荐版本" title="设为推荐版本" type="button" onClick={() => void markRecommended(item)}><Star /></button> : null}<button aria-label="编辑版本" title="编辑版本" type="button" onClick={() => openEdit(item)}><Edit3 /></button><button aria-label={item.status === 'archived' ? '恢复版本' : '归档版本'} title={item.status === 'archived' ? '恢复版本' : '归档版本'} type="button" onClick={() => void archiveVersion(item)}><Archive /></button><button className="danger-icon" aria-label="删除版本" title="删除版本" type="button" onClick={() => void removeVersion(item)}><Trash2 /></button></div></td> : null}</tr>)}</tbody></table></div>
      {!filtered.length ? <div className="table-empty"><PackageOpen /><strong>暂无版本记录</strong><span>先创建一个发布版本，再上传对应平台的安装包。</span></div> : null}
    </section>

    <Modal open={open} onClose={() => setOpen(false)} eyebrow={editingId ? 'Edit release' : 'New release'} title={editingId ? `编辑 v${draft.version}` : '新建发布版本'} footer={<><button className="button button--secondary" type="button" onClick={() => setOpen(false)}>取消</button><button className="button button--primary" type="submit" form="version-form" disabled={saving}><Check /> {saving ? '保存中…' : '保存版本'}</button></>}>
      <form id="version-form" className="form-stack" onSubmit={save}>
        <label className="field"><span>所属软件</span><select value={draft.softwareId} disabled={Boolean(editingId)} onChange={(event) => setDraft({ ...draft, softwareId: event.target.value })} required><option value="">请选择软件</option>{software.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <div className="field-grid"><label className="field"><span>版本号</span><input value={draft.version} onChange={(event) => setDraft({ ...draft, version: event.target.value })} placeholder="例如 2.5.0" required /></label><label className="field"><span>发布通道</span><select value={draft.channel} onChange={(event) => setDraft({ ...draft, channel: event.target.value as SoftwareVersionRecord['channel'] })}><option value="stable">正式版</option><option value="beta">Beta</option><option value="alpha">Alpha</option></select></label></div>
        <label className="field"><span>更新说明</span><textarea rows={6} value={draft.releaseNotes} onChange={(event) => setDraft({ ...draft, releaseNotes: event.target.value })} placeholder="记录本次新增、改进和修复内容…" /></label>
        <div className="field-grid"><label className="field"><span>发布状态</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as SoftwareVersionRecord['status'] })}><option value="draft">草稿</option><option value="published" disabled={!editingId || !editingVersion?.packageCount}>已发布</option><option value="archived">已归档</option></select><small>{editingVersion?.packageCount ? '当前版本已具备安装包，可以正式发布。' : '上传至少一个可用安装包后才能发布。'}</small></label><label className="toggle-row"><input type="checkbox" checked={draft.isRecommended} disabled={!editingId || !editingVersion?.packageCount} onChange={(event) => setDraft({ ...draft, isRecommended: event.target.checked })} /><span><strong>设为推荐版本</strong><small>推荐版本会自动发布，并显示在软件首页。</small></span></label></div>
      </form>
    </Modal>
  </div>
}
