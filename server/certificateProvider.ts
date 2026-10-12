import { config } from './config.js'
import { HttpError } from './http.js'
import { cloudflareRequest, findCloudflareZoneId } from './dnsProvider.js'

export type CertificateProviderStatus = { provider: 'manual' | 'cloudflare' | 'webhook'; configured: boolean }

export function certificateProviderStatus(): CertificateProviderStatus {
  return {
    provider: config.certificateProvider === 'cloudflare' ? 'cloudflare' : config.certificateProvider === 'webhook' ? 'webhook' : 'manual',
    configured: config.certificateProvider === 'cloudflare' ? Boolean(config.cloudflareApiToken) : config.certificateProvider === 'webhook' ? Boolean(config.dnsWebhookUrl) : false,
  }
}

export async function issueCertificate(hostname: string) {
  const status = certificateProviderStatus()
  if (!status.configured) throw new HttpError(503, 'HTTPS 证书服务商尚未完成配置')
  if (status.provider === 'webhook') {
    const response = await fetch(config.dnsWebhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.dnsWebhookSecret ? { Authorization: `Bearer ${config.dnsWebhookSecret}` } : {}) }, body: JSON.stringify({ action: 'issue_certificate', hostname }) })
    if (!response.ok) throw new HttpError(502, `证书 Webhook 返回 ${response.status}`)
    return { provider: status.provider, status: 'active' as const, zoneId: 'webhook' }
  }
  const zoneId = await findCloudflareZoneId(hostname)
  const ssl = await cloudflareRequest<{ value?: string }>(`/zones/${zoneId}/settings/ssl`)
  if (ssl?.value !== 'full') {
    await cloudflareRequest(`/zones/${zoneId}/settings/ssl`, { method: 'PATCH', body: JSON.stringify({ value: 'full' }) })
  }
  return { provider: status.provider, status: 'active' as const, zoneId }
}
