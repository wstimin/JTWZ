import { Check, KeyRound, Laptop, Plus, RefreshCw, ShieldCheck, Trash2, UserCog, Users } from 'lucide-react'
import { FormEvent, useCallback, useEffect, useState } from 'react'
import { Modal } from '../../components/Modal'
import { useAuth } from '../../contexts/AuthContext'
import { useToast } from '../../contexts/ToastContext'
import { apiJson, apiRequest } from '../../lib/api'

type AdminRecord = { id: string; username: string; displayName: string; role: 'owner' | 'admin' | 'editor' | 'analyst'; status: 'active' | 'disabled'; twoFactorEnabled: boolean; activeSessions: number; lastLoginAt?: string; createdAt: string }
type SessionRecord = { id: string; ipAddress: string; deviceName: string; userAgent: string; lastSeenAt: string; createdAt: string; expiresAt: number; current: boolean }
type LoginEvent = { id: string; username: string; success: boolean; reason: string; ipAddress: string; deviceName: string; requestId: string; createdAt: string }
type Overview = { admins: AdminRecord[]; sessions: SessionRecord[]; events: LoginEvent[]; canManageAdmins: boolean }

const roleLabels = { owner: '所有者', admin: '管理员', editor: '内容编辑', analyst: '只读审计' }

export function SecurityPage() {
  const { admin, refresh } = useAuth()
  const { notify, confirm } = useToast()
  const [overview, setOverview] = useState<Overview>({ admins: [], sessions: [], events: [], canManageAdmins: false })
  const [loading, setLoading] = useState(true)
  const [createOpen, setCreateOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [newAdmin, setNewAdmin] = useState({ username: '', displayName: '', role: 'editor', password: '' })
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null)
  const [setupPassword, setSetupPassword] = useState('')
  const [setupCode, setSetupCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([])
  const [disablePassword, setDisablePassword] = useState('')
  const [disableCode, setDisableCode] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setOverview(await apiRequest<Overview>('/api/security/overview'))
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '安全数据加载失败', 'info')
    } finally {
      setLoading(false)
    }
  }, [notify])

  useEffect(() => { void load() }, [load])

  async function createAdministrator(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    try {
      await apiJson('/api/security/admins', 'POST', newAdmin)
      setCreateOpen(false)
      setNewAdmin({ username: '', displayName: '', role: 'editor', password: '' })
      notify('管理员已创建')
      await load()
    } catch (reason) {
      notify(reason instanceof Error ? reason.message : '管理员创建失败', 'info')
    } finally { setSaving(false) }
  }

  async function updateAdministrator(item: AdminRecord, changes: Partial<AdminRecord>) {
    try {
      await apiJson(`/api/security/admins/${encodeURIComponent(item.id)}`, 'PATCH', { displayName: item.displayName, role: item.role, status: item.status, ...changes })
      notify('管理员权限已更新')
      await load()
    } catch (reason) { notify(reason instanceof Error ? reason.message : '管理员更新失败', 'info') }
  }

  async function removeAdministrator(item: AdminRecord) {
    if (!await confirm({ title: '删除管理员', message: `确定删除管理员“${item.displayName}”吗？其所有会话会立即失效。`, confirmLabel: '删除管理员', tone: 'danger' })) return
    try {
      await apiJson(`/api/security/admins/${encodeURIComponent(item.id)}`, 'DELETE')
      notify('管理员已删除')
      await load()
    } catch (reason) { notify(reason instanceof Error ? reason.message : '管理员删除失败', 'info') }
  }

  async function beginSetup(event: FormEvent) {
    event.preventDefault()
    try {
      const result = await apiJson<{ setup: { secret: string; otpauthUrl: string } }>('/api/security/2fa/setup', 'POST', { currentPassword: setupPassword })
      setSetup(result.setup)
      setSetupPassword('')
    } catch (reason) { notify(reason instanceof Error ? reason.message : '2FA 设置启动失败', 'info') }
  }

  async function enableTwoFactor(event: FormEvent) {
    event.preventDefault()
    try {
      const result = await apiJson<{ recoveryCodes: string[] }>('/api/security/2fa/enable', 'POST', { code: setupCode })
      setRecoveryCodes(result.recoveryCodes)
      setSetup(null)
      setSetupCode('')
      notify('双重验证已启用，其他设备会话已撤销')
      await refresh()
      await load()
    } catch (reason) { notify(reason instanceof Error ? reason.message : '2FA 启用失败', 'info') }
  }

  async function disableTwoFactor(event: FormEvent) {
    event.preventDefault()
    if (!await confirm({ title: '关闭双重验证', message: '确定关闭双重验证吗？其他设备会话会同时撤销。', confirmLabel: '关闭 2FA', tone: 'danger' })) return
    try {
      await apiJson('/api/security/2fa/disable', 'POST', { currentPassword: disablePassword, code: disableCode })
      setDisablePassword(''); setDisableCode('')
      notify('双重验证已关闭', 'info')
      await refresh()
      await load()
    } catch (reason) { notify(reason instanceof Error ? reason.message : '2FA 关闭失败', 'info') }
  }

  async function revokeSession(item: SessionRecord) {
    if (!await confirm({ title: '撤销登录会话', message: `确定让“${item.deviceName}”退出登录吗？`, confirmLabel: '撤销会话', tone: 'warning' })) return
    try {
      await apiJson(`/api/security/sessions/${encodeURIComponent(item.id)}`, 'DELETE')
      notify('设备会话已撤销')
      await load()
    } catch (reason) { notify(reason instanceof Error ? reason.message : '会话撤销失败', 'info') }
  }

  async function revokeOthers() {
    if (!await confirm({ title: '撤销其他会话', message: '确定撤销当前账号的所有其他设备会话吗？', confirmLabel: '全部撤销', tone: 'warning' })) return
    const result = await apiJson<{ revoked: number }>('/api/security/sessions/revoke-others', 'POST')
    notify(`已撤销 ${result.revoked} 个其他设备会话`)
    await load()
  }

  return <div className="security-center">
    <section className="panel security-hero"><div><span className="overline">Professional security</span><h2>账号与访问安全中心</h2><p>集中管理角色权限、双重验证、登录设备与异常登录记录。所有安全操作都会进入审计日志。</p></div><div className="security-score"><ShieldCheck /><strong>{admin?.twoFactorEnabled ? '增强保护' : '基础保护'}</strong><span>{admin?.twoFactorEnabled ? '2FA 已启用' : '建议启用 2FA'}</span></div></section>

    {overview.canManageAdmins ? <section className="panel security-admin-panel"><div className="toolbar"><div className="toolbar-copy"><span className="overline">Administrators</span><h2>管理员与角色</h2><p>所有者可管理账号；管理员负责系统运维；编辑负责内容；审计员仅可查看。</p></div><button className="button button--primary" onClick={() => setCreateOpen(true)}><Plus /> 添加管理员</button></div>
      <div className="security-admin-list">{overview.admins.map((item) => <article key={item.id}><div className="security-avatar"><Users /></div><div className="security-admin-copy"><strong>{item.displayName}</strong><span>@{item.username} · {roleLabels[item.role]} · {item.twoFactorEnabled ? '已启用 2FA' : '未启用 2FA'} · {item.activeSessions} 个会话</span><small>{item.lastLoginAt ? `最近登录 ${new Date(item.lastLoginAt).toLocaleString('zh-CN')}` : '尚未登录'}</small></div><select value={item.role} disabled={item.id === admin?.id} onChange={(event) => void updateAdministrator(item, { role: event.target.value as AdminRecord['role'] })} aria-label={`${item.displayName}的角色`}>{Object.entries(roleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><button className={`status-toggle ${item.status === 'active' ? 'is-active' : ''}`} disabled={item.id === admin?.id} onClick={() => void updateAdministrator(item, { status: item.status === 'active' ? 'disabled' : 'active' })}>{item.status === 'active' ? '已启用' : '已停用'}</button><button className="icon-button danger-icon" disabled={item.id === admin?.id} aria-label={`删除${item.displayName}`} onClick={() => void removeAdministrator(item)}><Trash2 /></button></article>)}</div>
    </section> : null}

    <div className="security-grid"><section className="panel security-card security-two-factor"><div className="settings-heading"><div><span className="overline">Two-factor authentication</span><h2>双重验证</h2><p>兼容常见 TOTP 身份验证器，并提供一次性恢复码。</p></div><KeyRound /></div>
      {recoveryCodes.length ? <div className="recovery-codes"><strong>请立即保存恢复码</strong><p>每个恢复码只能使用一次，关闭此提示后不会再次显示。</p><code>{recoveryCodes.join('\n')}</code><button className="button button--secondary" onClick={() => setRecoveryCodes([])}><Check /> 我已安全保存</button></div> : admin?.twoFactorEnabled ? <form className="form-stack" onSubmit={disableTwoFactor}><div className="settings-saved-note"><Check /> 当前账号已启用双重验证。</div><label className="field"><span>当前密码</span><input type="password" value={disablePassword} onChange={(event) => setDisablePassword(event.target.value)} required /></label><label className="field"><span>动态验证码</span><input inputMode="numeric" value={disableCode} onChange={(event) => setDisableCode(event.target.value)} pattern="[0-9]{6}" required /></label><button className="button button--secondary" type="submit">关闭双重验证</button></form> : setup ? <form className="form-stack" onSubmit={enableTwoFactor}><div className="totp-secret"><span>在身份验证器中添加以下密钥</span><code>{setup.secret}</code><small>也可复制配置 URI：{setup.otpauthUrl}</small></div><label className="field"><span>6 位动态验证码</span><input inputMode="numeric" autoComplete="one-time-code" value={setupCode} onChange={(event) => setSetupCode(event.target.value)} pattern="[0-9]{6}" required /></label><button className="button button--primary" type="submit">验证并启用</button></form> : <form className="form-stack" onSubmit={beginSetup}><label className="field"><span>当前密码</span><input type="password" value={setupPassword} onChange={(event) => setSetupPassword(event.target.value)} required /></label><button className="button button--primary" type="submit"><KeyRound /> 开始设置 2FA</button></form>}
    </section>

    <section className="panel security-card security-sessions"><div className="settings-heading"><div><span className="overline">Active sessions</span><h2>登录设备 <small>{overview.sessions.length}</small></h2><p>查看当前账号的活动会话并让可疑设备退出。</p></div><button className="button button--secondary button--small" onClick={() => void revokeOthers()}>撤销其他会话</button></div><div className="session-list">{overview.sessions.map((item) => <article key={item.id}><Laptop /><div><strong>{item.deviceName} {item.current ? <em>当前设备</em> : null}</strong><span>{item.ipAddress} · 最近活动 {new Date(item.lastSeenAt).toLocaleString('zh-CN')}</span><small title={item.userAgent}>{item.userAgent}</small></div>{!item.current ? <button className="icon-button danger-icon" onClick={() => void revokeSession(item)} aria-label="撤销会话"><Trash2 /></button> : null}</article>)}</div></section></div>

    <section className="panel security-events"><div className="toolbar"><div className="toolbar-copy"><span className="overline">Login alerts</span><h2>登录与安全事件</h2><p>记录成功、失败、新设备与二次验证事件，并附带请求 ID 便于追踪。</p></div><button className="button button--secondary" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'is-spinning' : undefined} /> 刷新</button></div><div className="table-scroll"><table className="data-table"><thead><tr><th>状态</th><th>账号</th><th>设备</th><th>IP</th><th>说明</th><th>时间</th></tr></thead><tbody>{overview.events.map((item) => <tr key={item.id}><td><span className="security-event-status" data-status={item.success ? 'active' : 'error'}>{item.success ? '成功' : '失败'}</span></td><td>{item.username || '未知账号'}</td><td>{item.deviceName}</td><td>{item.ipAddress}</td><td title={`请求 ID：${item.requestId}`}>{item.reason}</td><td>{new Date(item.createdAt).toLocaleString('zh-CN')}</td></tr>)}</tbody></table></div></section>

    <Modal open={createOpen} onClose={() => setCreateOpen(false)} eyebrow="Administrator" title="添加管理员" footer={<><button className="button button--secondary" onClick={() => setCreateOpen(false)}>取消</button><button className="button button--primary" type="submit" form="create-admin-form" disabled={saving}>{saving ? '创建中…' : '创建管理员'}</button></>}><form id="create-admin-form" className="form-stack" onSubmit={createAdministrator}><div className="field-grid"><label className="field"><span>登录账号</span><input value={newAdmin.username} onChange={(event) => setNewAdmin({ ...newAdmin, username: event.target.value })} pattern="[A-Za-z0-9._-]{3,64}" required /></label><label className="field"><span>显示名称</span><input value={newAdmin.displayName} onChange={(event) => setNewAdmin({ ...newAdmin, displayName: event.target.value })} placeholder="例如：内容运营" /></label></div><label className="field"><span>初始密码</span><input type="password" minLength={6} value={newAdmin.password} onChange={(event) => setNewAdmin({ ...newAdmin, password: event.target.value })} required /><small>至少 6 位，管理员首次登录后可自行修改。</small></label><label className="field"><span>角色</span><select value={newAdmin.role} onChange={(event) => setNewAdmin({ ...newAdmin, role: event.target.value })}>{Object.entries(roleLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label><div className="settings-saved-note"><UserCog /> 角色权限由服务端强制执行，不能通过前端绕过。</div></form></Modal>
  </div>
}
