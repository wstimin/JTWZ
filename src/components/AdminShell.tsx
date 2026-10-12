import {
  Activity,
  ClipboardList,
  Box,
  ChevronLeft,
  Download,
  Gauge,
  Globe2,
  Layers3,
  LogOut,
  Menu,
  PackageOpen,
  Search,
  Settings,
  Sparkles,
  Waypoints,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import type { BrandSettings } from '../types'
import { BrandMark } from './BrandMark'
import { ThemeToggle } from './ThemeToggle'
import { useAuth } from '../contexts/AuthContext'
import { publicSiteUrl } from '../lib/appUrls'

const groups = [
  {
    label: '管理',
    links: [
      { to: '/admin', label: '仪表盘', icon: Gauge, end: true },
      { to: '/admin/domains', label: '域名管理', icon: Globe2 },
      { to: '/admin/redirects', label: '跳转规则', icon: Waypoints },
    ],
  },
  {
    label: '内容',
    links: [
      { to: '/admin/sites', label: '静态网站', icon: Layers3 },
      { to: '/admin/software', label: '软件管理', icon: Box },
      { to: '/admin/versions', label: '版本管理', icon: PackageOpen },
      { to: '/admin/packages', label: '安装包', icon: PackageOpen },
      { to: '/admin/announcements', label: '公告管理', icon: Sparkles },
      { to: '/admin/analytics', label: '数据统计', icon: Activity },
      { to: '/admin/audit-logs', label: '操作日志', icon: ClipboardList },
    ],
  },
  {
    label: '系统',
    links: [{ to: '/admin/settings', label: '系统设置', icon: Settings }],
  },
]

const pageMeta: Record<string, { title: string; description: string }> = {
  '/admin': { title: '仪表盘', description: '统一查看域名、网站与软件下载状态。' },
  '/admin/domains': { title: '域名管理', description: '接入、验证并管理每一个数字入口。' },
  '/admin/redirects': { title: '跳转规则', description: '灵活编排域名和路径的去向。' },
  '/admin/sites': { title: '静态网站', description: '上传、发布并绑定你的静态页面。' },
  '/admin/software': { title: '软件管理', description: '管理软件资料、版本与发布状态。' },
  '/admin/versions': { title: '版本管理', description: '维护版本说明、平台信息和下载状态。' },
  '/admin/packages': { title: '安装包', description: '管理对象存储中的安装包文件。' },
  '/admin/announcements': { title: '公告管理', description: '发布软件下载中心和公开页面的最新通知。' },
  '/admin/analytics': { title: '数据统计', description: '从访问入口到内容交付的完整洞察。' },
  '/admin/audit-logs': { title: '操作日志', description: '追踪管理员登录、配置变更与发布操作。' },
  '/admin/settings': { title: '系统设置', description: '调整品牌、通知与平台参数。' },
}

export function AdminShell({ settings }: { settings: BrandSettings }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [search, setSearch] = useState('')
  const [searchOpen, setSearchOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)
  const location = useLocation()
  const navigate = useNavigate()
  const { admin, logout } = useAuth()
  const meta = pageMeta[location.pathname] ?? pageMeta['/admin']
  const searchableLinks = useMemo(() => groups.flatMap((group) => group.links), [])
  const searchResults = searchableLinks.filter((item) => item.label.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 6)

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        searchRef.current?.focus()
        setSearchOpen(true)
      }
    }
    window.addEventListener('keydown', handleShortcut)
    return () => window.removeEventListener('keydown', handleShortcut)
  }, [])

  function chooseSearchResult(path: string) {
    navigate(path)
    setSearch('')
    setSearchOpen(false)
  }

  return (
    <div className={collapsed ? 'admin-layout is-collapsed' : 'admin-layout'}>
      {mobileOpen ? <button className="admin-scrim" aria-label="关闭菜单" onClick={() => setMobileOpen(false)} /> : null}
      <aside className={mobileOpen ? 'admin-sidebar is-mobile-open' : 'admin-sidebar'}>
        <div className="admin-brand-row">
          <Link className="admin-brand" to="/admin" onClick={() => setMobileOpen(false)}>
            <BrandMark compact logoUrl={settings.logoUrl} />
            <span>{settings.name}</span>
          </Link>
          <button className="mobile-close" type="button" onClick={() => setMobileOpen(false)} aria-label="关闭菜单">
            <X />
          </button>
        </div>

        <div className="admin-nav-scroll">
          {groups.map((group) => (
            <div className="admin-nav-group" key={group.label}>
              <span className="admin-nav-label">{group.label}</span>
              {group.links.map((item) => {
                const Icon = item.icon
                return (
                  <NavLink
                    className={({ isActive }) => (isActive ? 'admin-nav-link is-active' : 'admin-nav-link')}
                    to={item.to}
                    end={item.end}
                    key={item.to}
                    onClick={() => setMobileOpen(false)}
                    title={collapsed ? item.label : undefined}
                  >
                    <Icon />
                    <span>{item.label}</span>
                  </NavLink>
                )
              })}
            </div>
          ))}
        </div>

        <div className="admin-sidebar-footer">
          <button className="admin-nav-link collapse-button" type="button" onClick={() => setCollapsed((current) => !current)}>
            <ChevronLeft />
            <span>{collapsed ? '展开导航' : '收起导航'}</span>
          </button>
          <a className="admin-nav-link" href={publicSiteUrl('/')}>
            <LogOut />
            <span>返回网站</span>
          </a>
          <button className="admin-nav-link" type="button" onClick={() => { void logout().then(() => navigate('/admin/login', { replace: true })) }}>
            <LogOut />
            <span>退出登录</span>
          </button>
        </div>
      </aside>

      <div className="admin-main">
        <header className="admin-topbar">
          <div className="admin-title-group">
            <button className="mobile-menu" type="button" onClick={() => setMobileOpen(true)} aria-label="打开菜单">
              <Menu />
            </button>
            <div>
              <span className="admin-breadcrumb">控制台 / {meta.title}</span>
              <h1>{meta.title}</h1>
            </div>
          </div>

          <div className="admin-search">
            <Search />
            <input ref={searchRef} value={search} onChange={(event) => { setSearch(event.target.value); setSearchOpen(true) }} onFocus={() => setSearchOpen(true)} onBlur={() => window.setTimeout(() => setSearchOpen(false), 120)} onKeyDown={(event) => { if (event.key === 'Enter' && searchResults[0]) chooseSearchResult(searchResults[0].to) }} placeholder="搜索后台功能…" aria-label="搜索后台功能" aria-expanded={searchOpen && Boolean(search)} />
            <kbd>⌘ K</kbd>
            {searchOpen && search ? <div className="admin-search-results">{searchResults.map((item) => { const Icon = item.icon; return <button type="button" key={item.to} onMouseDown={(event) => event.preventDefault()} onClick={() => chooseSearchResult(item.to)}><Icon /><span>{item.label}</span></button> })}{!searchResults.length ? <span>没有匹配的后台功能</span> : null}</div> : null}
          </div>

          <div className="admin-top-actions">
            <ThemeToggle />
            <Link className="admin-profile" to="/admin/settings?section=admin" title="管理员账号设置">
              <span className="admin-avatar">A</span>
              <span className="admin-profile-copy">
                <strong>{admin?.username || '管理员'}</strong>
                <small>超级管理员</small>
              </span>
            </Link>
          </div>
        </header>

        <main className="admin-content">
          <div className="page-intro">
            <div>
              <span className="overline"><Sparkles /> Workspace</span>
              <p>{meta.description}</p>
            </div>
            {location.pathname === '/admin' ? (
              <Link className="button button--primary" to="/admin/domains">
                <Globe2 /> 添加域名
              </Link>
            ) : null}
          </div>
          <Outlet />
        </main>
      </div>

      <a className="quick-download" href={publicSiteUrl('/downloads')} aria-label="打开软件下载中心" title="软件下载中心">
        <Download />
      </a>
    </div>
  )
}
