import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const dataDir = mkdtempSync(resolve(tmpdir(), 'jtwz-stage6-'))
const port = 19787
const base = `http://127.0.0.1:${port}`
let child

function base32Decode(input) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = 0; let value = 0; const output = []
  for (const character of input) {
    value = (value << 5) | alphabet.indexOf(character)
    bits += 5
    if (bits >= 8) { output.push((value >>> (bits - 8)) & 255); bits -= 8 }
  }
  return Buffer.from(output)
}

function totp(secret) {
  const counter = Math.floor(Date.now() / 30_000)
  const buffer = Buffer.alloc(8); buffer.writeBigUInt64BE(BigInt(counter))
  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest()
  const offset = digest[digest.length - 1] & 15
  const binary = ((digest[offset] & 127) << 24) | ((digest[offset + 1] & 255) << 16) | ((digest[offset + 2] & 255) << 8) | (digest[offset + 3] & 255)
  return String(binary % 1_000_000).padStart(6, '0')
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(`${base}/api/health`)).ok) return } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error('stage6 server timeout')
}

function sessionCookie(response) {
  const values = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [response.headers.get('set-cookie') || '']
  const session = values.find((value) => value.startsWith('jtwz_session=')) || values.join(',').match(/jtwz_session=[^;]+/)?.[0] || ''
  return session.split(';')[0]
}

async function login(username, password, userAgent = 'Stage6 Security Test') {
  const response = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': userAgent }, body: JSON.stringify({ username, password }) })
  const payload = await response.json()
  assert.equal(response.status, 200, payload.error)
  return { response, payload, cookie: sessionCookie(response), csrf: payload.csrfToken }
}

async function api(session, path, method = 'GET', body, extraHeaders = {}) {
  const response = await fetch(`${base}${path}`, { method, headers: { Cookie: session.cookie, ...(method === 'GET' ? {} : { 'X-CSRF-Token': session.csrf }), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...extraHeaders }, body: body === undefined ? undefined : JSON.stringify(body) })
  const payload = await response.json().catch(() => ({}))
  return { response, payload }
}

try {
  child = spawn(process.execPath, ['dist-server/index.js'], { cwd: root, env: { ...process.env, DATA_DIR: dataDir, API_PORT: String(port), ADMIN_USERNAME: 'owner', ADMIN_PASSWORD: 'stage6-password', APP_SECRET: 'stage6-app-secret-for-security-tests', STORAGE_PROVIDER: 'local' }, stdio: ['ignore', 'pipe', 'pipe'] })
  let serverError = ''
  child.stderr.on('data', (chunk) => { serverError += chunk.toString() })
  await waitForServer()

  const health = await fetch(`${base}/api/health`, { headers: { 'X-Request-Id': 'stage6-request-0001' } })
  assert.equal(health.headers.get('x-request-id'), 'stage6-request-0001')
  assert.match(health.headers.get('content-security-policy') || '', /frame-ancestors 'none'/)

  const owner = await login('owner', 'stage6-password')
  assert.ok(owner.csrf)
  const noCsrf = await fetch(`${base}/api/security/sessions/revoke-others`, { method: 'POST', headers: { Cookie: owner.cookie } })
  assert.equal(noCsrf.status, 403)

  const created = await api(owner, '/api/security/admins', 'POST', { username: 'auditor', displayName: '安全审计', role: 'analyst', password: 'audit6' })
  assert.equal(created.response.status, 201, created.payload.error)
  const analyst = await login('auditor', 'audit6', 'Mozilla/5.0 (Windows NT 10.0) Edg/130')
  assert.equal((await api(analyst, '/api/domains')).response.status, 200)
  const forbidden = await api(analyst, '/api/domains', 'POST', { hostname: 'blocked.example.com', mode: 'redirect', target: 'https://example.com' })
  assert.equal(forbidden.response.status, 403)

  const setup = await api(owner, '/api/security/2fa/setup', 'POST', { currentPassword: 'stage6-password' })
  assert.equal(setup.response.status, 200, setup.payload.error)
  const enabled = await api(owner, '/api/security/2fa/enable', 'POST', { code: totp(setup.payload.setup.secret) })
  assert.equal(enabled.response.status, 200, enabled.payload.error)
  assert.equal(enabled.payload.recoveryCodes.length, 8)

  await api(owner, '/api/auth/logout', 'POST')
  const challenged = await login('owner', 'stage6-password', 'Mozilla/5.0 (Linux) Firefox/128')
  assert.equal(challenged.payload.requiresTwoFactor, true)
  const verifiedResponse = await fetch(`${base}/api/auth/two-factor`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Mozilla/5.0 (Linux) Firefox/128' }, body: JSON.stringify({ challengeId: challenged.payload.challengeId, code: totp(setup.payload.setup.secret) }) })
  const verifiedPayload = await verifiedResponse.json()
  assert.equal(verifiedResponse.status, 200, verifiedPayload.error)
  const verified = { cookie: sessionCookie(verifiedResponse), csrf: verifiedPayload.csrfToken }

  const overview = await api(verified, '/api/security/overview')
  assert.equal(overview.response.status, 200)
  assert.ok(overview.payload.sessions.some((item) => item.current))
  assert.ok(overview.payload.events.some((item) => item.reason === '新设备登录'))

  const rejectedUpload = await api(verified, '/api/packages/upload-intent', 'POST', { fileName: 'payload.html', softwareId: 'missing', version: '1.0.0', platform: 'Linux', contentType: 'text/html', byteSize: 10, sha256: 'a'.repeat(64) })
  assert.ok([400, 404].includes(rejectedUpload.response.status))

  const logs = await api(verified, '/api/audit-logs?q=two_factor')
  assert.equal(logs.response.status, 200)
  assert.ok(logs.payload.logs.every((item) => typeof item.requestId === 'string' && 'adminName' in item))

  const installer = readFileSync(resolve(root, 'deploy/installer/install.sh'), 'utf8')
  const updater = readFileSync(resolve(root, 'deploy/installer/jtwz-update'), 'utf8')
  assert.match(installer, /User=jtwz/)
  assert.match(installer, /ProtectSystem=strict/)
  assert.match(installer, /sudoers\.d\/jtwz-update/)
  assert.match(installer, /ENV_FILE="\$APP_DIR\/data\/config\.env"/)
  assert.match(installer, /LEGACY_ENV_FILE="\$APP_DIR\/\.env"/)
  assert.match(updater, /Ed25519 签名复核失败/)

  console.log('stage6: RBAC, CSRF, request IDs, 2FA, sessions, login alerts, audit metadata and low-privilege deployment passed')
  if (serverError) assert.doesNotMatch(serverError, /Error|Exception/)
} finally {
  if (child && child.exitCode === null) child.kill('SIGTERM')
  await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  rmSync(dataDir, { recursive: true, force: true })
}
