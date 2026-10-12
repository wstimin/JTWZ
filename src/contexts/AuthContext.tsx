import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AdminUser } from '../types'
import { apiJson, apiRequest } from '../lib/api'

interface AuthContextValue {
  admin: AdminUser | null
  loading: boolean
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const result = await apiRequest<{ admin: AdminUser }>('/api/auth/me')
      setAdmin(result.admin)
    } catch {
      setAdmin(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  const login = useCallback(async (username: string, password: string) => {
    const result = await apiJson<{ admin: AdminUser }>('/api/auth/login', 'POST', { username, password })
    setAdmin(result.admin)
  }, [])

  const logout = useCallback(async () => {
    try {
      await apiJson('/api/auth/logout', 'POST')
    } finally {
      setAdmin(null)
    }
  }, [])

  const value = useMemo(() => ({ admin, loading, login, logout, refresh }), [admin, loading, login, logout, refresh])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}

