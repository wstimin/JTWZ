import { ArrowRight, Box, Check, Download, FileCode2, Globe2, PackageCheck, ShieldCheck, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { AnnouncementRecord, BrandSettings, SoftwareRecord } from '../types'
import { PublicNav } from '../components/PublicNav'
import { PublicMeta } from '../components/PublicMeta'
import { PublicNotice } from '../components/PublicState'

const capabilities = [
  { index: '01', eyebrow: 'Domain routing', title: '让每个域名抵达正确页面', description: '来源域名、目标地址、路径保留与生效时间全部动态配置，跳转业务与软件下载保持独立。', icon: Globe2 },
  { index: '02', eyebrow: 'Static publishing', title: '把静态作品正式发布上线', description: '上传网站版本、绑定自定义域名，并保留可回滚的发布历史，让内容交付清晰可控。', icon: FileCode2 },
  { index: '03', eyebrow: 'Software delivery', title: '跨平台软件安全交付', description: '版本、发布通道与安装包独立管理，大文件直达对象存储，下载记录可追踪。', icon: Box },
  { index: '04', eyebrow: 'Operational trust', title: '用状态与审计守住可靠性', description: 'DNS 验证、HTTPS 状态、操作日志和下载统计汇聚在同一套平台能力中。', icon: ShieldCheck },
]

function formatDownloads(value: number) {
  if (value >= 10_000) return `${(value / 10_000).toFixed(value >= 100_000 ? 0 : 1)} 万`
  return value.toLocaleString('zh-CN')
}

export function LandingPage({ settings, software, announcements, notice, onRetry }: { settings: BrandSettings; software: SoftwareRecord[]; announcements: AnnouncementRecord[]; notice?: string; onRetry: () => void }) {
  const featured = software[0]
  const totalDownloads = software.reduce((sum, item) => sum + item.downloads, 0)
  const platformCount = new Set(software.map((item) => item.platform).filter(Boolean)).size

  return (
    <div className="marketing-page public-home">
      <PublicMeta title={settings.name} description={settings.tagline || '软件产品、版本更新与安全下载。'} brand={settings.name} />
      <PublicNav settings={settings} />
      {notice ? <PublicNotice message={notice} onRetry={onRetry} /> : null}

      <main>
        <section className="hero-section shell public-home-hero">
          <div className="hero-copy-wrap">
            <p className="eyebrow">Digital experiences, delivered with care</p>
            <h1>让每一次访问，<span>都抵达值得信任的体验。</span></h1>
            <p className="hero-lead">{settings.name} 将域名入口、静态内容与软件下载连接成完整的公开体验。访客看到的是清晰、稳定的产品与内容，而复杂的发布流程留在系统背后。</p>
            <div className="hero-actions">
              <Link className="button button--primary" to="/downloads">浏览软件产品 <ArrowRight /></Link>
              <a className="button button--secondary" href="#capabilities">了解服务能力</a>
            </div>
            <div className="public-home-metrics" aria-label="平台公开数据">
              <span><strong>{software.length}</strong><small>款公开产品</small></span>
              <span><strong>{formatDownloads(totalDownloads)}</strong><small>累计下载</small></span>
              <span><strong>{platformCount}</strong><small>个交付平台</small></span>
            </div>
          </div>

          <aside className="glass-card release-showcase" aria-label="最新软件版本">
            <div className="window-line"><div className="window-dots"><span /><span /><span /></div><span>PUBLIC RELEASE · VERIFIED</span></div>
            {featured ? <>
              <div className="release-showcase-mark">{featured.accent}</div>
              <p className="overline">Featured release</p>
              <h2>{featured.name}</h2>
              <p>{featured.description}</p>
              <div className="release-showcase-version"><span><small>推荐版本</small><strong>v{featured.version || '待发布'}</strong></span><span><small>支持平台</small><strong>{featured.platform || '持续更新'}</strong></span></div>
              <div className="release-showcase-status"><span><Check /> 已公开发布</span><span>{formatDownloads(featured.downloads)} 次下载</span></div>
              <Link className="button button--primary" to={`/downloads/${featured.slug}`}>查看版本与安装包 <ArrowRight /></Link>
            </> : <div className="release-showcase-empty"><PackageCheck /><h2>产品即将发布</h2><p>公开产品会在完成发布后显示在这里。</p></div>}
          </aside>
        </section>

        <section className="home-product-section" id="products">
          <div className="shell">
            <div className="section-heading public-section-heading"><div><p className="eyebrow">Products & downloads</p><h2>为真实使用场景准备的产品。</h2></div><p>所有内容来自当前发布数据。进入产品详情即可查看版本说明、平台安装包和完整性校验信息。</p></div>
            <div className="home-product-grid">
              {software.slice(0, 3).map((item) => <article className="glass-card home-product-card" key={item.id}>
                <div className="home-product-card-top"><span className="software-monogram">{item.accent}</span><span className="content-status" data-status={item.status === 'published' ? 'available' : 'processing'}>{item.status === 'published' ? '正式发布' : '公开测试'}</span></div>
                <p className="overline">{item.platform || 'Multi-platform'}</p><h3>{item.name}</h3><p>{item.description}</p>
                <div className="home-product-meta"><span>v{item.version || '待发布'}</span><span>{item.architecture}</span><span>{formatDownloads(item.downloads)} 次下载</span></div>
                <Link className="text-link" to={`/downloads/${item.slug}`}>查看产品详情 <ArrowRight /></Link>
              </article>)}
            </div>
            {!software.length ? <div className="glass-card home-empty-card"><PackageCheck /><div><strong>产品目录正在准备</strong><span>发布的软件会自动出现在公开首页和下载中心。</span></div></div> : null}
            <div className="home-product-more"><Link className="button button--secondary" to="/downloads"><Download /> 查看全部软件下载</Link></div>
          </div>
        </section>

        <section className="capabilities-section shell" id="capabilities">
          <div className="section-heading public-section-heading"><div><p className="eyebrow">One connected platform</p><h2>从入口到交付，保持同一份可靠。</h2></div><p>这不是单一下载站。域名跳转、静态网站发布和软件分发各自独立，又共享品牌、状态与安全基础设施。</p></div>
          <div className="capability-grid">
            {capabilities.map((item) => { const Icon = item.icon; return <article className="glass-card capability-card" key={item.index}><div className="capability-topline"><span>{item.index} / {item.eyebrow}</span><Icon /></div><h3>{item.title}</h3><p>{item.description}</p><div className="orbit-art" aria-hidden="true"><span /><span /></div></article> })}
          </div>
        </section>

        <section className="delivery-story" id="about">
          <div className="shell delivery-story-grid">
            <div className="delivery-story-copy"><p className="eyebrow">A clear delivery path</p><h2>内容如何抵达访客，应当清楚而可验证。</h2><p>每一步都保留明确状态：域名先验证、版本再发布、安装包完成完整性检查后才进入公开下载。公开页面只展示已经发布的内容。</p>{settings.supportEmail ? <a className="text-link" href={`mailto:${settings.supportEmail}`}>联系支持团队 <ArrowRight /></a> : null}</div>
            <ol className="delivery-steps">
              <li><span>01</span><div><strong>验证入口</strong><p>确认域名所有权与 HTTPS 状态，避免未授权入口被启用。</p></div></li>
              <li><span>02</span><div><strong>发布内容</strong><p>静态网站和软件版本拥有独立发布状态，草稿不会出现在公开站。</p></div></li>
              <li><span>03</span><div><strong>安全交付</strong><p>安装包通过校验后的签名地址直达对象存储，并记录真实成功下载。</p></div></li>
            </ol>
          </div>
        </section>

        <section className="home-announcements shell" id="announcements">
          <div className="section-heading public-section-heading"><div><p className="eyebrow">Latest updates</p><h2>产品动态与服务公告。</h2></div><p>由团队从管理后台正式发布，帮助访客及时了解版本变化和服务安排。</p></div>
          <div className="announcement-public-grid">
            {announcements.slice(0, 3).map((item) => <article className="glass-card announcement-public-card" key={item.id}><div><span className="announcement-pin">{item.pinned ? '置顶公告' : '最新动态'}</span><time>{new Date(item.publishedAt || item.createdAt).toLocaleDateString('zh-CN')}</time></div><h3>{item.title}</h3><p>{item.body}</p></article>)}
            {!announcements.length ? <article className="glass-card announcement-public-card announcement-public-card--empty"><Sparkles /><h3>暂无服务公告</h3><p>重要版本和服务动态会在这里公开发布。</p></article> : null}
          </div>
        </section>

        <section className="public-cta shell"><div className="glass-card public-cta-inner"><div><p className="eyebrow">Ready when you are</p><h2>找到适合你的版本，开始使用。</h2><p>前往软件下载中心查看当前公开产品、平台安装包和版本更新说明。</p></div><Link className="button button--primary" to="/downloads">前往下载中心 <ArrowRight /></Link></div></section>
      </main>

      <footer className="public-footer shell"><div className="brand-footer"><strong>{settings.name}</strong><span>{settings.footerText}</span></div><div className="footer-links"><Link to="/downloads"><Download /> 软件下载</Link>{settings.supportEmail ? <a href={`mailto:${settings.supportEmail}`}>联系我们</a> : null}<span>© {new Date().getFullYear()}</span></div></footer>
    </div>
  )
}
