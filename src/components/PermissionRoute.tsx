import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import type { AdminUser } from '../types'

type Permission = AdminUser['permissions'][number]

export function PermissionRoute({ permission, children }: { permission: Permission; children: ReactNode }) {
  const { admin } = useAuth()
  if (!admin?.permissions.includes(permission)) return <Navigate to="/" replace />
  return children
}
