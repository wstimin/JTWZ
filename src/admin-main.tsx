import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import AdminApp from './AdminApp'
import { AuthProvider } from './contexts/AuthContext'
import { ThemeProvider } from './contexts/ThemeContext'
import { ToastProvider } from './contexts/ToastContext'
import { adminBasePath } from './lib/appUrls'
import './styles/admin.css'

for (const legacyKey of ['aurelia-theme', 'jtwz-settings', 'jtwz-domains', 'jtwz-sites', 'jtwz-software', 'jtwz-packages']) {
  localStorage.removeItem(legacyKey)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter basename={adminBasePath}>
      <ThemeProvider surface="admin">
        <AuthProvider>
          <ToastProvider>
            <AdminApp />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
