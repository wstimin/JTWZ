function normalizedBase(value: string | undefined) {
  return (value || '').trim().replace(/\/$/, '')
}

export const apiBaseUrl = normalizedBase(import.meta.env.VITE_API_BASE_URL)
export const publicSiteBaseUrl = normalizedBase(import.meta.env.VITE_PUBLIC_SITE_URL)
export const adminSiteBaseUrl = normalizedBase(import.meta.env.VITE_ADMIN_SITE_URL)

function join(base: string, path: string) {
  if (/^https?:\/\//i.test(path)) return path
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  return base ? `${base}${normalizedPath}` : normalizedPath
}

export const apiUrl = (path: string) => join(apiBaseUrl, path)
export const publicSiteUrl = (path = '/') => join(publicSiteBaseUrl, path)
export const adminSiteUrl = (path = '/admin') => join(adminSiteBaseUrl, path)
