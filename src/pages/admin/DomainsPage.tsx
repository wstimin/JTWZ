import {
  Check,
  ChevronDown,
  Copy,
  Edit3,
  ExternalLink,
  Filter,
  Globe2,
  PauseCircle,
  PlayCircle,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
} from 'lucide-react'
import { FormEvent, useMemo, useState } from 'react'
import type { Dispatch, SetStateAction } from 'react'
import type { DomainMode, DomainRecord, SiteRecord } from '../../types'
import { DomainModeBadge, DomainStatusBadge } from '../../components/StatusBadge'
import { Modal } from '../../components/Modal'
import { useToast } from '../../contexts/ToastContext'
import { apiJson, apiRequest } from '../../lib/api'

interface DnsInstructions {
  type: 'TXT'
  name: string
  fullName: string
  value: string
  dnsStatus: string
  certificateStatus: string
  lastVerifiedAt?: string
  dnsProvider: { provider: 'manual' | 'cloudflare' | 'webhook'; configured: boolean }
  certificateProvider: { provider: 'manual' | 'cloudflare' | 'webhook'; configured: boolean }
}

interface DomainsPageProps {
  domains: DomainRecord[]
  setDomains: Dispatch<SetStateAction<DomainRecord[]>>
  sites: SiteRecord[]
}

export function DomainsPage({ domains, setDomains, sites }: DomainsPageProps) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const [open, setOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [hostname, setHostname] = useState('')
  const [target, setTarget] = useState('')
  const [mode, setMode] = useState<DomainMode>('redirect')
  const [redirectCode, setRedirectCode] = useState<301 | 302>(302)
  const [preservePath, setPreservePath] = useState(true)
  const [preserveQuery, setPreserveQuery] = useState(true)
  const [forceHttps, setForceHttps] = useState(true)
  const [dnsDomain, setDnsDomain] = useState<DomainRecord | null>(null)
  const [dnsInstructions, setDnsInstructions] = useState<DnsInstructions | null>(null)
  const [checkingDns, setCheckingDns] = useState(false)
  const [publishingDns, setPublishingDns] = useState(false)
  const [issuingCertificate, setIssuingCertificate] = useState(false)
  const { notify } = useToast()
  const publishedSites = sites.filter((site) => site.status === 'published')

  const filtered = useMemo(
    () => domains.filter((domain) => {
      const matchesQuery = `${domain.hostname} ${domain.target}`.toLowerCase().includes(query.toLowerCase())
      const matchesStatus = status === 'all' || domain.status === status
      return matchesQuery && matchesStatus
    }),
    [domains, query, status],
  )

  const [saving, setSaving] = useState(false)

  function resetForm() {
    setEditingId(null)
    setHostname('')
    setTarget('')
    setMode('redirect')
    setRedirectCode(302)
    setPreservePath(true)
    setPreserveQuery(true)
    setForceHttps(true)
  }

  function openCreate() {
    resetForm()
    setOpen(true)
  }

  function openEdit(domain: DomainRecord) {
    setEditingId(domain.id)
    setHostname(domain.hostname)
    setTarget(domain.target)
    setMode(domain.mode)
    setRedirectCode(domain.redirectCode)
    setPreservePath(domain.preservePath)
    setPreserveQuery(domain.preserveQuery)
    setForceHttps(domain.forceHttps ?? true)
    setOpen(true)
  }

  async function saveDomain(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const normalized = hostname.trim().replace(/^https?:\/\//, '').replace(/\/$/, '')
    if (!normalized) return
    setSaving(true)
    try {
      const payload = {
        hostname: normalized,
        mode,
        target: target.trim(),
        redirectCode,
        preservePath,
        preserveQuery,
        forceHttps,
      }
      const result = editingId
        ? await apiJson<{ domain: DomainRecord }>(`/api/domains/${encodeURIComponent(editingId)}`, 'PUT', payload)
        : await apiJson<{ domain: DomainRecord }>('/api/domains', 'POST', payload)
      setDomains((current) => editingId
        ? current.map((item) => item.id === editingId ? result.domain : item)
        : [result.domain, ...current.filter((item) => item.id !== result.domain.id)])
      setOpen(false)
      resetForm()
      notify(editingId ? '域名配置已更新' : '域名已保存，下一步请配置 DNS 验证')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '域名保存失败', 'info')
    } finally {
      setSaving(false)
    }
  }

  async function removeDomain(id: string) {
    if (!window.confirm('确定删除这个域名及其路径跳转规则吗？')) return
    try {
      await apiJson(`/api/domains/${encodeURIComponent(id)}`, 'DELETE')
      setDomains((current) => current.filter((domain) => domain.id !== id))
      notify('域名已删除', 'info')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '域名删除失败', 'info')
    }
  }

  async function toggleDomain(domain: DomainRecord) {
    const nextStatus = domain.status === 'active' ? 'paused' : 'active'
    try {
      const result = await apiJson<{ domain: DomainRecord }>(`/api/domains/${encodeURIComponent(domain.id)}`, 'PUT', { status: nextStatus })
      setDomains((current) => current.map((item) => item.id === domain.id ? result.domain : item))
      notify(nextStatus === 'active' ? '域名已启用，路由规则开始生效' : '域名已暂停', 'info')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '域名状态更新失败', 'info')
    }
  }

  async function openDns(domain: DomainRecord) {
    try {
      const result = await apiRequest<{ instructions: DnsInstructions }>(`/api/domains/${encodeURIComponent(domain.id)}/dns-instructions`)
      setDnsDomain(domain)
      setDnsInstructions(result.instructions)
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'DNS 配置读取失败', 'info')
    }
  }

  async function verifyDns() {
    if (!dnsDomain) return
    setCheckingDns(true)
    try {
      const result = await apiJson<{ domain: DomainRecord }>(`/api/domains/${encodeURIComponent(dnsDomain.id)}/verify-dns`, 'POST')
      setDomains((current) => current.map((item) => item.id === result.domain.id ? result.domain : item))
      setDnsDomain(result.domain)
      setDnsInstructions((current) => current ? { ...current, dnsStatus: 'verified', certificateStatus: result.domain.certificateStatus || 'pending', lastVerifiedAt: result.domain.lastVerifiedAt } : current)
      notify('DNS 所有权验证成功，域名已进入 HTTPS 配置流程')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'DNS 验证失败', 'info')
    } finally {
      setCheckingDns(false)
    }
  }

  async function publishDns() {
    if (!dnsDomain) return
    setPublishingDns(true)
    try {
      await apiJson(`/api/domains/${encodeURIComponent(dnsDomain.id)}/publish-dns`, 'POST')
      notify('TXT 验证记录已自动写入 DNS 服务商，请稍后验证')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'DNS 记录写入失败', 'info')
    } finally {
      setPublishingDns(false)
    }
  }

  async function issueCertificate() {
    if (!dnsDomain) return
    setIssuingCertificate(true)
    try {
      const result = await apiJson<{ domain: DomainRecord }>(`/api/domains/${encodeURIComponent(dnsDomain.id)}/issue-certificate`, 'POST')
      setDomains((current) => current.map((item) => item.id === result.domain.id ? result.domain : item))
      setDnsDomain(result.domain)
      setDnsInstructions((current) => current ? { ...current, certificateStatus: 'active' } : current)
      notify('HTTPS 已启用，证书状态已更新')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'HTTPS 证书签发失败', 'info')
    } finally {
      setIssuingCertificate(false)
    }
  }

  return (
    <div className="page-stack">
      <section className="domain-summary-grid">
        <article className="panel summary-card"><span>全部域名</span><strong>{domains.length}</strong><small>多个入口统一管理</small></article>
        <article className="panel summary-card"><span>正常运行</span><strong>{domains.filter((item) => item.status === 'active').length}</strong><small><i className="dot-success" /> 服务状态健康</small></article>
        <article className="panel summary-card"><span>等待配置</span><strong>{domains.filter((item) => item.status === 'pending').length}</strong><small>需要完成 DNS 验证</small></article>
        <article className="panel summary-card"><span>今日访问</span><strong>{domains.reduce((sum, item) => sum + item.visits, 0).toLocaleString()}</strong><small>全部域名汇总</small></article>
      </section>

      <section className="panel table-panel">
        <div className="toolbar">
          <div className="toolbar-copy"><span className="overline">Domain registry</span><h2>全部域名</h2></div>
          <div className="toolbar-actions">
            <label className="search-control"><Search /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索域名或目标…" /></label>
            <label className="select-control"><Filter /><select value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="active">正常运行</option><option value="pending">等待配置</option><option value="paused">已暂停</option></select><ChevronDown /></label>
            <button className="button button--primary" type="button" onClick={openCreate}><Plus /> 添加域名</button>
          </div>
        </div>

        <div className="data-table-wrap">
          <table className="data-table domain-table">
            <thead><tr><th>域名</th><th>运行模式</th><th>目标</th><th>状态</th><th>访问量</th><th>HTTPS</th><th>操作</th></tr></thead>
            <tbody>
              {filtered.map((domain) => (
                <tr key={domain.id}>
                  <td><div className="table-title"><span className="table-icon"><Globe2 /></span><div><strong>{domain.hostname}</strong><small>{domain.updatedAt}更新</small></div></div></td>
                  <td><DomainModeBadge mode={domain.mode} /></td>
                  <td><span className="table-muted table-target">{domain.mode === 'site' ? sites.find((site) => site.id === domain.target)?.name || domain.target : domain.target}</span></td>
                  <td><DomainStatusBadge status={domain.status} /></td>
                  <td><strong>{domain.visits.toLocaleString()}</strong></td>
                  <td>{domain.certificateStatus === 'active' ? <span className="ssl-state"><ShieldCheck /> 已生效</span> : <span className="table-muted">{domain.dnsStatus === 'verified' ? '待签发' : '待验证'}</span>}</td>
                  <td><div className="row-actions"><button aria-label="复制域名" title="复制域名" onClick={() => { navigator.clipboard?.writeText(domain.hostname); notify('域名已复制') }}><Copy /></button><button aria-label="编辑域名" title="编辑域名" onClick={() => openEdit(domain)}><Edit3 /></button><button aria-label="DNS 验证" title="DNS 验证" onClick={() => void openDns(domain)}><ShieldCheck /></button><button aria-label="打开目标" title="打开目标" onClick={() => { if (/^https?:\/\//.test(domain.target)) window.open(domain.target, '_blank', 'noopener,noreferrer') }}><ExternalLink /></button><button aria-label={domain.status === 'active' ? '暂停域名' : '启用域名'} title={domain.status === 'active' ? '暂停域名' : '启用域名'} onClick={() => void toggleDomain(domain)} disabled={domain.status !== 'active' && domain.dnsStatus !== 'verified'}>{domain.status === 'active' ? <PauseCircle /> : <PlayCircle />}</button><button className="danger-icon" aria-label="删除域名" title="删除域名" onClick={() => void removeDomain(domain.id)}><Trash2 /></button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 ? <div className="table-empty"><Globe2 /><strong>没有找到域名</strong><span>调整筛选条件或添加一个新域名。</span></div> : null}
      </section>

      <Modal
        open={open}
        onClose={() => { setOpen(false); resetForm() }}
        eyebrow={editingId ? 'Domain settings' : 'New domain'}
        title={editingId ? '编辑域名配置' : '添加自定义域名'}
        footer={<><button className="button button--secondary" type="button" onClick={() => { setOpen(false); resetForm() }}>取消</button><button className="button button--primary" type="submit" form="domain-form" disabled={saving}><Check /> {saving ? '正在保存…' : editingId ? '保存修改' : '保存并继续'}</button></>}
      >
        <form id="domain-form" className="form-stack" onSubmit={saveDomain}>
          <label className="field"><span>来源域名</span><input value={hostname} onChange={(event) => setHostname(event.target.value)} placeholder="输入你的域名" disabled={Boolean(editingId)} required /><small>{editingId ? '来源域名涉及所有权验证，保存后不可直接修改；如需更换请新增域名。' : '不需要填写 http:// 或 https://'}</small></label>
          <label className="field"><span>运行模式</span><select value={mode} onChange={(event) => { const nextMode = event.target.value as DomainMode; setMode(nextMode); setTarget(nextMode === 'site' ? publishedSites[0]?.id || '' : '') }}><option value="redirect">跳转到外部网址</option><option value="site">展示内部静态网站</option><option value="download">跳转到软件下载</option><option value="maintenance">显示维护页面</option></select></label>
          {mode === 'site' ? <label className="field"><span>选择已发布网站</span><select value={target} onChange={(event) => setTarget(event.target.value)} required><option value="" disabled>{publishedSites.length ? '请选择网站' : '暂无已发布网站'}</option>{publishedSites.map((site) => <option value={site.id} key={site.id}>{site.name}</option>)}</select><small>网站发布后才能绑定到域名。</small></label> : <label className="field"><span>目标地址或内容</span><input value={target} onChange={(event) => setTarget(event.target.value)} placeholder={mode === 'maintenance' ? '维护页面说明（可选）' : 'https://target.example/page'} required={mode === 'redirect' || mode === 'download'} /></label>}
          {(mode === 'redirect' || mode === 'download') ? <div className="field-grid"><label className="field"><span>跳转类型</span><select value={redirectCode} onChange={(event) => setRedirectCode(Number(event.target.value) as 301 | 302)}><option value={302}>302 临时跳转</option><option value={301}>301 永久跳转</option></select></label><div className="switch-list"><label><span><strong>保留原路径</strong></span><input type="checkbox" checked={preservePath} onChange={(event) => setPreservePath(event.target.checked)} /></label><label><span><strong>保留查询参数</strong></span><input type="checkbox" checked={preserveQuery} onChange={(event) => setPreserveQuery(event.target.checked)} /></label></div></div> : null}
          <div className="switch-list"><label><span><strong>强制 HTTPS</strong><small>生产环境将 HTTP 请求升级为 HTTPS</small></span><input type="checkbox" checked={forceHttps} onChange={(event) => setForceHttps(event.target.checked)} /></label></div>
          {!editingId ? <div className="form-note"><ShieldCheck /><div><strong>域名所有权验证</strong><span>保存后系统会生成 DNS 配置说明；验证完成前不会正式接管流量。</span></div></div> : null}
        </form>
      </Modal>

      <Modal open={Boolean(dnsDomain)} onClose={() => { setDnsDomain(null); setDnsInstructions(null) }} eyebrow="DNS ownership" title={`验证 ${dnsDomain?.hostname || ''}`} footer={<><button className="button button--secondary" type="button" onClick={() => { setDnsDomain(null); setDnsInstructions(null) }}>稍后验证</button><button className="button button--primary" type="button" onClick={() => void verifyDns()} disabled={checkingDns || dnsInstructions?.dnsStatus === 'verified'}><ShieldCheck /> {checkingDns ? '正在查询 DNS…' : dnsInstructions?.dnsStatus === 'verified' ? '已经验证' : '立即验证'}</button></>}>
        {dnsInstructions ? <div className="form-stack">
          <div className="form-note"><ShieldCheck /><div><strong>添加一条 TXT 记录</strong><span>{dnsInstructions.dnsProvider.configured ? '已接入 DNS 服务商，可自动写入；也可以手动添加以下记录。' : '请登录域名 DNS 服务商控制台，添加以下记录。生效后点击“立即验证”。'}</span></div></div>
          {dnsInstructions.dnsProvider.configured ? <button className="button button--secondary" type="button" onClick={() => void publishDns()} disabled={publishingDns}><ShieldCheck /> {publishingDns ? '正在写入…' : `自动写入 ${dnsInstructions.dnsProvider.provider === 'cloudflare' ? 'Cloudflare' : 'DNS'}`}</button> : null}
          {dnsInstructions.certificateStatus !== 'active' && dnsInstructions.certificateProvider.configured ? <button className="button button--secondary" type="button" onClick={() => void issueCertificate()} disabled={issuingCertificate || dnsInstructions.dnsStatus !== 'verified'}><ShieldCheck /> {issuingCertificate ? '正在启用 HTTPS…' : '启用 HTTPS'}</button> : null}
          <div className="dns-record-grid"><div><span>记录类型</span><strong>{dnsInstructions.type}</strong></div><div><span>主机记录</span><strong>{dnsInstructions.name}</strong><button type="button" onClick={() => { void navigator.clipboard?.writeText(dnsInstructions.name); notify('主机记录已复制') }}><Copy /></button></div><div className="dns-record-value"><span>记录值</span><strong>{dnsInstructions.value}</strong><button type="button" onClick={() => { void navigator.clipboard?.writeText(dnsInstructions.value); notify('TXT 记录值已复制') }}><Copy /></button></div></div>
          <p className="dns-hint">完整查询名称：{dnsInstructions.fullName}<br />DNS 状态：{dnsInstructions.dnsStatus === 'verified' ? '已验证' : '等待验证'} · HTTPS：{dnsInstructions.certificateStatus === 'active' ? '已生效' : '等待签发'}</p>
        </div> : null}
      </Modal>
    </div>
  )
}
