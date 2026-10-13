import { ArchiveRestore, Check, Eye, FileArchive, FileCode2, Globe2, Plus, Trash2, UploadCloud } from 'lucide-react'
import { ChangeEvent, FormEvent, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { DomainRecord, SiteRecord, SiteVersionRecord } from '../../types'
import { Modal } from '../../components/Modal'
import { useToast } from '../../contexts/ToastContext'
import { useAuth } from '../../contexts/AuthContext'
import { apiJson, apiRequest, csrfHeaders } from '../../lib/api'
import { apiUrl } from '../../lib/appUrls'

const siteStatus = { published: '已发布', draft: '草稿', offline: '已下线' }

export function SitesPage({ sites, setSites, domains }: { sites: SiteRecord[]; setSites: Dispatch<SetStateAction<SiteRecord[]>>; domains: DomainRecord[] }) {
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState('')
  const [editingMetaId, setEditingMetaId] = useState('')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('静态网站')
  const [status, setStatus] = useState<SiteRecord['status']>('draft')
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [historySite, setHistorySite] = useState<SiteRecord | null>(null)
  const [versions, setVersions] = useState<SiteVersionRecord[]>([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [siteFilter, setSiteFilter] = useState<'all' | SiteRecord['status']>('all')
  const { notify } = useToast()
  const { admin } = useAuth()
  const canManage = Boolean(admin?.permissions.includes('content.manage'))
  const filteredSites = siteFilter === 'all' ? sites : sites.filter((site) => site.status === siteFilter)

  function chooseFile(event: ChangeEvent<HTMLInputElement>) {
    setSelectedFile(event.target.files?.[0] ?? null)
  }

  function closeModal() {
    if (saving) return
    setOpen(false)
    setEditingId('')
    setEditingMetaId('')
    setName('')
    setCategory('静态网站')
    setStatus('draft')
    setSelectedFile(null)
  }

  function openCreate() {
    setEditingId('')
    setEditingMetaId('')
    setName('')
    setCategory('静态网站')
    setStatus('draft')
    setSelectedFile(null)
    setOpen(true)
  }

  function openPublish(site: SiteRecord) {
    setEditingId(site.id)
    setEditingMetaId('')
    setName(site.name)
    setCategory(site.category)
    setStatus(site.status)
    setSelectedFile(null)
    setOpen(true)
  }

  function openEdit(site: SiteRecord) {
    setEditingId('')
    setEditingMetaId(site.id)
    setName(site.name)
    setCategory(site.category)
    setStatus(site.status)
    setSelectedFile(null)
    setOpen(true)
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    let siteId = editingId
    try {
      if (!siteId) {
        if (editingMetaId) {
          const boundDomains = domains.filter((domainItem) => domainItem.mode === 'site' && domainItem.target === editingMetaId)
          if (status !== 'published' && boundDomains.length && !window.confirm(`此网站当前绑定 ${boundDomains.length} 个域名（${boundDomains.map((item) => item.hostname).join('、')}）。继续后这些入口将不再展示网站，确定吗？`)) return
          const updated = await apiJson<{ site: SiteRecord }>(`/api/sites/${encodeURIComponent(editingMetaId)}`, 'PUT', { name, category, status })
          setSites((current) => current.map((item) => item.id === editingMetaId ? updated.site : item))
          setOpen(false)
          setEditingMetaId('')
          notify('静态网站资料已更新')
          return
        }
        const created = await apiJson<{ site: SiteRecord }>('/api/sites', 'POST', { name, category })
        siteId = created.site.id
        setSites((current) => [created.site, ...current])
      }
      if (selectedFile) {
        const query = new URLSearchParams({ fileName: selectedFile.name })
        const response = await fetch(apiUrl(`/api/sites/${encodeURIComponent(siteId)}/publish?${query}`), {
          method: 'POST', credentials: 'include', headers: csrfHeaders({ 'Content-Type': 'application/zip' }), body: selectedFile,
        })
        const result = await response.json() as { site?: SiteRecord; error?: string }
        if (!response.ok || !result.site) throw new Error(result.error || '网站发布失败')
        setSites((current) => current.map((item) => item.id === siteId ? result.site! : item))
        notify('ZIP 已通过安全检查，静态网站发布成功')
      } else {
        notify('静态网站草稿已创建，请上传 ZIP 后发布')
      }
      setOpen(false)
      setEditingId('')
      setEditingMetaId('')
      setName('')
      setSelectedFile(null)
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '网站保存失败', 'info')
    } finally {
      setSaving(false)
    }
  }

  async function removeSite(site: SiteRecord) {
    const boundDomains = domains.filter((domainItem) => domainItem.mode === 'site' && domainItem.target === site.id)
    if (boundDomains.length) return notify(`请先在域名管理中解除绑定：${boundDomains.map((item) => item.hostname).join('、')}`, 'info')
    if (!window.confirm(`确定删除“${site.name}”及其所有发布版本吗？文件和历史版本会一并清除，此操作无法撤销。`)) return
    try {
      await apiJson(`/api/sites/${encodeURIComponent(site.id)}`, 'DELETE')
      setSites((current) => current.filter((item) => item.id !== site.id))
      notify('静态网站及发布版本已删除', 'info')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '网站删除失败', 'info')
    }
  }

  async function toggleSite(site: SiteRecord) {
    const nextStatus: SiteRecord['status'] = site.status === 'offline' ? (site.currentVersionId ? 'published' : 'draft') : 'offline'
    const boundDomains = domains.filter((domainItem) => domainItem.mode === 'site' && domainItem.target === site.id)
    if (nextStatus === 'offline' && boundDomains.length && !window.confirm(`下线后 ${boundDomains.map((item) => item.hostname).join('、')} 将停止展示此网站。确定继续吗？`)) return
    try {
      const result = await apiJson<{ site: SiteRecord }>(`/api/sites/${encodeURIComponent(site.id)}`, 'PUT', { status: nextStatus })
      setSites((current) => current.map((item) => item.id === site.id ? result.site : item))
      notify(nextStatus === 'offline' ? '网站已下线' : '网站已恢复上线')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '网站状态更新失败', 'info')
    }
  }

  async function openHistory(site: SiteRecord) {
    setHistorySite(site)
    setHistoryLoading(true)
    try {
      const result = await apiRequest<{ versions: SiteVersionRecord[] }>(`/api/sites/${encodeURIComponent(site.id)}/versions`)
      setVersions(result.versions)
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '版本历史读取失败', 'info')
    } finally {
      setHistoryLoading(false)
    }
  }

  async function rollback(version: SiteVersionRecord) {
    if (!historySite || !window.confirm(`确定回滚到 ${new Date(version.createdAt).toLocaleString('zh-CN')} 的版本吗？`)) return
    setHistoryLoading(true)
    try {
      const result = await apiJson<{ site: SiteRecord }>(`/api/sites/${encodeURIComponent(historySite.id)}/rollback`, 'POST', { versionId: version.id })
      setSites((current) => current.map((item) => item.id === result.site.id ? result.site : item))
      setHistorySite(result.site)
      notify('网站已回滚到所选版本')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '版本回滚失败', 'info')
    } finally {
      setHistoryLoading(false)
    }
  }

  return (
    <div className="page-stack">
      <section className="content-toolbar">
        <div className="filter-tabs"><button className={siteFilter === 'all' ? 'is-active' : ''} onClick={() => setSiteFilter('all')}>全部网站 <span>{sites.length}</span></button><button className={siteFilter === 'published' ? 'is-active' : ''} onClick={() => setSiteFilter('published')}>已发布 <span>{sites.filter((site) => site.status === 'published').length}</span></button><button className={siteFilter === 'draft' ? 'is-active' : ''} onClick={() => setSiteFilter('draft')}>草稿 <span>{sites.filter((site) => site.status === 'draft').length}</span></button><button className={siteFilter === 'offline' ? 'is-active' : ''} onClick={() => setSiteFilter('offline')}>已下线 <span>{sites.filter((site) => site.status === 'offline').length}</span></button></div>
        {canManage ? <button className="button button--primary" onClick={openCreate}><Plus /> 创建网站</button> : null}
      </section>

      <section className="site-grid">
        {filteredSites.map((site, index) => {
          const boundHostnames = domains.filter((domainItem) => domainItem.mode === 'site' && domainItem.target === site.id).map((domainItem) => domainItem.hostname)
          return (
          <article className="panel site-card" key={site.id}>
            <div className={`site-preview site-preview--${(index % 3) + 1}`}>
              <div className="site-preview-browser"><span /><span /><span /></div>
              <div className="site-preview-art"><i /><b /><em /></div>
              <span className="site-status" data-status={site.status}>{siteStatus[site.status]}</span>
            </div>
            <div className="site-card-body">
              <div className="site-title-row"><div><span className="overline">{site.category}</span><h2>{site.name}</h2></div>{canManage ? <div className="row-actions"><button className="icon-button" aria-label="编辑网站" title="编辑网站" onClick={() => openEdit(site)}><FileCode2 /></button><button className="icon-button danger-icon" aria-label="删除网站" title="删除网站" onClick={() => void removeSite(site)}><Trash2 /></button></div> : null}</div>
              <p><Globe2 /> {boundHostnames.join('、') || '等待绑定域名'}</p>
              <div className="site-card-meta"><span>{site.visits.toLocaleString()} 次访问</span><span>{site.currentVersionId ? '已有发布版本' : '尚未发布'}</span></div>
              <div className="site-card-actions"><button className="button button--secondary" disabled={!site.currentVersionId || site.status === 'offline'} onClick={() => window.open(apiUrl(`/preview/${site.id}/`), '_blank', 'noopener,noreferrer')}><Eye /> 预览</button>{canManage ? <button className="button button--secondary" onClick={() => openPublish(site)}><FileCode2 /> 发布</button> : null}<button className="button button--secondary" disabled={!site.currentVersionId} onClick={() => void openHistory(site)}><ArchiveRestore /> 版本</button>{canManage ? <button className="button button--secondary" onClick={() => void toggleSite(site)}>{site.status === 'offline' ? '恢复上线' : '下线'}</button> : null}</div>
            </div>
          </article>
        )})}

        {canManage ? <button className="new-site-card" type="button" onClick={openCreate}>
          <span><Plus /></span><strong>创建新网站</strong><small>上传 ZIP 或先创建空白项目</small>
        </button> : null}
      </section>
      {!filteredSites.length ? <div className="table-empty"><FileArchive /><strong>当前分类没有网站</strong><span>切换分类或创建新的静态网站项目。</span></div> : null}

      <section className="panel publishing-note"><ArchiveRestore /><div><strong>安全发布与版本回滚</strong><span>每次 ZIP 发布都会生成独立版本并保存 SHA-256，可通过接口恢复历史版本。</span></div></section>

      <Modal open={open} onClose={closeModal} eyebrow="Static website" title={editingId ? '发布网站新版本' : editingMetaId ? '编辑网站资料' : '创建静态网站'} footer={<><button className="button button--secondary" type="button" onClick={closeModal}>取消</button><button className="button button--primary" type="submit" form="site-publish-form" disabled={saving}><Check /> {saving ? '保存中…' : editingId ? '发布新版本' : editingMetaId ? '保存资料' : '创建项目'}</button></>}>
        <form id="site-publish-form" className="form-stack" onSubmit={save}>
          <label className="field"><span>网站名称</span><input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：周年纪念页面" disabled={Boolean(editingId)} required /></label>
          {!editingId ? <label className="field"><span>网站分类</span><input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="例如：表白页面" /></label> : null}
          {editingMetaId ? <><div className="form-note"><Globe2 /><div><strong>域名绑定由域名管理统一维护</strong><span>将域名运行模式设为“静态网站”，再选择当前网站即可完成绑定。</span></div></div><label className="field"><span>网站状态</span><select value={status} onChange={(event) => setStatus(event.target.value as SiteRecord['status'])}><option value="published" disabled={!sites.find((item) => item.id === editingMetaId)?.currentVersionId}>已发布</option><option value="draft">草稿</option><option value="offline">已下线</option></select></label></> : null}
          {!editingMetaId ? <label className="upload-zone">
            <input type="file" accept=".zip,application/zip" onChange={chooseFile} />
            {selectedFile ? <><FileArchive /><strong>{selectedFile.name}</strong><span>{(selectedFile.size / 1024 / 1024).toFixed(2)} MB · 等待安全检查</span></> : <><UploadCloud /><strong>上传网站 ZIP</strong><span>拖放文件到这里，或点击选择文件</span><small>根目录必须包含 index.html，压缩包最大 50 MB</small></>}
          </label> : null}
          {!editingMetaId ? <div className="form-note"><FileCode2 /><div><strong>上传安全检查已启用</strong><span>系统会拦截路径穿越、符号链接、危险安装文件、超量文件和 ZIP 解压炸弹。</span></div></div> : null}
        </form>
      </Modal>

      <Modal open={Boolean(historySite)} onClose={() => { if (!historyLoading) { setHistorySite(null); setVersions([]) } }} eyebrow="Release history" title={`${historySite?.name || ''} · 版本历史`} footer={<button className="button button--secondary" type="button" onClick={() => { setHistorySite(null); setVersions([]) }}>关闭</button>}>
        <div className="version-list">
          {versions.map((version, index) => <article className={historySite?.currentVersionId === version.id ? 'version-item is-current' : 'version-item'} key={version.id}><div className="version-index">{String(versions.length - index).padStart(2, '0')}</div><div><strong>{version.sourceName}</strong><span>{new Date(version.createdAt).toLocaleString('zh-CN')} · {version.fileCount} 个文件 · {(version.byteSize / 1024 / 1024).toFixed(2)} MB</span><small>SHA-256 · {version.sha256.slice(0, 20)}…</small></div>{historySite?.currentVersionId === version.id ? <em>当前版本</em> : canManage ? <button className="button button--secondary" type="button" disabled={historyLoading} onClick={() => void rollback(version)}>回滚</button> : null}</article>)}
          {!historyLoading && versions.length === 0 ? <div className="table-empty"><ArchiveRestore /><strong>暂无发布版本</strong><span>上传网站 ZIP 后会在这里生成版本记录。</span></div> : null}
          {historyLoading ? <div className="version-loading">正在读取版本记录…</div> : null}
        </div>
      </Modal>
    </div>
  )
}
