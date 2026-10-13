import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Theme } from '../types'

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readInitialTheme(storageKey: string): Theme {
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved === 'light' || saved === 'dark') return saved
  } catch {
    // Storage may be unavailable in hardened or private browser contexts.
  }
  const initial = document.documentElement.dataset.theme
  if (initial === 'light' || initial === 'dark') return initial
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

export function ThemeProvider({ children, surface }: { children: ReactNode; surface: 'public' | 'admin' }) {
  const storageKey = `jtwz.${surface}.theme`
  const [theme, setTheme] = useState<Theme>(() => readInitialTheme(storageKey))

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.surface = surface
    document.documentElement.style.colorScheme = theme
  }, [surface, theme])

  useEffect(() => {
    const syncStoredTheme = (event: StorageEvent) => {
      if (event.key !== storageKey || (event.newValue !== 'light' && event.newValue !== 'dark')) return
      setTheme(event.newValue)
    }
    window.addEventListener('storage', syncStoredTheme)
    return () => window.removeEventListener('storage', syncStoredTheme)
  }, [storageKey])

  const value = useMemo(
    () => ({
      theme,
      toggleTheme: () => {
        setTheme((current) => {
          const next = current === 'dark' ? 'light' : 'dark'
          try {
            localStorage.setItem(storageKey, next)
          } catch {
            // The active page still follows the selected theme when storage is unavailable.
          }
          return next
        })
      },
    }),
    [storageKey, theme],
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme() {
  const value = useContext(ThemeContext)
  if (!value) throw new Error('useTheme must be used inside ThemeProvider')
  return value
}
