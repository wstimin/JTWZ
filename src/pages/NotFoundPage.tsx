import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'
import type { BrandSettings } from '../types'
import { PublicMeta } from '../components/PublicMeta'
import { PublicNav } from '../components/PublicNav'

export function NotFoundPage({ settings }: { settings: BrandSettings }) {
  return <div className="marketing-page"><PublicMeta title="页面不存在" description="访问的页面不存在或已经移动。" brand={settings.name} noIndex /><PublicNav settings={settings} /><main className="not-found"><span>404</span><h1>这个页面不存在。</h1><p>页面可能已移动、下线，或访问路径不正确。</p><Link className="button button--primary" to="/"><ArrowLeft /> 返回首页</Link></main></div>
}
