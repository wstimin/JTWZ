import { Menu, X } from 'lucide-react'
import { useState } from 'react'
import { Link, NavLink } from 'react-router-dom'
import type { BrandSettings } from '../types'
import { BrandMark } from './BrandMark'
import { ThemeToggle } from './ThemeToggle'

export function PublicNav({ settings, minimal = false }: { settings: BrandSettings; minimal?: boolean }) {
  const [open, setOpen] = useState(false)

  return (
    <header className="public-header">
      <nav className="public-nav shell" aria-label="主导航">
        <Link className="brand" to="/" onClick={() => setOpen(false)}>
          <BrandMark logoUrl={settings.logoUrl} />
          <span>{settings.name}</span>
        </Link>

        {!minimal ? <div className={open ? 'public-links is-open' : 'public-links'}>
          <NavLink to="/" end onClick={() => setOpen(false)}>首页</NavLink>
          <NavLink to="/downloads" onClick={() => setOpen(false)}>软件下载</NavLink>
          <a href="/#products" onClick={() => setOpen(false)}>产品</a>
          <a href="/#capabilities" onClick={() => setOpen(false)}>服务能力</a>
          <a href="/#announcements" onClick={() => setOpen(false)}>最新动态</a>
          <a href="/#about" onClick={() => setOpen(false)}>关于</a>
          <div className="mobile-theme-row">
            <span>外观主题</span>
            <ThemeToggle />
          </div>
        </div> : null}

        <div className="public-actions">
          {!minimal ? <Link className="button button--secondary button--small public-console-button" to="/downloads">获取软件</Link> : null}
          <span className="desktop-theme-toggle"><ThemeToggle /></span>
          {!minimal ? <button
            className="nav-menu-button"
            type="button"
            onClick={() => setOpen((current) => !current)}
            aria-expanded={open}
            aria-label={open ? '关闭导航' : '打开导航'}
          >
            {open ? <X /> : <Menu />}
          </button> : null}
        </div>
      </nav>
    </header>
  )
}
