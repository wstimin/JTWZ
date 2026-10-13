import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { createServer, request as httpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'

const root = resolve(import.meta.dirname, '..')
const dataDir = mkdtempSync(resolve(tmpdir(), 'jtwz-stage4-'))
const port = 18787
const base = `http://127.0.0.1:${port}`
let child
let webhook
let failNextCertificate = false

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1))
  }
  return (crc ^ 0xffffffff) >>> 0
}

function createStoredZip(files) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const [name, value] of Object.entries(files)) {
    const nameBytes = Buffer.from(name)
    const content = Buffer.from(value)
    const checksum = crc32(content)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(checksum, 14)
    local.writeUInt32LE(content.length, 18)
    local.writeUInt32LE(content.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)
    locals.push(local, nameBytes, content)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(checksum, 16)
    central.writeUInt32LE(content.length, 20)
    central.writeUInt32LE(content.length, 24)
    central.writeUInt16LE(nameBytes.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, nameBytes)
    offset += local.length + nameBytes.length + content.length
  }
  const centralSize = centrals.reduce((sum, item) => sum + item.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(centralSize, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, ...centrals, end])
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${base}/api/health`)
      if (response.ok) return
    } catch {}
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error('隔离测试服务启动超时')
}

function domainRequest(path, forwardedProto = 'http') {
  return new Promise((resolveRequest, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path, headers: { Host: 'stage4.test', 'X-Forwarded-Proto': forwardedProto } }, (response) => {
      response.resume()
      response.once('end', () => resolveRequest({ status: response.statusCode, location: response.headers.location }))
    })
    request.once('error', reject)
    request.end()
  })
}

try {
  webhook = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')
    response.setHeader('Content-Type', 'application/json')
    if (body.action === 'issue_certificate') {
      if (failNextCertificate) {
        failNextCertificate = false
        response.statusCode = 502
        response.end(JSON.stringify({ message: 'simulated certificate provider outage' }))
        return
      }
      response.end(JSON.stringify({ id: `cert-${Date.now()}`, issuer: 'JTWZ Stage4 Test CA', serialNumber: 'STAGE4', issuedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 90 * 86400000).toISOString() }))
      return
    }
    response.end(JSON.stringify({ ok: true }))
  })
  await new Promise((resolveListen) => webhook.listen(0, '127.0.0.1', resolveListen))
  const webhookPort = webhook.address().port
  child = spawn(process.execPath, ['dist-server/index.js'], {
    cwd: root,
    env: { ...process.env, NODE_ENV: 'production', ALLOW_LOCAL_STORAGE_IN_PRODUCTION: 'true', DATA_DIR: dataDir, API_PORT: String(port), ADMIN_USERNAME: 'admin', ADMIN_PASSWORD: 'stage4-password', APP_SECRET: 'stage4-test-secret-with-sufficient-length', CERTIFICATE_PROVIDER: 'webhook', DNS_WEBHOOK_URL: `http://127.0.0.1:${webhookPort}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let serverError = ''
  child.stderr.on('data', (chunk) => { serverError += chunk.toString() })
  await waitForServer()

  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: 'stage4-password' }) })
  assert.equal(login.status, 200)
  const loginPayload = await login.json()
  const csrfToken = loginPayload.csrfToken
  const cookie = (login.headers.get('set-cookie') || '').split(';')[0]
  const json = async (path, method = 'GET', body) => {
    const response = await fetch(`${base}${path}`, { method, headers: { Cookie: cookie, ...(method === 'GET' ? {} : { 'X-CSRF-Token': csrfToken }), ...(body === undefined || Buffer.isBuffer(body) ? {} : { 'Content-Type': 'application/json' }), ...(Buffer.isBuffer(body) ? { 'Content-Type': 'application/octet-stream' } : {}) }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) })
    const payload = await response.json().catch(() => ({}))
    assert.ok(response.ok, `${method} ${path}: ${payload.error || response.status}`)
    return payload
  }

  const createdDomain = await json('/api/domains', 'POST', { hostname: 'stage4.test', mode: 'redirect', target: 'https://example.org', redirectCode: 302 })
  const isolatedDb = new DatabaseSync(resolve(dataDir, 'platform.db'))
  isolatedDb.prepare("UPDATE domains SET dns_status = 'verified', status = 'active', last_verified_at = ? WHERE id = ?").run(new Date().toISOString(), createdDomain.domain.id)
  isolatedDb.close()
  const redirectBeforeCertificate = await domainRequest('/welcome?from=test')
  assert.equal(redirectBeforeCertificate.status, 302)
  assert.equal(redirectBeforeCertificate.location, 'https://example.org/welcome?from=test')
  const appliedRoute = await json(`/api/domains/${createdDomain.domain.id}/apply-route`, 'POST')
  assert.equal(appliedRoute.ok, true)
  const issued = await json(`/api/domains/${createdDomain.domain.id}/issue-certificate`, 'POST')
  assert.equal(issued.certificate.status, 'active')
  assert.equal(issued.task.status, 'succeeded')
  const httpsUpgrade = await domainRequest('/welcome?from=test')
  assert.equal(httpsUpgrade.status, 308)
  assert.equal(httpsUpgrade.location, 'https://stage4.test/welcome?from=test')
  const diagnostics = await json(`/api/domains/${createdDomain.domain.id}/certificate-diagnostics`)
  assert.equal(diagnostics.certificates.length, 1)
  const renewed = await json(`/api/certificates/${issued.certificate.id}/renew`, 'POST')
  assert.equal(renewed.task.status, 'succeeded')
  failNextCertificate = true
  const failedIssueResponse = await fetch(`${base}/api/domains/${createdDomain.domain.id}/issue-certificate`, { method: 'POST', headers: { Cookie: cookie, 'X-CSRF-Token': csrfToken } })
  assert.equal(failedIssueResponse.status, 502)
  const failedTasks = await json('/api/tasks?status=failed')
  const failedCertificateTask = failedTasks.tasks.find((task) => task.kind === 'certificate_issue')
  assert.ok(failedCertificateTask)
  const recoveredCertificate = await json(`/api/tasks/${failedCertificateTask.id}/retry`, 'POST')
  assert.equal(recoveredCertificate.task.status, 'succeeded')
  const external = await json(`/api/domains/${createdDomain.domain.id}/certificates`, 'POST', { issuer: 'External Test CA', serialNumber: 'EXT-1', expiresAt: new Date(Date.now() + 60 * 86400000).toISOString(), note: 'isolated integration test' })
  await json(`/api/certificates/${external.certificate.id}`, 'PATCH', { note: 'updated lifecycle record', autoRenew: false })
  await json(`/api/certificates/${external.certificate.id}`, 'DELETE')
  await json(`/api/certificates/${issued.certificate.id}`, 'DELETE')

  const rule = await json('/api/redirects', 'POST', { domainId: createdDomain.domain.id, name: '文档入口', sourcePath: '/docs/*', target: 'https://example.org/help', enabled: true })
  await json(`/api/redirects/${rule.redirectRule.id}`, 'PUT', { target: 'https://example.org/guides', priority: 20 })

  const site = await json('/api/sites', 'POST', { name: 'Stage 4 Site', category: '集成测试' })
  const archive = createStoredZip({ 'index.html': '<!doctype html><html><body><h1>Stage 4 ready</h1></body></html>', 'assets/app.css': 'body{font-family:sans-serif}' })
  const published = await json(`/api/sites/${site.site.id}/publish?fileName=stage4.zip`, 'POST', archive)
  assert.equal(published.site.status, 'published')
  assert.equal(published.task.status, 'succeeded')
  const preview = await fetch(`${base}/preview/${site.site.id}/`, { headers: { Cookie: cookie } })
  assert.equal(preview.status, 200)
  assert.match(await preview.text(), /Stage 4 ready/)
  const versions = await json(`/api/sites/${site.site.id}/versions`)
  assert.equal(versions.versions.length, 1)
  const rolledBack = await json(`/api/sites/${site.site.id}/rollback`, 'POST', { versionId: versions.versions[0].id })
  assert.equal(rolledBack.task.status, 'succeeded')

  const software = await json('/api/software', 'POST', { name: 'Stage 4 App', slug: 'stage4-app', version: '1.0.0', platform: 'Windows' })
  const smallFile = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('JTWZ stage 4 package integrity test')])
  const smallSha = createHash('sha256').update(smallFile).digest('hex')
  const intent = await json('/api/packages/upload-intent', 'POST', { fileName: 'stage4.zip', softwareId: software.software.id, version: '1.0.0', platform: 'Windows x64', contentType: 'application/zip', byteSize: smallFile.length, sha256: smallSha })
  await json(intent.upload.url, 'PUT', smallFile)
  const completedSmall = await json(`/api/packages/${intent.packageId}/complete`, 'POST')
  assert.equal(completedSmall.package.sha256, smallSha)
  const versionList = await json(`/api/versions?softwareId=${software.software.id}`)
  const stableVersion = versionList.versions.find((item) => item.version === '1.0.0')
  assert.ok(stableVersion)
  await json(`/api/versions/${stableVersion.id}`, 'PUT', { status: 'published', isRecommended: true, releaseNotes: 'Stage 4 verified release' })
  await json(`/api/software/${software.software.id}`, 'PUT', { status: 'published' })
  const publicRelease = await fetch(`${base}/api/public/software/stage4-app`)
  assert.equal(publicRelease.status, 200)
  const publicReleasePayload = await publicRelease.json()
  assert.ok(publicReleasePayload.packages.some((item) => item.id === intent.packageId))

  const largeFile = Buffer.alloc(9 * 1024 * 1024, 0x4a)
  Buffer.from([0x50, 0x4b, 0x03, 0x04]).copy(largeFile, 0)
  const resumable = await json('/api/packages/resumable-intent', 'POST', { fileName: 'stage4-large.zip', softwareId: software.software.id, version: '1.0.1', platform: 'Linux x64', contentType: 'application/zip', totalBytes: largeFile.length })
  await json(`/api/packages/resumable/${resumable.uploadId}/chunks/0`, 'PUT', largeFile.subarray(0, resumable.chunkSize))
  await json(`/api/packages/resumable/${resumable.uploadId}/pause`, 'POST')
  const resumed = await json(`/api/packages/resumable/${resumable.uploadId}/resume`, 'POST')
  for (let index = 0; index < resumed.totalChunks; index += 1) {
    if (resumed.receivedChunks.includes(index)) continue
    await json(`/api/packages/resumable/${resumable.uploadId}/chunks/${index}`, 'PUT', largeFile.subarray(index * resumed.chunkSize, Math.min(largeFile.length, (index + 1) * resumed.chunkSize)))
  }
  const completedLarge = await json(`/api/packages/resumable/${resumable.uploadId}/complete`, 'POST')
  assert.equal(completedLarge.package.byteSize, largeFile.length)
  const pausedPackage = await json(`/api/packages/${resumable.uploadId}`, 'PATCH', { status: 'paused' })
  assert.equal(pausedPackage.package.status, 'paused')
  await json(`/api/packages/${resumable.uploadId}`, 'PATCH', { status: 'available' })
  await json(`/api/packages/${resumable.uploadId}`, 'DELETE')

  const tasks = await json('/api/tasks?limit=100')
  for (const kind of ['certificate_issue', 'certificate_renew', 'site_publish', 'site_rollback', 'package_upload']) {
    assert.ok(tasks.tasks.some((task) => task.kind === kind && task.status === 'succeeded'), `${kind} should have a succeeded task`)
  }
  console.log('stage4: certificate, redirect, site publishing, rollback, direct upload and resumable upload lifecycle passed')
} finally {
  if (child && !child.killed) {
    child.kill()
    await Promise.race([new Promise((resolveExit) => child.once('exit', resolveExit)), new Promise((resolveWait) => setTimeout(resolveWait, 2000))])
  }
  if (webhook) await new Promise((resolveClose) => webhook.close(resolveClose))
  rmSync(dataDir, { recursive: true, force: true })
}
