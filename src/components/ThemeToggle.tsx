import { Moon, Sun } from 'lucide-react'
import { useTheme } from '../contexts/ThemeContext'

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme()

  return (
    <button
      className="theme-toggle"
      type="button"
      aria-label={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
      aria-pressed={theme === 'dark'}
      onClick={toggleTheme}
      title={theme === 'dark' ? '切换到浅色模式' : '切换到深色模式'}
    >
      <Sun className="theme-icon theme-icon--sun" />
      <Moon className="theme-icon theme-icon--moon" />
    </button>
  )
}
