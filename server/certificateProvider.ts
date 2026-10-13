import { config } from './config.js'
import { HttpError } from './http.js'
import { cloudflareRequest, findCloudflareZoneId } from './dnsProvider.js'

export type CertificateProviderStatus = { provider: 'manual' | 'cloudflare' | 'webhook'; configured: boolean }
export type CertificateProviderResult = {
  provider: 'cloudflare' | 'webhook'
  status: 'active'
  externalRef: string
  issuer: string
  serialNumber?: string
  issuedAt?: string
  expiresAt?: string
}

export function certificateProviderStatus(): CertificateProviderStatus {
  return {
    provider: config.certificateProvider === 'cloudflare' ? 'cloudflare' : config.certificateProvider === 'webhook' ? 'webhook' : 'manual',
    configured: config.certificateProvider === 'cloudflare' ? Boolean(config.cloudflareApiToken) : config.certificateProvider === 'webhook' ? Boolean(config.dnsWebhookUrl) : false,
  }
}

export async function issueCertificate(hostname: string): Promise<CertificateProviderResult> {
  const status = certificateProviderStatus()
  if (!status.configured) throw new HttpError(503, 'HTTPS 证书服务商尚未完成配置')
  if (status.provider === 'webhook') {
    const response = await fetch(config.dnsWebhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.dnsWebhookSecret ? { Authorization: `Bearer ${config.dnsWebhookSecret}` } : {}) }, body: JSON.stringify({ action: 'issue_certificate', hostname }) })
    const payload = await response.json().catch(() => ({})) as Record<string, unknown>
    if (!response.ok) throw new HttpError(502, String(payload.message || `证书 Webhook 返回 ${response.status}`))
    return {
      provider: 'webhook', status: 'active', externalRef: String(payload.externalRef || payload.id || 'webhook'),
      issuer: String(payload.issuer || 'Webhook certificate provider'), serialNumber: String(payload.serialNumber || ''),
      issuedAt: payload.issuedAt ? String(payload.issuedAt) : new Date().toISOString(), expiresAt: payload.expiresAt ? String(payload.expiresAt) : undefined,
    }
  }
  const zoneId = await findCloudflareZoneId(hostname)
  const ssl = await cloudflareRequest<{ value?: string }>(`/zones/${zoneId}/settings/ssl`)
  if (ssl?.value !== 'full') {
    await cloudflareRequest(`/zones/${zoneId}/settings/ssl`, { method: 'PATCH', body: JSON.stringify({ value: 'full' }) })
  }
  return { provider: 'cloudflare', status: 'active', externalRef: zoneId, issuer: 'Cloudflare Universal SSL', issuedAt: new Date().toISOString() }
}

export async function deleteCertificate(hostname: string, externalRef: string) {
  const status = certificateProviderStatus()
  if (status.provider !== 'webhook' || !status.configured) return { detachedOnly: true }
  const response = await fetch(config.dnsWebhookUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(config.dnsWebhookSecret ? { Authorization: `Bearer ${config.dnsWebhookSecret}` } : {}) },
    body: JSON.stringify({ action: 'delete_certificate', hostname, externalRef }),
  })
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok) throw new HttpError(502, String(payload.message || `证书 Webhook 返回 ${response.status}`))
  return { detachedOnly: false }
}
