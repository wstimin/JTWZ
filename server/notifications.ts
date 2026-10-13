import { createHmac } from 'node:crypto'
import { config } from './config.js'

export function notificationsConfigured() {
  return Boolean(config.alertWebhookUrl)
}

export function notifyAlert(event: { type: string; title: string; detail: string; entityId?: string }) {
  if (!config.alertWebhookUrl) return
  const payload = JSON.stringify({ ...event, service: 'jtwz-platform', createdAt: new Date().toISOString() })
  const signature = createHmac('sha256', config.alertWebhookSecret || config.appSecret).update(payload).digest('hex')
  void fetch(config.alertWebhookUrl, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-JTWZ-Signature': signature }, body: payload })
    .then((response) => { if (!response.ok) console.error(`[ALERT] webhook returned ${response.status}`) })
    .catch((error) => console.error('[ALERT] webhook failed', error))
}
