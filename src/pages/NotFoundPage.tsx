import { ArrowLeft } from 'lucide-react'
import { Link } from 'react-router-dom'

export function NotFoundPage() {
  return <main className="not-found"><span>404</span><h1>这个入口尚未配置。</h1><p>页面可能已移动、下线，或访问路径不正确。</p><Link className="button button--primary" to="/"><ArrowLeft /> 返回首页</Link></main>
}
