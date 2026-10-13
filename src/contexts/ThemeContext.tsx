import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { Theme } from '../types'

interface ThemeContextValue {
  theme: Theme
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children, surface }: { children: ReactNode; surface: 'public' | 'admin' }) {
  const storageKey = `jtwz.${surface}.theme`
  const [theme, setTheme] = useState<Theme>(() => {
    const initial = document.documentElement.dataset.theme
    return initial === 'dark' ? 'dark' : 'light'
  })

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    document.documentElement.dataset.surface = surface
    document.documentElement.style.colorScheme = theme
  }, [surface, theme])

  const value = useMemo(
    () => ({
      theme,
      toggleTheme: () => {
        setTheme((current) => {
          const next = current === 'dark' ? 'light' : 'dark'
          localStorage.setItem(storageKey, next)
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
