import { ArrowLeft, ArrowRight, Box, Check, Download, Edit3, FileArchive, PauseCircle, PlayCircle, Plus, Search, Trash2 } from 'lucide-react'
import { FormEvent, useEffect, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { PackageRecord, SoftwareRecord, SoftwareVersionRecord, StorageStatus } from '../../types'
import { Modal } from '../../components/Modal'
import { useToast } from '../../contexts/ToastContext'
import { useAuth } from '../../contexts/AuthContext'
import { apiJson, apiRequest } from '../../lib/api'
import { PackagesPage } from './PackagesPage'
import { VersionsPage } from './VersionsPage'

const statusLabels = { published: '公开展示', draft: '草稿', testing: '内部测试' }

type SoftwarePageProps = {
  software: SoftwareRecord[]
  setSoftware: Dispatch<SetStateAction<SoftwareRecord[]>>
  packages: PackageRecord[]
  setPackages: Dispatch<SetStateAction<PackageRecord[]>>
  storage: StorageStatus
}

export function SoftwarePage({ software, setSoftware, packages, setPackages, storage }: SoftwarePageProps) {
  const { softwareId: routeSoftwareId } = useParams()
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [name, setName] = useState('')
  const [slug, setSlug] = useState('')
  const [description, setDescription] = useState('')
  const [status, setStatus] = useState<SoftwareRecord['status']>('draft')
  const [saving, setSaving] = useState(false)
  const [managedVersion, setManagedVersion] = useState<SoftwareVersionRecord | null>(null)
  const [releaseRevision, setReleaseRevision] = useState(0)
  const { notify, confirm } = useToast()
  const { admin } = useAuth()
  const canManage = Boolean(admin?.permissions.includes('content.manage'))
  const activeSoftware = software.find((item) => item.id === routeSoftwareId)
  const activePackages = activeSoftware ? packages.filter((item) => item.softwareId === activeSoftware.id) : []
  const filtered = useMemo(() => software.filter((item) => `${item.name} ${item.slug} ${item.description}`.toLowerCase().includes(query.toLowerCase())), [query, software])

  useEffect(() => { setManagedVersion(null) }, [routeSoftwareId])

  async function refreshSoftware() {
    try {
      const result = await apiRequest<{ software: SoftwareRecord[] }>('/api/software')
      setSoftware(result.software)
    } catch {
      // The current view remains usable; the next bootstrap will reconcile aggregates.
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      const payload = editingId ? { name, description, status } : { name, slug, description, status: 'draft' }
      const result = editingId
        ? await apiJson<{ software: SoftwareRecord }>(`/api/software/${encodeURIComponent(editingId)}`, 'PUT', payload)
        : await apiJson<{ software: SoftwareRecord }>('/api/software', 'POST', payload)
      setSoftware((current) => editingId ? current.map((item) => item.id === editingId ? result.software : item) : [result.software, ...current])
      setOpen(false)
      setEditingId('')
      notify(editingId ? '软件资料已更新' : '软件已创建，现在可以建立首个版本')
      if (!editingId) navigate(`/software/${result.software.id}`)
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
    setStatus('draft')
    setOpen(true)
  }

  function openEdit(item: SoftwareRecord) {
    setEditingId(item.id)
    setName(item.name)
    setSlug(item.slug)
    setDescription(item.description)
    setStatus(item.status)
    setOpen(true)
  }

  async function toggleStatus(item: SoftwareRecord) {
    const nextStatus: SoftwareRecord['status'] = item.status === 'published' ? 'draft' : 'published'
    try {
      const result = await apiJson<{ software: SoftwareRecord }>(`/api/software/${encodeURIComponent(item.id)}`, 'PUT', { status: nextStatus })
      setSoftware((current) => current.map((entry) => entry.id === item.id ? result.software : entry))
      notify(nextStatus === 'published' ? '软件已公开展示' : '软件已转为草稿')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '软件状态更新失败', 'info')
    }
  }

  async function removeSoftware(item: SoftwareRecord) {
    if (!await confirm({ title: '删除软件', message: `确定删除软件“${item.name}”吗？有关联安装包时系统会阻止删除。`, confirmLabel: '删除软件', tone: 'danger' })) return
    try {
      await apiJson(`/api/software/${encodeURIComponent(item.id)}`, 'DELETE')
      setSoftware((current) => current.filter((entry) => entry.id !== item.id))
      if (routeSoftwareId === item.id) navigate('/software')
      notify('软件产品已删除', 'info')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '软件删除失败', 'info')
    }
  }

  function managePackages(version: SoftwareVersionRecord) {
    setManagedVersion(version)
    requestAnimationFrame(() => document.getElementById('software-package-library')?.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }

  if (routeSoftwareId && !activeSoftware) {
    return <section className="panel table-empty"><Box /><strong>软件不存在或已被删除</strong><button className="button button--secondary" type="button" onClick={() => navigate('/software')}>返回软件列表</button></section>
  }

  return (
    <div className="page-stack software-release-workspace">
      {activeSoftware ? <>
        <section className="panel release-product-hero">
          <div className="release-product-heading">
            <button className="release-back" type="button" onClick={() => navigate('/software')}><ArrowLeft /> 软件列表</button>
            <div className="release-product-title"><span className="software-monogram">{activeSoftware.accent}</span><div><span className="overline">01 · Product</span><h2>{activeSoftware.name}</h2><p>{activeSoftware.description || '尚未填写软件简介。'}</p></div></div>
          </div>
          <div className="release-product-actions"><span className="content-status" data-status={activeSoftware.status}>{statusLabels[activeSoftware.status]}</span>{canManage ? <><button className="button button--secondary" type="button" onClick={() => openEdit(activeSoftware)}><Edit3 /> 编辑资料</button><button className="button button--primary" type="button" onClick={() => void toggleStatus(activeSoftware)}>{activeSoftware.status === 'published' ? <PauseCircle /> : <PlayCircle />}{activeSoftware.status === 'published' ? '停止公开' : '公开软件'}</button></> : null}</div>
          <div className="release-product-stats"><span><small>推荐版本</small><strong>{activeSoftware.version ? `v${activeSoftware.version}` : '尚未发布'}</strong></span><span><small>安装包</small><strong>{activePackages.length}</strong></span><span><small>累计下载</small><strong>{activeSoftware.downloads.toLocaleString()}</strong></span><span><small>存储</small><strong>{storage.configured ? '正常' : '待配置'}</strong></span></div>
          <ol className="release-flow"><li className="is-complete"><span>1</span><div><strong>软件资料</strong><small>已创建</small></div></li><li className={activePackages.length ? 'is-complete' : ''}><span>2</span><div><strong>版本与安装包</strong><small>{activePackages.length ? '已有交付文件' : '等待配置'}</small></div></li><li className={activeSoftware.status === 'published' ? 'is-complete' : ''}><span>3</span><div><strong>公开发布</strong><small>{activeSoftware.status === 'published' ? '访客可见' : '尚未公开'}</small></div></li></ol>
        </section>

        <VersionsPage software={[activeSoftware]} lockedSoftwareId={activeSoftware.id} embedded refreshKey={releaseRevision} onChanged={() => { setManagedVersion(null); void refreshSoftware() }} onManagePackages={managePackages} />
        <PackagesPage packages={packages} setPackages={setPackages} software={[activeSoftware]} storage={storage} lockedSoftwareId={activeSoftware.id} lockedVersion={managedVersion} embedded onClearVersion={() => setManagedVersion(null)} onChanged={() => { setReleaseRevision((current) => current + 1); void refreshSoftware() }} />
      </> : <>
        <section className="panel software-overview">
          <div><span className="overline">Software delivery</span><h2>一个入口完成软件发布。</h2><p>选择软件后，按版本组织更新说明和各平台安装包，再统一公开。</p></div>
          <div className="software-overview-stats"><span><strong>{software.length}</strong>软件产品</span><span><strong>{software.reduce((sum, item) => sum + item.downloads, 0).toLocaleString()}</strong>累计下载</span></div>
        </section>

        <section className="panel table-panel">
          <div className="toolbar"><div className="toolbar-copy"><span className="overline">Products</span><h2>软件产品</h2><p>进入产品后管理版本、安装包和公开状态。</p></div><div className="toolbar-actions"><label className="search-control"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索软件…" /></label>{canManage ? <button className="button button--primary" onClick={openCreate}><Plus /> 创建软件</button> : null}</div></div>
          <div className="software-list">{filtered.map((item) => {
            const packageCount = packages.filter((entry) => entry.softwareId === item.id).length
            return <article className="software-row" key={item.id}><div className="software-monogram">{item.accent}</div><div className="software-primary"><span className="overline">/{item.slug}</span><h3>{item.name}</h3><p>{item.description || '尚未填写软件简介'}</p></div><div className="software-version"><small>推荐版本</small><strong>{item.version ? `v${item.version}` : '尚未发布'}</strong><span>{packageCount} 个安装包</span></div><div className="software-downloads"><small>累计下载</small><strong><Download /> {item.downloads.toLocaleString()}</strong><span>{item.platform || '暂无平台'}</span></div><span className="content-status" data-status={item.status}>{statusLabels[item.status]}</span><div className="row-actions"><button className="release-manage-button" type="button" onClick={() => navigate(`/software/${item.id}`)}>管理发布 <ArrowRight /></button>{canManage ? <><button aria-label="编辑软件" title="编辑软件" type="button" onClick={() => openEdit(item)}><Edit3 /></button><button className="danger-icon" aria-label="删除软件" title="删除软件" type="button" onClick={() => void removeSoftware(item)}><Trash2 /></button></> : null}</div></article>
          })}</div>
          {!filtered.length ? <div className="table-empty"><FileArchive /><strong>还没有软件产品</strong><span>创建软件后，再添加版本和安装包。</span></div> : null}
        </section>
      </>}

      <Modal open={open} onClose={() => setOpen(false)} eyebrow={editingId ? 'Edit product' : 'New product'} title={editingId ? '编辑软件资料' : '创建软件'} footer={<><button className="button button--secondary" type="button" onClick={() => setOpen(false)}>取消</button><button className="button button--primary" type="submit" form="software-create-form" disabled={saving}><Check /> {saving ? '保存中…' : editingId ? '保存修改' : '创建并配置版本'}</button></>}>
        <form id="software-create-form" className="form-stack" onSubmit={save}>
          <div className="field-grid"><label className="field"><span>软件名称</span><input value={name} onChange={(event) => { setName(event.target.value); if (!editingId && !slug) setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')) }} placeholder="输入软件名称" required /></label>{!editingId ? <label className="field"><span>软件标识</span><input value={slug} onChange={(event) => setSlug(event.target.value)} placeholder="product-slug" required /><small>用于公开下载页地址，创建后保持不变。</small></label> : null}</div>
          <label className="field"><span>软件简介</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="简要介绍软件用途和特点" rows={4} /></label>
          {editingId ? <label className="field"><span>公开状态</span><select value={status} onChange={(event) => setStatus(event.target.value as SoftwareRecord['status'])}><option value="draft">草稿</option><option value="testing">内部测试</option><option value="published">公开展示</option></select><small>公开展示前必须至少有一个已发布版本和可用安装包。</small></label> : <p className="form-help">软件会先保存为草稿。进入详情后创建版本、上传安装包，再执行公开发布。</p>}
        </form>
      </Modal>
    </div>
  )
}
