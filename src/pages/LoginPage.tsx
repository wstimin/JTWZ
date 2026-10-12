import { ArrowLeft, ArrowRight, Eye, EyeOff, LockKeyhole, ShieldCheck } from 'lucide-react'
import { FormEvent, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { BrandSettings } from '../types'
import { BrandMark } from '../components/BrandMark'
import { ThemeToggle } from '../components/ThemeToggle'
import { useAuth } from '../contexts/AuthContext'
import { useToast } from '../contexts/ToastContext'
import { publicSiteUrl } from '../lib/appUrls'

export function LoginPage({ settings }: { settings: BrandSettings }) {
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const navigate = useNavigate()
  const location = useLocation()
  const { login } = useAuth()
  const { notify } = useToast()

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    setError('')
    try {
      await login(username, password)
      notify('身份验证成功，欢迎回来')
      const destination = (location.state as { from?: string } | null)?.from || '/admin'
      navigate(destination, { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '登录失败，请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <div className="login-glow login-glow--one" />
      <div className="login-glow login-glow--two" />

      <div className="login-topbar shell">
        <a className="brand" href={publicSiteUrl('/')}>
          <BrandMark logoUrl={settings.logoUrl} />
          <span>{settings.name}</span>
        </a>
        <ThemeToggle />
      </div>

      <div className="login-shell shell">
        <section className="login-story">
          <p className="eyebrow">Private Management Console</p>
          <h1>每一个入口，<br /><span>都清晰可控。</span></h1>
          <p>登录后统一管理域名跳转、静态网站、软件版本与安装包。所有关键操作都会留下审计记录。</p>
          <div className="security-note">
            <ShieldCheck />
            <div>
              <strong>安全登录保护</strong>
              <span>已启用 HttpOnly 会话、失败限制与操作审计。</span>
            </div>
          </div>
        </section>

        <section className="glass-card login-card">
          <div className="login-card-head">
            <span className="overline">Welcome back</span>
            <h2>登录管理后台</h2>
            <p>请输入管理员账号完成身份验证。</p>
          </div>
          <form onSubmit={submit}>
            <label className="field">
              <span>管理员账号</span>
              <input type="text" placeholder="请输入管理员账号" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" required />
            </label>
            <label className="field">
              <span>登录密码</span>
              <span className="password-input">
                <LockKeyhole />
                <input type={showPassword ? 'text' : 'password'} placeholder="请输入登录密码" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
                <button type="button" onClick={() => setShowPassword((current) => !current)} aria-label={showPassword ? '隐藏密码' : '显示密码'}>
                  {showPassword ? <EyeOff /> : <Eye />}
                </button>
              </span>
            </label>
            {error ? <p className="form-error" role="alert">{error}</p> : null}
            <div className="login-options">
              <span>会话由安全 Cookie 管理</span>
              {settings.supportEmail ? <a href={`mailto:${settings.supportEmail}?subject=${encodeURIComponent(`${settings.name} 管理员密码重置`)}`}>联系支持重置密码</a> : <span>密码重置请联系系统负责人</span>}
            </div>
            <button className="button button--primary login-submit" type="submit" disabled={loading}>
              {loading ? '正在进入…' : '进入控制台'} <ArrowRight />
            </button>
          </form>
          <a className="back-link" href={publicSiteUrl('/')}><ArrowLeft /> 返回网站首页</a>
        </section>
      </div>
    </main>
  )
}
