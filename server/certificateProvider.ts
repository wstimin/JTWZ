import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { config } from './config.js'
import { HttpError } from './http.js'
import { cloudflareRequest, findCloudflareZoneId } from './dnsProvider.js'

const execFileAsync = promisify(execFile)

export type CertificateProviderStatus = { provider: 'manual' | 'certbot' | 'cloudflare' | 'webhook'; configured: boolean }
export type CertificateProviderResult = {
  provider: 'certbot' | 'cloudflare' | 'webhook'
  status: 'active'
  externalRef: string
  issuer: string
  serialNumber?: string
  issuedAt?: string
  expiresAt?: string
}

export function certificateProviderStatus(): CertificateProviderStatus {
  return {
    provider: config.certificateProvider === 'certbot' ? 'certbot' : config.certificateProvider === 'cloudflare' ? 'cloudflare' : config.certificateProvider === 'webhook' ? 'webhook' : 'manual',
    configured: config.certificateProvider === 'certbot' ? Boolean(config.domainApplyCommand) : config.certificateProvider === 'cloudflare' ? Boolean(config.cloudflareApiToken) : config.certificateProvider === 'webhook' ? Boolean(config.dnsWebhookUrl) : false,
  }
}

function domainApplyArgs() {
  try {
    const parsed = JSON.parse(config.domainApplyArgsJson)
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) throw new Error()
    return parsed as string[]
  } catch {
    throw new HttpError(500, 'DOMAIN_APPLY_ARGS_JSON 必须是字符串数组')
  }
}

async function runDomainAction(action: 'route' | 'ensure' | 'remove' | 'purge', hostname: string) {
  if (!config.domainApplyCommand) return { configured: false }
  try {
    const result = await execFileAsync(config.domainApplyCommand, [...domainApplyArgs(), action, hostname], {
      timeout: 240_000, windowsHide: true, maxBuffer: 1024 * 1024,
      env: { ...process.env, JTWZ_CERTBOT_EMAIL: process.env.SUPPORT_EMAIL || '' },
    })
    return { configured: true, output: String(result.stdout || '').trim() }
  } catch (error) {
    const reason = error as Error & { stderr?: string; stdout?: string }
    const detail = String(reason.stderr || reason.stdout || reason.message || '域名执行器失败').trim().split(/\r?\n/).slice(-3).join('；')
    throw new HttpError(502, `域名与 HTTPS 配置失败：${detail}`)
  }
}

export function domainAutomationConfigured() {
  return Boolean(config.domainApplyCommand)
}

export function configureDomainRoute(hostname: string) {
  return runDomainAction('route', hostname)
}

export function removeDomainRoute(hostname: string) {
  return runDomainAction('purge', hostname)
}

export async function issueCertificate(hostname: string): Promise<CertificateProviderResult> {
  const status = certificateProviderStatus()
  if (!status.configured) throw new HttpError(503, 'HTTPS 证书服务商尚未完成配置')
  if (status.provider === 'certbot') {
    await runDomainAction('ensure', hostname)
    const issuedAt = new Date()
    return {
      provider: 'certbot', status: 'active', externalRef: hostname, issuer: "Let's Encrypt",
      issuedAt: issuedAt.toISOString(), expiresAt: new Date(issuedAt.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString(),
    }
  }
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

export async function deleteCertificate(hostname: string, externalRef: string, provider = '') {
  const status = certificateProviderStatus()
  if (provider === 'certbot') {
    await runDomainAction('remove', hostname)
    return { detachedOnly: false }
  }
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
