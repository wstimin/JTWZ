import { CheckCircle2, Cloud, Copy, FileArchive, PauseCircle, Pencil, PlayCircle, Plus, Search, Trash2, UploadCloud } from 'lucide-react'
import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { PackageRecord, SoftwareRecord, StorageStatus } from '../../types'
import { Modal } from '../../components/Modal'
import { useToast } from '../../contexts/ToastContext'
import { useAuth } from '../../contexts/AuthContext'
import { apiJson, apiRequest, csrfHeaders } from '../../lib/api'
import { apiUrl } from '../../lib/appUrls'
import { sha256File } from '../../lib/sha256'

const packageStatus = { available: '可下载', paused: '已暂停', processing: '处理中' }

type ResumableSession = {
  id: string
  fileName: string
  softwareId: string
  version: string
  platform: string
  totalBytes: number
  totalChunks: number
  receivedChunks: number[]
  progress: number
  status: 'uploading' | 'paused' | 'failed'
  updatedAt: string
}

export function PackagesPage({ packages, setPackages, software, setSoftware, storage }: { packages: PackageRecord[]; setPackages: Dispatch<SetStateAction<PackageRecord[]>>; software: SoftwareRecord[]; setSoftware: Dispatch<SetStateAction<SoftwareRecord[]>>; storage: StorageStatus }) {
  const [open, setOpen] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [softwareId, setSoftwareId] = useState(software[0]?.id || '')
  const [version, setVersion] = useState('')
  const [platform, setPlatform] = useState('Windows')
  const [architecture, setArchitecture] = useState('x64')
  const [query, setQuery] = useState('')
  const [uploading, setUploading] = useState(false)
  const [editing, setEditing] = useState<PackageRecord | null>(null)
  const [editPlatform, setEditPlatform] = useState('')
  const [editReleaseNotes, setEditReleaseNotes] = useState('')
  const [saving, setSaving] = useState(false)
  const [resumableSessions, setResumableSessions] = useState<ResumableSession[]>([])
  const [activeUploadId, setActiveUploadId] = useState('')
  const [uploadProgress, setUploadProgress] = useState(0)
  const pauseRequested = useRef(false)
  const { notify, confirm } = useToast()
  const { admin } = useAuth()
  const canManage = Boolean(admin?.permissions.includes('content.manage'))

  useEffect(() => {
    if (!softwareId && software[0]) setSoftwareId(software[0].id)
  }, [software, softwareId])

  async function loadResumableSessions() {
    if (storage.provider !== 'local') return
    try {
      const result = await apiRequest<{ sessions: ResumableSession[] }>('/api/packages/resumable-sessions')
      setResumableSessions(result.sessions)
    } catch {
      setResumableSessions([])
    }
  }

  useEffect(() => { void loadResumableSessions() }, [storage.provider])

  const filtered = useMemo(() => packages.filter((item) => `${item.fileName} ${item.software} ${item.platform}`.toLowerCase().includes(query.toLowerCase())), [packages, query])
  const fileSelected = (event: ChangeEvent<HTMLInputElement>) => setFile(event.target.files?.[0] ?? null)

  async function upload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!file) return notify('请先选择安装包文件', 'info')
    setUploading(true)
    try {
      const sha256 = await sha256File(file)
      if (storage.provider === 's3' && file.size > 8 * 1024 * 1024) {
        const multipart = await apiJson<{ packageId: string; uploadId: string; partSize: number; totalParts: number }>('/api/packages/multipart-intent', 'POST', {
          fileName: file.name, softwareId, version, platform: `${platform} ${architecture}`, contentType: file.type || 'application/octet-stream', totalBytes: file.size, sha256,
        })
        const parts: Array<{ partNumber: number; etag: string }> = []
        for (let index = 0; index < multipart.totalParts; index += 1) {
          const partNumber = index + 1
          const signed = await apiRequest<{ upload: { url: string; headers: Record<string, string> } }>(`/api/packages/${encodeURIComponent(multipart.packageId)}/multipart/${encodeURIComponent(multipart.uploadId)}/parts/${partNumber}`)
          const chunk = file.slice(index * multipart.partSize, Math.min(file.size, (index + 1) * multipart.partSize))
          const response = await fetch(apiUrl(signed.upload.url), { method: 'PUT', headers: signed.upload.headers, body: chunk })
          if (!response.ok) throw new Error(`第 ${partNumber} 个云端分片上传失败`)
          const etag = response.headers.get('etag')
          if (!etag) throw new Error(`第 ${partNumber} 个云端分片缺少 ETag`) 
          parts.push({ partNumber, etag })
        }
        const result = await apiRequest<{ package?: PackageRecord }>(`/api/packages/${encodeURIComponent(multipart.packageId)}/multipart/${encodeURIComponent(multipart.uploadId)}/complete`, { method: 'POST', body: JSON.stringify({ parts }), headers: { 'Content-Type': 'application/json' } })
        if (!result.package) throw new Error('云端分片合并后元数据保存失败')
        setPackages((current) => [result.package!, ...current])
        setSoftware((current) => current.map((item) => item.id === result.package!.softwareId ? { ...item, version: result.package!.version, size: result.package!.size, downloadUrl: result.package!.downloadUrl } : item))
        setOpen(false)
        setFile(null)
        setVersion('')
        notify('安装包已通过云端 multipart 分片上传完成')
        return
      }
      if (storage.provider === 'local' && file.size > 8 * 1024 * 1024) {
        const previous = activeUploadId ? resumableSessions.find((item) => item.id === activeUploadId) : undefined
        if (previous && (previous.fileName !== file.name || previous.totalBytes !== file.size)) throw new Error(`请选择原文件 ${previous.fileName}（${(previous.totalBytes / 1024 / 1024).toFixed(2)} MB）继续上传`)
        const resumable = previous
          ? await apiJson<{ uploadId: string; chunkSize: number; totalChunks: number; receivedChunks: number[] }>(`/api/packages/resumable/${encodeURIComponent(previous.id)}/resume`, 'POST')
          : await apiJson<{ uploadId: string; chunkSize: number; totalChunks: number; receivedChunks: number[] }>('/api/packages/resumable-intent', 'POST', {
            fileName: file.name, softwareId, version, platform: `${platform} ${architecture}`, contentType: file.type || 'application/octet-stream', totalBytes: file.size,
          })
        setActiveUploadId(resumable.uploadId)
        pauseRequested.current = false
        const completedChunks = new Set(resumable.receivedChunks || [])
        for (let index = 0; index < resumable.totalChunks; index += 1) {
          if (completedChunks.has(index)) continue
          const start = index * resumable.chunkSize
          const chunk = file.slice(start, Math.min(file.size, start + resumable.chunkSize))
          const response = await fetch(apiUrl(`/api/packages/resumable/${encodeURIComponent(resumable.uploadId)}/chunks/${index}`), { method: 'PUT', credentials: 'include', headers: csrfHeaders({ 'Content-Type': 'application/octet-stream' }), body: chunk })
          if (!response.ok) throw new Error(`第 ${index + 1} 个分片上传失败`)
          completedChunks.add(index)
          setUploadProgress(Math.round(completedChunks.size / resumable.totalChunks * 100))
          if (pauseRequested.current) {
            await apiJson(`/api/packages/resumable/${encodeURIComponent(resumable.uploadId)}/pause`, 'POST')
            await loadResumableSessions()
            notify(`上传已暂停在 ${completedChunks.size}/${resumable.totalChunks} 个分片，可稍后继续`, 'info')
            return
          }
        }
        const result = await apiRequest<{ package?: PackageRecord }>(`/api/packages/resumable/${encodeURIComponent(resumable.uploadId)}/complete`, { method: 'POST' })
        if (!result.package) throw new Error('分片上传完成但元数据保存失败')
        setPackages((current) => [result.package!, ...current])
        setSoftware((current) => current.map((item) => item.id === result.package!.softwareId ? { ...item, version: result.package!.version, size: result.package!.size, downloadUrl: result.package!.downloadUrl } : item))
        setOpen(false)
        setFile(null)
        setVersion('')
        setActiveUploadId('')
        setUploadProgress(0)
        await loadResumableSessions()
        notify('安装包已通过分片续传完成上传')
        return
      }
      const intent = await apiJson<{ packageId: string; upload: { provider: string; url: string; headers: Record<string, string> } }>('/api/packages/upload-intent', 'POST', {
        fileName: file.name, softwareId, version, platform: `${platform} ${architecture}`, contentType: file.type || 'application/octet-stream', byteSize: file.size, sha256,
      })
      const uploadResponse = await fetch(apiUrl(intent.upload.url), { method: 'PUT', credentials: intent.upload.url.startsWith('/') ? 'include' : 'omit', headers: intent.upload.url.startsWith('/') ? csrfHeaders(intent.upload.headers) : intent.upload.headers, body: file })
      if (!uploadResponse.ok) throw new Error(`对象存储上传失败（${uploadResponse.status}）`)
      const result = await apiRequest<{ package?: PackageRecord }>(`/api/packages/${encodeURIComponent(intent.packageId)}/complete`, { method: 'POST' })
      if (!result.package) throw new Error('安装包元数据保存失败')
      setPackages((current) => [result.package!, ...current])
      setSoftware((current) => current.map((item) => item.id === result.package!.softwareId ? { ...item, version: result.package!.version, size: result.package!.size, downloadUrl: result.package!.downloadUrl } : item))
      setOpen(false)
      setFile(null)
      setVersion('')
      notify('安装包上传完成，SHA-256 校验值已生成')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '安装包上传失败', 'info')
    } finally {
      setUploading(false)
    }
  }

  function resumeSession(item: ResumableSession) {
    const [resumePlatform, ...resumeArchitecture] = item.platform.split(' ')
    setActiveUploadId(item.id)
    setSoftwareId(item.softwareId)
    setVersion(item.version)
    setPlatform(resumePlatform || 'Windows')
    setArchitecture(resumeArchitecture.join(' ') || 'x64')
    setFile(null)
    setUploadProgress(item.progress)
    setOpen(true)
    notify(`请选择原文件 ${item.fileName} 继续上传`, 'info')
  }

  async function removeSession(item: ResumableSession) {
    if (!await confirm({ title: '清除上传任务', message: `确定清除 ${item.fileName} 的未完成上传分片吗？`, confirmLabel: '确认清除', tone: 'danger' })) return
    try {
      await apiJson(`/api/packages/resumable/${encodeURIComponent(item.id)}`, 'DELETE')
      setResumableSessions((current) => current.filter((entry) => entry.id !== item.id))
      if (activeUploadId === item.id) setActiveUploadId('')
      notify('未完成上传及临时分片已清除', 'info')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '上传会话清理失败', 'info')
    }
  }

  async function removePackage(item: PackageRecord) {
    if (!await confirm({ title: '删除安装包', message: `确定删除安装包 ${item.fileName} 吗？`, confirmLabel: '删除安装包', tone: 'danger' })) return
    try {
      await apiJson(`/api/packages/${encodeURIComponent(item.id)}`, 'DELETE')
      setPackages((current) => current.filter((entry) => entry.id !== item.id))
      notify('安装包及存储文件已删除', 'info')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '安装包删除失败', 'info')
    }
  }

  async function togglePackage(item: PackageRecord) {
    try {
      const nextStatus = item.status === 'available' ? 'paused' : 'available'
      const result = await apiJson<{ package: PackageRecord }>(`/api/packages/${encodeURIComponent(item.id)}`, 'PATCH', { status: nextStatus })
      setPackages((current) => current.map((entry) => entry.id === item.id ? result.package : entry))
      notify(nextStatus === 'available' ? '安装包已恢复下载' : '安装包已暂停下载')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '安装包状态更新失败', 'info')
    }
  }

  function beginEdit(item: PackageRecord) {
    setEditing(item)
    setEditPlatform(item.platform)
    setEditReleaseNotes(item.releaseNotes || '')
  }

  async function savePackage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!editing) return
    setSaving(true)
    try {
      const result = await apiJson<{ package: PackageRecord }>(`/api/packages/${encodeURIComponent(editing.id)}`, 'PATCH', {
        platform: editPlatform,
        releaseNotes: editReleaseNotes,
      })
      setPackages((current) => current.map((entry) => entry.id === editing.id ? result.package : entry))
      setEditing(null)
      notify('安装包信息已更新')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '安装包信息更新失败', 'info')
    } finally {
      setSaving(false)
    }
  }

  function copyDownload(item: PackageRecord) {
    if (!item.downloadUrl) return notify('当前安装包不可下载', 'info')
    void navigator.clipboard?.writeText(apiUrl(item.downloadUrl))
    notify('15 分钟有效的签名下载地址已复制')
  }

  return (
    <div className="page-stack">
      <section className="storage-strip panel">
        <div><Cloud /><div><span className="overline">Object storage</span><h2>{storage.provider === 's3' ? 'S3 兼容对象存储已接入' : '本地对象存储运行正常'}</h2><p>浏览器直传后由服务端校验文件元数据；可接入 R2、OSS、COS 或其他 S3 兼容服务。</p></div></div>
        <span className="content-status" data-status={storage.configured ? 'available' : 'paused'}><CheckCircle2 /> {storage.configured ? '已连接' : '待配置'}</span>
      </section>

      {canManage && resumableSessions.length ? <section className="panel resumable-panel"><div className="toolbar-copy"><span className="overline">Resumable uploads</span><h2>未完成的大文件上传</h2><p>重新选择相同文件即可从服务器已保存的分片继续。</p></div><div className="resumable-list">{resumableSessions.map((item) => <article key={item.id}><FileArchive /><div><strong>{item.fileName}</strong><span>{item.version} · {item.platform} · {new Date(item.updatedAt).toLocaleString('zh-CN')}</span><i><b style={{ width: `${item.progress}%` }} /></i></div><em>{item.progress}%</em><button className="button button--secondary" type="button" onClick={() => resumeSession(item)}>继续</button><button className="icon-button danger-icon" type="button" aria-label="清除未完成上传" title="清除未完成上传" onClick={() => void removeSession(item)}><Trash2 /></button></article>)}</div></section> : null}

      <section className="panel table-panel">
        <div className="toolbar"><div className="toolbar-copy"><span className="overline">Packages</span><h2>安装包文件</h2></div><div className="toolbar-actions"><label className="search-control"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件名…" /></label>{canManage ? <button className="button button--primary" onClick={() => { setActiveUploadId(''); setUploadProgress(0); setFile(null); setOpen(true) }}><Plus /> 上传安装包</button> : null}</div></div>
        <div className="data-table-wrap">
          <table className="data-table package-table">
            <thead><tr><th>文件</th><th>软件 / 版本</th><th>平台</th><th>大小</th><th>存储位置</th><th>下载</th><th>状态</th><th /></tr></thead>
            <tbody>{filtered.map((item) => (
              <tr key={item.id}>
                <td><div className="table-title"><span className="table-icon"><FileArchive /></span><div><strong>{item.fileName}</strong>{item.sha256 ? <small title={item.sha256}>SHA-256 · {item.sha256.slice(0, 12)}…</small> : null}</div></div></td>
                <td><div className="table-stack"><strong>{item.software}</strong><small>v{item.version}</small></div></td>
                <td>{item.platform}</td><td>{item.size}</td><td><span className="table-muted">{item.storage}</span></td><td><strong>{item.downloads.toLocaleString()}</strong></td>
                <td><span className="content-status" data-status={item.status}>{item.status === 'available' ? <CheckCircle2 /> : <PauseCircle />}{packageStatus[item.status]}</span></td>
                <td><div className="row-actions"><button aria-label="复制签名下载地址" onClick={() => copyDownload(item)}><Copy /></button>{canManage ? <><button aria-label="编辑安装包信息" title="编辑安装包信息" onClick={() => beginEdit(item)}><Pencil /></button><button aria-label={item.status === 'available' ? '暂停下载' : '恢复下载'} title={item.status === 'available' ? '暂停下载' : '恢复下载'} onClick={() => void togglePackage(item)}>{item.status === 'available' ? <PauseCircle /> : <PlayCircle />}</button><button className="danger-icon" aria-label="删除安装包" title="删除安装包" onClick={() => void removePackage(item)}><Trash2 /></button></> : null}</div></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        {filtered.length === 0 ? <div className="table-empty"><FileArchive /><strong>还没有真实安装包</strong><span>点击“上传安装包”开始流式上传。</span></div> : null}
      </section>

      <Modal open={open} onClose={() => { if (!uploading) setOpen(false) }} eyebrow="Direct upload" title={activeUploadId ? '继续上传安装包' : '上传安装包'} footer={<><button className="button button--secondary" type="button" onClick={() => setOpen(false)} disabled={uploading}>取消</button>{uploading && activeUploadId ? <button className="button button--secondary" type="button" onClick={() => { pauseRequested.current = true }}><PauseCircle /> 暂停上传</button> : null}<button className="button button--primary" type="submit" form="package-upload-form" disabled={uploading}><UploadCloud /> {uploading ? `上传中 ${uploadProgress}%` : activeUploadId ? '继续上传' : '开始上传'}</button></>}>
        <form id="package-upload-form" className="form-stack" onSubmit={upload}>
          <label className="upload-zone"><input type="file" accept=".exe,.msi,.dmg,.pkg,.apk,.zip,.deb,.rpm,.AppImage,.tar,.gz" onChange={fileSelected} />{file ? <><FileArchive /><strong>{file.name}</strong><span>{(file.size / 1024 / 1024).toFixed(2)} MB · 已准备上传</span></> : <><UploadCloud /><strong>选择安装包</strong><span>支持 EXE、MSI、DMG、APK、ZIP、DEB、RPM 等格式</span></>}</label>
          <div className="field-grid"><label className="field"><span>所属软件</span><select value={softwareId} onChange={(event) => setSoftwareId(event.target.value)} required>{software.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label className="field"><span>版本号</span><input value={version} onChange={(event) => setVersion(event.target.value)} placeholder="2.4.2" required /></label></div>
          <div className="field-grid"><label className="field"><span>操作系统</span><select value={platform} onChange={(event) => setPlatform(event.target.value)}><option>Windows</option><option>macOS</option><option>Android</option><option>Linux</option></select></label><label className="field"><span>CPU 架构</span><select value={architecture} onChange={(event) => setArchitecture(event.target.value)}><option>x64</option><option>ARM64</option><option>Universal</option></select></label></div>
        </form>
      </Modal>

      <Modal open={Boolean(editing)} onClose={() => { if (!saving) setEditing(null) }} eyebrow="Package metadata" title="编辑安装包信息" footer={<><button className="button button--secondary" type="button" onClick={() => setEditing(null)} disabled={saving}>取消</button><button className="button button--primary" type="submit" form="package-edit-form" disabled={saving}>{saving ? '保存中…' : '保存修改'}</button></>}>
        <form id="package-edit-form" className="form-stack" onSubmit={savePackage}>
          <label className="field"><span>平台与架构</span><input value={editPlatform} onChange={(event) => setEditPlatform(event.target.value)} placeholder="Windows x64" required /></label>
          <label className="field"><span>发布说明</span><textarea value={editReleaseNotes} onChange={(event) => setEditReleaseNotes(event.target.value)} rows={6} placeholder="说明此安装包的适用范围、变更内容或安装注意事项" /></label>
          <p className="form-help">文件名、文件内容、版本归属与 SHA-256 校验值不可在此修改；如文件本身有误，请删除后重新上传。</p>
        </form>
      </Modal>
    </div>
  )
}
