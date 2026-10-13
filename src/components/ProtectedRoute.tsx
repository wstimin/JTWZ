import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import { BrandMark } from './BrandMark'

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { admin, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <div className="app-loading"><BrandMark /><span>正在验证安全会话…</span></div>
  }
  if (!admin) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

