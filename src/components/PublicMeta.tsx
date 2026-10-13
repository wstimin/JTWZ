import { useEffect } from 'react'

function upsertMeta(name: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  if (!element) {
    element = document.createElement('meta')
    element.name = name
    document.head.appendChild(element)
  }
  element.content = content
}

export function PublicMeta({ title, description, brand, noIndex = false }: { title: string; description: string; brand: string; noIndex?: boolean }) {
  useEffect(() => {
    document.title = title === brand ? brand : `${title} · ${brand}`
    upsertMeta('description', description)
    upsertMeta('robots', noIndex ? 'noindex,nofollow' : 'index,follow')
    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]')
    if (!canonical) {
      canonical = document.createElement('link')
      canonical.rel = 'canonical'
      document.head.appendChild(canonical)
    }
    canonical.href = `${window.location.origin}${window.location.pathname}`
  }, [brand, description, noIndex, title])

  return null
}
