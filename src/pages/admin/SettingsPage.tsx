import { Bell, Check, Database, Download, Palette, RefreshCw, Save, ShieldCheck, Trash2, UploadCloud } from 'lucide-react'
import { ChangeEvent, FormEvent, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import type { Dispatch, SetStateAction } from 'react'
import type { BrandSettings, PlatformIntegrations, SystemHealth, SystemUpdateStatus } from '../../types'
import { useToast } from '../../contexts/ToastContext'
import { apiJson, apiRequest, csrfHeaders } from '../../lib/api'
import { apiUrl } from '../../lib/appUrls'

interface AdminAccess {
  adminBasePath: string
  dashboardPath: string
  loginPath: string
  loginUrl: string
}

export function SettingsPage({ settings, setSettings, integrations }: { settings: BrandSettings; setSettings: Dispatch<SetStateAction<BrandSettings>>; integrations: PlatformIntegrations }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [draft, setDraft] = useState(settings)
  const [saving, setSaving] = useState(false)
  const [importing, setImporting] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [adminAccess, setAdminAccess] = useState<AdminAccess | null>(null)
  const [adminBasePathDraft, setAdminBasePathDraft] = useState('/admin')
  const [accessPassword, setAccessPassword] = useState('')
  const [accessSaving, setAccessSaving] = useState(false)
  const [backups, setBackups] = useState<Array<{ fileName: string; byteSize: number; createdAt: string }>>([])
  const [health, setHealth] = useState<SystemHealth | null>(null)
  const [healthLoading, setHealthLoading] = useState(false)
  const [systemUpdate, setSystemUpdate] = useState<SystemUpdateStatus | null>(null)
  const [updateLoading, setUpdateLoading] = useState(false)
  const [logoLoading, setLogoLoading] = useState(false)
  const { notify } = useToast()
  const sectionParam = searchParams.get('section')
  const normalizedSection = sectionParam === 'admin' ? 'security' : sectionParam
  const activeSection = (['brand', 'security', 'storage', 'notifications', 'maintenance'].includes(normalizedSection || '') ? normalizedSection : 'brand') as 'brand' | 'security' | 'storage' | 'notifications' | 'maintenance'
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings)

  useEffect(() => {
    void apiRequest<{ backups: Array<{ fileName: string; byteSize: number; createdAt: string }> }>('/api/admin/backups').then((result) => setBackups(result.backups)).catch(() => undefined)
    void refreshHealth()
    void apiRequest<{ update: SystemUpdateStatus }>('/api/admin/system/update').then((result) => setSystemUpdate(result.update)).catch(() => undefined)
    void apiRequest<{ access: AdminAccess }>('/api/admin/access').then((result) => { setAdminAccess(result.access); setAdminBasePathDraft(result.access.adminBasePath) }).catch(() => undefined)
  }, [])

  useEffect(() => {
    setDraft(settings)
  }, [settings])

  async function refreshHealth() {
    setHealthLoading(true)
    try {
      const result = await apiRequest<{ health: SystemHealth }>('/api/admin/health')
      setHealth(result.health)
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '系统健康检查失败', 'info')
    } finally {
      setHealthLoading(false)
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    try {
      const result = await apiJson<{ settings: BrandSettings }>('/api/settings', 'PUT', draft)
      setSettings(result.settings)
      setDraft(result.settings)
      notify('品牌与平台设置已保存到数据库')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '设置保存失败', 'info')
    } finally {
      setSaving(false)
    }
  }

  async function exportBackup() {
    try {
      const result = await apiJson<{ backup: { fileName: string; byteSize: number; createdAt: string } }>('/api/admin/backups/create', 'POST')
      setBackups((current) => [result.backup, ...current.filter((item) => item.fileName !== result.backup.fileName)])
      const anchor = document.createElement('a')
      anchor.href = apiUrl(`/api/admin/backups/${encodeURIComponent(result.backup.fileName)}/download`)
      anchor.download = result.backup.fileName
      anchor.click()
      notify('完整迁移备份已生成并开始下载')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '备份导出失败', 'info')
    }
  }

  async function importBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (!window.confirm('恢复完整备份会替换当前站点数据和发布内容。系统会先自动创建回滚备份，确定继续吗？')) return
    setImporting(true)
    try {
      const response = await fetch(apiUrl('/api/admin/import'), { method: 'POST', credentials: 'include', headers: csrfHeaders({ 'Content-Type': 'application/octet-stream' }), body: file })
      const result = await response.json().catch(() => ({})) as { error?: string; restored?: { adminBasePath?: string; restartRequired?: boolean } }
      if (!response.ok) throw new Error(result.error || '完整备份恢复失败')
      notify(result.restored?.restartRequired ? '完整备份已恢复；运行配置将在服务重启后完全生效' : '网站已从完整备份恢复，请使用备份中的管理员账号重新登录')
      window.setTimeout(() => window.location.assign(`${result.restored?.adminBasePath || '/admin'}/login?restored=1`), 800)
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '备份导入失败', 'info')
    } finally {
      setImporting(false)
    }
  }

  async function createScheduledBackup() {
    try {
      const result = await apiJson<{ backup: { fileName: string; byteSize: number; createdAt: string } }>('/api/admin/backups/create', 'POST')
      setBackups((current) => [result.backup, ...current])
      notify('即时备份已创建')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '备份创建失败', 'info')
    }
  }

  async function testNotifications() {
    try {
      const result = await apiJson<{ configured: boolean }>('/api/alerts/test', 'POST')
      notify(result.configured ? '测试告警已发送' : '告警通道尚未配置', result.configured ? 'success' : 'info')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '告警测试失败', 'info')
    }
  }

  async function checkSystemUpdate() {
    setUpdateLoading(true)
    try {
      const result = await apiJson<{ update: SystemUpdateStatus }>('/api/admin/system/update/check', 'POST')
      setSystemUpdate(result.update)
      notify(!result.update.configured ? result.update.configurationError || '更新源尚未完整配置' : result.update.updateAvailable ? `发现并验证新版本 ${result.update.latestVersion}` : '当前已经是最新版本', result.update.updateAvailable ? 'success' : 'info')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '版本检测失败', 'info')
    } finally {
      setUpdateLoading(false)
    }
  }

  async function installSystemUpdate() {
    if (!systemUpdate?.updateAvailable || !window.confirm(`即将备份当前网站并更新到 ${systemUpdate.latestVersion}，确定继续吗？`)) return
    setUpdateLoading(true)
    try {
      const result = await apiJson<{ update: { message: string; applyStarted: boolean } }>('/api/admin/system/update/install', 'POST')
      notify(result.update.message, result.update.applyStarted ? 'success' : 'info')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '系统更新失败', 'info')
    } finally {
      setUpdateLoading(false)
    }
  }

  async function changePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (newPassword !== confirmPassword) return notify('两次输入的新密码不一致', 'info')
    setChangingPassword(true)
    try {
      await apiJson('/api/admin/account', 'PUT', { currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      notify('管理员密码已更新')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '密码更新失败', 'info')
    } finally {
      setChangingPassword(false)
    }
  }

  async function updateAdminAccess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!window.confirm(`管理入口将修改为 ${adminBasePathDraft}，旧地址会立即失效。确定继续吗？`)) return
    setAccessSaving(true)
    try {
      const result = await apiJson<{ access: AdminAccess }>('/api/admin/access', 'PUT', { currentPassword: accessPassword, adminBasePath: adminBasePathDraft })
      setAdminAccess(result.access)
      setAccessPassword('')
      notify('管理入口已更新，正在进入新地址')
      window.setTimeout(() => window.location.assign(result.access.dashboardPath), 350)
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '管理入口修改失败', 'info')
      setAccessSaving(false)
    }
  }

  async function uploadLogo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setLogoLoading(true)
    try {
      const response = await fetch(apiUrl(`/api/settings/logo?fileName=${encodeURIComponent(file.name)}`), { method: 'POST', credentials: 'include', headers: csrfHeaders({ 'Content-Type': file.type || 'application/octet-stream' }), body: file })
      const result = await response.json() as { settings?: BrandSettings; error?: string }
      if (!response.ok || !result.settings) throw new Error(result.error || 'Logo 上传失败')
      setSettings(result.settings)
      setDraft(result.settings)
      notify('品牌 Logo 已更新')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Logo 上传失败', 'info')
    } finally {
      setLogoLoading(false)
    }
  }

  async function removeLogo() {
    if (!draft.logoUrl || !window.confirm('确定恢复为系统默认品牌图形吗？')) return
    setLogoLoading(true)
    try {
      const result = await apiJson<{ settings: BrandSettings }>('/api/settings/logo', 'DELETE')
      setSettings(result.settings)
      setDraft(result.settings)
      notify('已恢复默认品牌图形', 'info')
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : 'Logo 删除失败', 'info')
    } finally {
      setLogoLoading(false)
    }
  }

  const integrationItems = [
    { label: '对象存储', value: integrations.storage.provider.toUpperCase(), configured: integrations.storage.configured, detail: integrations.storage.directUpload ? '支持浏览器直传' : '仅服务器存储' },
    { label: 'DNS 服务商', value: integrations.dns.provider, configured: integrations.dns.configured, detail: integrations.dns.configured ? '支持自动写入 TXT' : '使用手动验证' },
    { label: 'HTTPS / 证书', value: integrations.certificate.provider, configured: integrations.certificate.configured, detail: integrations.certificate.configured ? '支持自动签发或委托' : '等待服务商配置' },
    { label: '告警通知', value: integrations.notifications.configured ? 'Webhook' : '未配置', configured: integrations.notifications.configured, detail: integrations.notifications.configured ? '支持签名通知' : '仅保留站内告警' },
  ]
  function selectSection(section: typeof activeSection) {
    if (section === activeSection) return
    if (dirty && (activeSection === 'brand' || activeSection === 'security') && !window.confirm('当前设置尚未保存，仍要切换分类吗？')) return
    const next = new URLSearchParams(searchParams)
    next.set('section', section)
    setSearchParams(next, { replace: true })
  }

  return (
    <div className="settings-layout">
      <nav className="settings-nav panel">
        <button className={activeSection === 'brand' ? 'is-active' : ''} type="button" onClick={() => selectSection('brand')}><Palette /> 品牌设置</button>
        <button className={activeSection === 'security' ? 'is-active' : ''} type="button" onClick={() => selectSection('security')}><ShieldCheck /> 安全设置</button>
        <button className={activeSection === 'storage' ? 'is-active' : ''} type="button" onClick={() => selectSection('storage')}><Database /> 存储配置</button>
        <button className={activeSection === 'notifications' ? 'is-active' : ''} type="button" onClick={() => selectSection('notifications')}><Bell /> 通知设置</button>
        <button className={activeSection === 'maintenance' ? 'is-active' : ''} type="button" onClick={() => selectSection('maintenance')}><RefreshCw /> 系统维护</button>
      </nav>

      <div className="settings-content">
        {activeSection === 'brand' ? <form id="settings-brand" className="panel settings-panel" onSubmit={save}>
          <div className="settings-heading"><div><span className="overline">Brand identity</span><h2>品牌与公开信息</h2><p>这些内容会显示在公开网站、登录页和管理后台。</p></div><button className="button button--primary" type="submit" disabled={saving}><Save /> {saving ? '保存中…' : '保存修改'}</button></div>
          <div className="settings-section">
            <h3>基础信息</h3>
            <div className="field-grid"><label className="field"><span>品牌名称</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} /></label><label className="field"><span>支持邮箱</span><input type="email" value={draft.supportEmail} onChange={(event) => setDraft({ ...draft, supportEmail: event.target.value })} /></label></div>
            <label className="field"><span>品牌主张</span><input value={draft.tagline} onChange={(event) => setDraft({ ...draft, tagline: event.target.value })} /></label>
            <label className="field"><span>页脚说明</span><input value={draft.footerText} onChange={(event) => setDraft({ ...draft, footerText: event.target.value })} /></label>
          </div>
          <div className="settings-section">
            <h3>Logo 预览</h3>
            <div className="logo-upload-row"><div className="settings-logo-preview">{draft.logoUrl ? <img src={apiUrl(draft.logoUrl)} alt="品牌 Logo 预览" /> : <span />}<strong>{draft.name || 'Brand'}</strong></div><div><div className="toolbar-actions"><label className="button button--secondary"><UploadCloud /> {logoLoading ? '处理中…' : '上传 Logo'}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => void uploadLogo(event)} hidden disabled={logoLoading} /></label>{draft.logoUrl ? <button className="button button--secondary" type="button" onClick={() => void removeLogo()} disabled={logoLoading}><Trash2 /> 恢复默认</button> : null}</div><p>支持 PNG、JPEG、WebP，最大 2 MB；公开站、登录页和后台会同步更新。</p></div></div>
          </div>
        </form> : null}

        {activeSection === 'security' ? <section id="settings-security" className="panel settings-panel">
          <form className="form-stack" onSubmit={save}>
            <div className="settings-heading"><div><span className="overline">Security & access</span><h2>安全、访问与公开状态</h2><p>统一管理 HTTPS、安全提醒、公开站维护状态和管理员入口。</p></div><button className="button button--primary" type="submit" disabled={saving}><Save /> {saving ? '保存中…' : '保存安全设置'}</button></div>
            <div className="switch-list settings-switches">
              <label><span><strong>默认使用 302 跳转</strong><small>允许随时更换目标，避免浏览器长期缓存</small></span><input type="checkbox" checked={(draft.defaultRedirectCode ?? 302) === 302} onChange={(event) => setDraft({ ...draft, defaultRedirectCode: event.target.checked ? 302 : 301 })} /></label>
              <label><span><strong>自动申请 HTTPS 证书</strong><small>域名验证后自动进入证书签发流程</small></span><input type="checkbox" checked={draft.autoHttps ?? true} onChange={(event) => setDraft({ ...draft, autoHttps: event.target.checked })} /></label>
              <label><span><strong>异常流量提醒</strong><small>访问或下载量异常时发送通知</small></span><input type="checkbox" checked={draft.trafficAlerts ?? true} onChange={(event) => setDraft({ ...draft, trafficAlerts: event.target.checked })} /></label>
              <label><span><strong>公开站维护模式</strong><small>开启后访客只会看到品牌化维护页面，管理后台不受影响</small></span><input type="checkbox" checked={draft.publicMaintenance ?? false} onChange={(event) => setDraft({ ...draft, publicMaintenance: event.target.checked })} /></label>
            </div>
            {draft.publicMaintenance ? <label className="field"><span>维护说明</span><textarea rows={3} maxLength={500} value={draft.maintenanceMessage || ''} onChange={(event) => setDraft({ ...draft, maintenanceMessage: event.target.value })} placeholder="例如：系统正在升级，预计很快恢复访问。" /><small>最多 500 字，将直接显示给公开站访客。</small></label> : null}
            <div className="settings-saved-note"><Check /> 设置保存到 SQLite 数据库，并同步更新公开页面。</div>
          </form>
          <div className="settings-section" id="settings-account">
            <div className="settings-heading"><div><span className="overline">Administrator</span><h3>管理员账号</h3><p>修改密码后当前会话保持有效，其他设备会立即退出登录。</p></div></div>
          <form className="form-stack" onSubmit={changePassword}>
            <label className="field"><span>当前密码</span><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} autoComplete="current-password" required /></label>
            <div className="field-grid"><label className="field"><span>新密码</span><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} autoComplete="new-password" minLength={6} required /><small>至少 6 位；弱密码会降低账号安全性。</small></label><label className="field"><span>确认新密码</span><input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} autoComplete="new-password" minLength={6} required /></label></div>
            <button className="button button--secondary" type="submit" disabled={changingPassword}>{changingPassword ? '更新中…' : '更新管理员密码'}</button>
          </form>
          </div>
          <div className="settings-section">
            <div className="settings-heading"><div><span className="overline">Private access</span><h3>管理后台入口</h3><p>当前登录地址：{adminAccess?.loginUrl || '读取中…'}。修改后旧地址会返回 404。</p></div></div>
            <form className="form-stack" onSubmit={updateAdminAccess}>
              <div className="field-grid"><label className="field"><span>管理入口后缀</span><input value={adminBasePathDraft} onChange={(event) => setAdminBasePathDraft(event.target.value)} placeholder="/jtwz-console" pattern="/[A-Za-z0-9][A-Za-z0-9_-]{3,63}" required /><small>4-64 位字母、数字、短横线或下划线，必须以 / 开头。</small></label><label className="field"><span>当前管理员密码</span><input type="password" value={accessPassword} onChange={(event) => setAccessPassword(event.target.value)} autoComplete="current-password" required /><small>修改入口前需要再次验证身份。</small></label></div>
              <button className="button button--secondary" type="submit" disabled={accessSaving || adminBasePathDraft === adminAccess?.adminBasePath}>{accessSaving ? '更新中…' : '修改管理入口'}</button>
            </form>
          </div>
        </section> : null}

        {activeSection === 'storage' ? <section id="settings-storage" className="panel settings-panel">
          <div className="settings-heading"><div><span className="overline">Infrastructure</span><h2>存储、DNS 与证书</h2><p>这里只显示适配器状态，敏感密钥通过服务器环境变量配置，不会返回浏览器。</p></div></div>
          <div className="integration-grid">{integrationItems.filter((item) => item.label !== '告警通知').map((item) => <article className="integration-card" key={item.label}><div><strong>{item.label}</strong><span>{item.value}</span></div><small>{item.detail}</small><em data-status={item.configured ? 'available' : 'paused'}>{item.configured ? '已配置' : '未配置'}</em></article>)}</div>
          <div className="settings-saved-note"><ShieldCheck /> 生产环境必须使用对象存储直传；修改连接参数后需要由运维安全重启服务。</div>
        </section> : null}

        {activeSection === 'notifications' ? <section id="settings-notifications" className="panel settings-panel">
          <div className="settings-heading"><div><span className="overline">Notifications</span><h2>通知与告警</h2><p>测试签名 Webhook 告警通道，未配置时系统仍保留站内异常记录。</p></div><button className="button button--secondary" type="button" onClick={() => void testNotifications()}><Bell /> 测试告警通道</button></div>
          <div className="integration-grid">{integrationItems.filter((item) => item.label === '告警通知').map((item) => <article className="integration-card" key={item.label}><div><strong>{item.label}</strong><span>{item.value}</span></div><small>{item.detail}</small><em data-status={item.configured ? 'available' : 'paused'}>{item.configured ? '已配置' : '未配置'}</em></article>)}</div>
        </section> : null}

        {activeSection === 'maintenance' ? <section id="settings-maintenance" className="panel settings-panel">
          <div className="settings-heading"><div><span className="overline">System update</span><h2>系统版本与更新</h2><p>{systemUpdate?.configured ? `当前版本 ${systemUpdate.currentVersion}，${systemUpdate.updateAvailable ? `已验证签名，可更新到 ${systemUpdate.latestVersion}` : '已是最新版本'}。` : `当前版本 ${systemUpdate?.currentVersion || '读取中'}；${systemUpdate?.configurationError || '需要配置更新清单和 Ed25519 公钥'}。`}</p></div><div className="toolbar-actions"><button className="button button--secondary" type="button" onClick={() => void checkSystemUpdate()} disabled={updateLoading}><RefreshCw className={updateLoading ? 'is-spinning' : undefined} /> {updateLoading ? '检测中…' : '检测新版本'}</button>{systemUpdate?.updateAvailable ? <button className="button button--primary" type="button" onClick={() => void installSystemUpdate()} disabled={updateLoading}><Download /> 备份并更新</button> : null}</div></div>
          {systemUpdate?.manifest?.notes ? <div className="settings-saved-note"><strong>v{systemUpdate.latestVersion}</strong><span>{systemUpdate.manifest.notes}</span></div> : null}
          {systemUpdate?.state?.status ? <div className="settings-saved-note"><Check /><span>最近更新状态：{String(systemUpdate.state.status)}{systemUpdate.state.detail ? ` · ${String(systemUpdate.state.detail)}` : ''}</span></div> : null}
          {systemUpdate?.configured && !systemUpdate.applyConfigured ? <div className="settings-saved-note">更新包可以自动下载并校验；服务器需配置安全更新执行器后才能完成无人值守切换。</div> : null}
          <div className="settings-heading"><div><span className="overline">Backup & recovery</span><h2>完整迁移与恢复</h2><p>迁移包包含账号、运行配置、数据库、网站版本、品牌资源与安装包，可在新服务器直接上传恢复；失败会自动回滚。</p></div></div>
          <div className="toolbar-actions"><button className="button button--secondary" type="button" onClick={() => void exportBackup()}><Download /> 生成并下载完整备份</button><button className="button button--secondary" type="button" onClick={() => void createScheduledBackup()}><Database /> 仅创建服务器备份</button><label className="button button--secondary"><UploadCloud /> {importing ? '恢复中…' : '上传迁移包并恢复'}<input type="file" accept=".jtwz-backup,.aurelia-backup,application/gzip,application/octet-stream" onChange={(event) => void importBackup(event)} hidden disabled={importing} /></label></div>
          <div className="settings-saved-note"><ShieldCheck /> 迁移包含账号哈希和运行密钥，请像服务器凭据一样安全保管。</div>
          <div className="settings-saved-note">当前保留 {backups.length} 个自动备份文件，由 `BACKUP_INTERVAL_HOURS` 和 `BACKUP_RETENTION_DAYS` 控制。</div>
          {backups.slice(0, 5).map((backup) => <div className="settings-saved-note" key={backup.fileName}><Check /> <span>{backup.fileName} · {(backup.byteSize / 1024).toFixed(1)} KB · {new Date(backup.createdAt).toLocaleString('zh-CN')}</span><a className="text-link" href={apiUrl(`/api/admin/backups/${encodeURIComponent(backup.fileName)}/download`)}>下载</a></div>)}
          {!backups.length ? <div className="settings-saved-note">暂无自动备份文件。</div> : null}
          <div className="health-panel"><div className="settings-heading"><div><span className="overline">System readiness</span><h3>系统健康检查</h3><p>{health ? `最近检查：${new Date(health.checkedAt).toLocaleString('zh-CN')}` : '检查数据库、存储、证书和备份能力。'}</p></div><button className="button button--secondary button--small" type="button" onClick={() => void refreshHealth()} disabled={healthLoading}><RefreshCw className={healthLoading ? 'is-spinning' : undefined} /> {healthLoading ? '检查中…' : '重新检查'}</button></div>{health ? <div className="health-check-grid">{health.checks.map((check) => <div className="health-check" key={check.id}><span data-status={check.status}>{check.status === 'ok' ? '正常' : check.status === 'warning' ? '注意' : '异常'}</span><strong>{check.label}</strong><small>{check.detail}</small></div>)}</div> : null}</div>
        </section> : null}
      </div>
    </div>
  )
}
