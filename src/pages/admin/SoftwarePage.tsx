import { Box, Check, Download, Edit3, PauseCircle, PlayCircle, Plus, Search, ShieldCheck, Trash2 } from 'lucide-react'
import { FormEvent, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { SoftwareRecord } from '../../types'
import { Modal } from '../../components/Modal'
import { useToast } from '../../contexts/ToastContext'
import { useAuth } from '../../contexts/AuthContext'
import { apiJson } from '../../lib/api'

const statusLabels = { published: '已发布', draft: '草稿', testing: '测试中' }

export function SoftwarePage({ software, setSoftware }: { software: SoftwareRecord[]; setSoftware: Dispatch<SetStateAction<SoftwareRecord[]>> }) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [platform, setPlatform] = useState('Windows')
  const [architecture, setArchitecture] = useState('Universal')
  const [version, setVersion] = useState('1.0.0')
  const [status, setStatus] = useState<SoftwareRecord['status']>('draft')
  const [saving, setSaving] = useState(false)
  const { notify } = useToast()
  const { admin } = useAuth()
  const canManage = Boolean(admin?.permissions.includes('content.manage'))
  const filtered = useMemo(() => software.filter((item) => `${item.name} ${item.platform}`.toLowerCase().includes(query.toLowerCase())), [query, software])

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = editingId
        ? { name, description, status, architecture }
        : { name, slug, description, platform, status, version, architecture }
      const result = editingId
        ? await apiJson<{ software: SoftwareRecord }>(`/api/software/${encodeURIComponent(editingId)}`, 'PUT', payload)
        : await apiJson<{ software: SoftwareRecord }>('/api/software', 'POST', payload)
      setSoftware((current) => editingId ? current.map((item) => item.id === editingId ? result.software : item) : [result.software, ...current])
      setOpen(false)
      setEditingId('')
      setName('')
      setSlug('')
      setDescription('')
      setVersion('1.0.0')
      setArchitecture('Universal')
      notify(editingId ? '软件资料已更新' : '软件产品已保存到数据库')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '软件产品保存失败', 'info')
    } finally {
      setSaving(false)
    }
  }

  function openCreate() {
    setEditingId('')
    setName('')
    setSlug('')
    setDescription('')
    setPlatform('Windows')
    setArchitecture('Universal')
    setVersion('1.0.0')
    setStatus('draft')
    setOpen(true)
  }

  function openEdit(item: SoftwareRecord) {
    setEditingId(item.id)
    setName(item.name)
    setSlug(item.slug)
    setDescription(item.description)
    setPlatform(item.platform)
    setArchitecture(item.architecture)
    setVersion(item.version)
    setStatus(item.status)
    setOpen(true)
  }

  async function toggleStatus(item: SoftwareRecord) {
    const nextStatus: SoftwareRecord['status'] = item.status === 'published' ? 'draft' : 'published'
    try {
      const result = await apiJson<{ software: SoftwareRecord }>(`/api/software/${encodeURIComponent(item.id)}`, 'PUT', { status: nextStatus })
      setSoftware((current) => current.map((entry) => entry.id === item.id ? result.software : entry))
      notify(nextStatus === 'published' ? '软件已上架' : '软件已下架')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '软件状态更新失败', 'info')
    }
  }

  async function removeSoftware(item: SoftwareRecord) {
    if (!window.confirm(`确定删除软件“${item.name}”吗？只有未关联安装包的软件才能彻底删除。`)) return
    try {
      await apiJson(`/api/software/${encodeURIComponent(item.id)}`, 'DELETE')
      setSoftware((current) => current.filter((entry) => entry.id !== item.id))
      notify('软件产品已删除', 'info')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '软件删除失败', 'info')
    }
  }

  return (
    <div className="page-stack">
      <section className="panel software-overview">
        <div><span className="overline">Software catalog</span><h2>管理软件、版本与发布节奏。</h2><p>每个产品可以拥有多个平台、架构、正式版和测试版安装包。</p></div>
        <div className="software-overview-stats"><span><strong>{software.length}</strong>软件产品</span><span><strong>{software.reduce((sum, item) => sum + item.downloads, 0).toLocaleString()}</strong>累计下载</span></div>
      </section>

      <section className="panel table-panel">
        <div className="toolbar">
          <div className="toolbar-copy"><span className="overline">Products</span><h2>软件列表</h2></div>
          <div className="toolbar-actions"><label className="search-control"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索软件…" /></label>{canManage ? <button className="button button--primary" onClick={openCreate}><Plus /> 添加软件</button> : null}</div>
        </div>
        <div className="software-list">
          {filtered.map((item) => (
            <article className="software-row" key={item.id}>
              <div className="software-monogram">{item.accent}</div>
              <div className="software-primary"><span className="overline">{item.platform}</span><h3>{item.name}</h3><p>{item.description}</p></div>
              <div className="software-version"><small>当前版本</small><strong>v{item.version}</strong><span>{item.architecture}</span></div>
              <div className="software-downloads"><small>累计下载</small><strong><Download /> {item.downloads.toLocaleString()}</strong><span>{item.size}</span></div>
              <span className="content-status" data-status={item.status}>{statusLabels[item.status]}</span>
              {canManage ? <div className="row-actions"><button aria-label="编辑软件" title="编辑软件" type="button" onClick={() => openEdit(item)}><Edit3 /></button><button aria-label={item.status === 'published' ? '下架软件' : '上架软件'} title={item.status === 'published' ? '下架软件' : '上架软件'} type="button" onClick={() => void toggleStatus(item)}>{item.status === 'published' ? <PauseCircle /> : <PlayCircle />}</button><button className="danger-icon" aria-label="删除软件" title="删除软件" type="button" onClick={() => void removeSoftware(item)}><Trash2 /></button></div> : null}
            </article>
          ))}
        </div>
      </section>

      <Modal open={open} onClose={() => setOpen(false)} eyebrow={editingId ? 'Edit product' : 'New product'} title={editingId ? '编辑软件产品' : '添加软件产品'} footer={<><button className="button button--secondary" type="button" onClick={() => setOpen(false)}>取消</button><button className="button button--primary" type="submit" form="software-create-form" disabled={saving}><Check /> {saving ? '保存中…' : '保存软件'}</button></>}>
        <form id="software-create-form" className="form-stack" onSubmit={save}>
          <div className="field-grid"><label className="field"><span>软件名称</span><input value={name} onChange={(event) => { setName(event.target.value); if (!slug) setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) }} placeholder="输入软件名称" required /></label><label className="field"><span>软件标识</span><input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="product-slug" required /></label></div>
          <label className="field"><span>软件简介</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="简要介绍软件用途和特点" rows={4} /></label>
          <div className="field-grid">{!editingId ? <label className="field"><span>首发平台</span><select value={platform} onChange={(event) => setPlatform(event.target.value)}><option>Windows</option><option>macOS</option><option>Android</option><option>Linux</option></select></label> : null}<label className="field"><span>架构说明</span><input value={architecture} onChange={(event) => setArchitecture(event.target.value)} placeholder="x64 / ARM64" /></label></div>
          <div className="field-grid">{!editingId ? <label className="field"><span>初始版本</span><input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="1.0.0" required /></label> : null}<label className="field"><span>产品状态</span><select value={status} onChange={(event) => setStatus(event.target.value as SoftwareRecord['status'])}><option value="draft">草稿</option><option value="testing">测试中</option><option value="published" disabled={!editingId}>已发布</option></select><small>{editingId ? '上架前必须存在已发布版本及可用安装包。' : '新软件需先保存，再配置版本和安装包。'}</small></label></div>
          <div className="form-note"><ShieldCheck /><div><strong>版本与安装包独立管理</strong><span>{editingId ? '版本号、发布通道和更新说明请在“版本管理”中维护。' : '创建产品后，在“版本管理”维护发布，再上传各平台安装包。'}</span></div></div>
        </form>
      </Modal>
    </div>
  )
}
