import { Bell, Check, Edit3, Plus, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { AnnouncementRecord } from '../../types'
import { apiJson, apiRequest } from '../../lib/api'
import { Modal } from '../../components/Modal'
import { useToast } from '../../contexts/ToastContext'

const emptyDraft = { title: '', body: '', status: 'draft', pinned: false }

export function AnnouncementsPage() {
  const [items, setItems] = useState<AnnouncementRecord[]>([])
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState(emptyDraft)
  const [saving, setSaving] = useState(false)
  const { notify } = useToast()
  async function load() { try { const result = await apiRequest<{ announcements: AnnouncementRecord[] }>('/api/announcements'); setItems(result.announcements) } catch (reason) { notify(reason instanceof Error ? reason.message : '公告加载失败', 'info') } }
  useEffect(() => { void load() }, [])
  function openCreate() { setEditing(null); setDraft(emptyDraft); setOpen(true) }
  function openEdit(item: AnnouncementRecord) { setEditing(item.id); setDraft({ title: item.title, body: item.body, status: item.status, pinned: item.pinned }); setOpen(true) }
  async function save() {
    setSaving(true)
    try {
      const result = editing ? await apiJson<{ announcement: AnnouncementRecord }>(`/api/announcements/${encodeURIComponent(editing)}`, 'PUT', draft) : await apiJson<{ announcement: AnnouncementRecord }>('/api/announcements', 'POST', draft)
      setItems((current) => editing ? current.map((item) => item.id === editing ? result.announcement : item) : [result.announcement, ...current])
      setOpen(false)
      notify(editing ? '公告已更新' : '公告已创建')
    } catch (reason) { notify(reason instanceof Error ? reason.message : '公告保存失败', 'info') } finally { setSaving(false) }
  }
  async function remove(item: AnnouncementRecord) { if (!window.confirm(`确定删除公告“${item.title}”吗？`)) return; try { await apiJson(`/api/announcements/${encodeURIComponent(item.id)}`, 'DELETE'); setItems((current) => current.filter((entry) => entry.id !== item.id)); notify('公告已删除', 'info') } catch (reason) { notify(reason instanceof Error ? reason.message : '公告删除失败', 'info') } }
  return <div className="page-stack"><section className="panel table-panel"><div className="toolbar"><div className="toolbar-copy"><span className="overline">Public updates</span><h2>公告管理</h2></div><button className="button button--primary" type="button" onClick={openCreate}><Plus /> 新建公告</button></div><div className="announcement-admin-list">{items.map((item) => <article className="announcement-admin-item" key={item.id}><div className="announcement-admin-copy"><div><span className="content-status" data-status={item.status === 'published' ? 'available' : 'paused'}>{item.status === 'published' ? '已发布' : '草稿'}</span>{item.pinned ? <span className="announcement-pin">置顶</span> : null}</div><h3>{item.title}</h3><p>{item.body}</p><small>{new Date(item.updatedAt).toLocaleString('zh-CN')}</small></div><div className="row-actions"><button aria-label="编辑公告" title="编辑公告" onClick={() => openEdit(item)}><Edit3 /></button><button aria-label="删除公告" title="删除公告" onClick={() => void remove(item)}><Trash2 /></button></div></article>)}{!items.length ? <div className="table-empty"><Bell /><strong>暂无公告</strong><span>创建公告后会显示在软件下载中心。</span></div> : null}</div></section><Modal open={open} onClose={() => setOpen(false)} eyebrow="Public announcement" title={editing ? '编辑公告' : '新建公告'} footer={<><button className="button button--secondary" type="button" onClick={() => setOpen(false)}>取消</button><button className="button button--primary" type="button" onClick={() => void save()} disabled={saving}><Check /> {saving ? '保存中…' : '保存公告'}</button></>}><div className="form-stack"><label className="field"><span>标题</span><input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} required /></label><label className="field"><span>内容</span><textarea rows={6} value={draft.body} onChange={(event) => setDraft({ ...draft, body: event.target.value })} required /></label><label className="field"><span>状态</span><select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value })}><option value="draft">保存为草稿</option><option value="published">立即发布</option></select></label><label className="check-row"><input type="checkbox" checked={draft.pinned} onChange={(event) => setDraft({ ...draft, pinned: event.target.checked })} /><span>置顶公告</span></label></div></Modal></div>
}
