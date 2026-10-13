import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { AdminUser } from '../types'
import { ApiError, apiJson, apiRequest, authExpiredEvent, setCsrfToken } from '../lib/api'

interface AuthContextValue {
  admin: AdminUser | null
  loading: boolean
  sessionExpired: boolean
  login: (username: string, password: string) => Promise<{ requiresTwoFactor: boolean; challengeId?: string }>
  verifyTwoFactor: (challengeId: string, code: string) => Promise<void>
  logout: () => Promise<void>
  refresh: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [sessionExpired, setSessionExpired] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const result = await apiRequest<{ admin: AdminUser; csrfToken: string }>('/api/auth/me')
      setAdmin(result.admin)
    } catch {
      setCsrfToken('')
      setAdmin(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void refresh() }, [refresh])

  useEffect(() => {
    const handleExpiredSession = () => {
      setCsrfToken('')
      setAdmin((current) => {
        if (current) setSessionExpired(true)
        return null
      })
    }
    window.addEventListener(authExpiredEvent, handleExpiredSession)
    return () => window.removeEventListener(authExpiredEvent, handleExpiredSession)
  }, [])

  const login = useCallback(async (username: string, password: string) => {
    const result = await apiJson<{ admin?: AdminUser; csrfToken?: string; requiresTwoFactor: boolean; challengeId?: string }>('/api/auth/login', 'POST', { username, password })
    if (result.requiresTwoFactor) return { requiresTwoFactor: true, challengeId: result.challengeId }
    try {
      const verified = await apiRequest<{ admin: AdminUser; csrfToken: string }>('/api/auth/me')
      setAdmin(verified.admin)
      setSessionExpired(false)
      return { requiresTwoFactor: false }
    } catch (error) {
      setAdmin(null)
      if (error instanceof ApiError && error.status === 401) {
        throw new Error('账号密码验证成功，但浏览器未能建立登录会话，请检查访问协议或 Cookie 设置')
      }
      throw error
    }
  }, [])

  const verifyTwoFactor = useCallback(async (challengeId: string, code: string) => {
    await apiJson('/api/auth/two-factor', 'POST', { challengeId, code })
    const verified = await apiRequest<{ admin: AdminUser; csrfToken: string }>('/api/auth/me')
    setAdmin(verified.admin)
    setSessionExpired(false)
  }, [])

  const logout = useCallback(async () => {
    try {
      await apiJson('/api/auth/logout', 'POST')
    } finally {
      setAdmin(null)
      setCsrfToken('')
      setSessionExpired(false)
    }
  }, [])

  const value = useMemo(() => ({ admin, loading, sessionExpired, login, verifyTwoFactor, logout, refresh }), [admin, loading, sessionExpired, login, verifyTwoFactor, logout, refresh])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}

