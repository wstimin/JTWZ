import { config } from './config.js'
import { HttpError } from './http.js'

export type DnsProviderStatus = { provider: 'manual' | 'cloudflare' | 'webhook'; configured: boolean }

export function dnsProviderStatus(): DnsProviderStatus {
  return {
    provider: config.dnsProvider === 'cloudflare' ? 'cloudflare' : config.dnsProvider === 'webhook' ? 'webhook' : 'manual',
    configured: config.dnsProvider === 'cloudflare' ? Boolean(config.cloudflareApiToken) : config.dnsProvider === 'webhook' ? Boolean(config.dnsWebhookUrl) : false,
  }
}

function assertConfigured() {
  const status = dnsProviderStatus()
  if (!status.configured) throw new HttpError(503, 'DNS 服务商尚未完成配置')
}

export async function cloudflareRequest<T>(path: string, init: RequestInit = {}) {
  assertConfigured()
  const response = await fetch(`${config.cloudflareApiBase}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${config.cloudflareApiToken}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  })
  const payload = await response.json().catch(() => ({})) as { success?: boolean; result?: T; errors?: Array<{ message?: string }> }
  if (!response.ok || payload.success === false) throw new HttpError(502, payload.errors?.map((item) => item.message).filter(Boolean).join('；') || 'DNS 服务商请求失败')
  return payload.result as T
}

function zoneCandidates(hostname: string) {
  const parts = hostname.split('.').filter(Boolean)
  const candidates: string[] = []
  for (let index = 0; index <= parts.length - 2; index += 1) candidates.push(parts.slice(index).join('.'))
  return candidates
}

export async function findCloudflareZoneId(hostname: string) {
  for (const candidate of zoneCandidates(hostname)) {
    const result = await cloudflareRequest<Array<{ id: string; name: string }>>(`/zones?name=${encodeURIComponent(candidate)}&status=active&per_page=1`)
    if (result?.[0]?.id) return result[0].id
  }
  throw new HttpError(404, 'Cloudflare 中没有找到该域名对应的 Zone')
}

export async function publishVerificationRecord(hostname: string, recordName: string, value: string) {
  if (config.dnsProvider === 'webhook') {
    if (!config.dnsWebhookUrl) throw new HttpError(503, 'DNS Webhook 尚未完成配置')
    const payload = JSON.stringify({ action: 'upsert_txt', hostname, recordName, type: 'TXT', value, ttl: 120 })
    const response = await fetch(config.dnsWebhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(config.dnsWebhookSecret ? { Authorization: `Bearer ${config.dnsWebhookSecret}` } : {}) }, body: payload })
    if (!response.ok) throw new HttpError(502, `DNS Webhook 返回 ${response.status}`)
    return { zoneId: 'webhook', recordId: '', action: 'updated' as const }
  }
  assertConfigured()
  const zoneId = await findCloudflareZoneId(hostname)
  const existing = await cloudflareRequest<Array<{ id: string }>>(`/zones/${zoneId}/dns_records?type=TXT&name=${encodeURIComponent(recordName)}&per_page=20`)
  const body = JSON.stringify({ type: 'TXT', name: recordName, content: value, ttl: 120, proxied: false })
  if (existing?.[0]?.id) {
    await cloudflareRequest(`/zones/${zoneId}/dns_records/${existing[0].id}`, { method: 'PUT', body })
    return { zoneId, recordId: existing[0].id, action: 'updated' as const }
  }
  const created = await cloudflareRequest<{ id: string }>(`/zones/${zoneId}/dns_records`, { method: 'POST', body })
  return { zoneId, recordId: created.id, action: 'created' as const }
}
