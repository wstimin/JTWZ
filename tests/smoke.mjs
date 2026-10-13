import assert from 'node:assert/strict'

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787'
const adminBasePath = `/${String(process.env.TEST_ADMIN_BASE_PATH || '/admin').replace(/^\/+|\/+$/g, '')}`
const health = await fetch(`${base}/api/health`)
assert.equal(health.status, 200)
const payload = await health.json()
assert.equal(payload.ok, true)
assert.equal(payload.service, 'jtwz-api')
console.log('smoke: health endpoint passed')

const publicFrontend = await fetch(`${base}/`)
assert.equal(publicFrontend.status, 200)
const publicHtml = await publicFrontend.text()
assert.match(publicHtml, /数字入口管理平台/)
assert.doesNotMatch(publicHtml, /<script>([\s\S]*?)<\/script>/, 'public frontend must comply with the inline-script CSP')
const publicAssetPath = publicHtml.match(/src="(\/assets\/[^"]+\.js)"/)?.[1]
assert.ok(publicAssetPath)
const publicAsset = await fetch(`${base}${publicAssetPath}`)
assert.equal(publicAsset.status, 200)
const adminFrontend = await fetch(`${base}${adminBasePath}/versions`)
assert.equal(adminFrontend.status, 200)
const adminHtml = await adminFrontend.text()
assert.match(adminHtml, /管理控制台/)
assert.doesNotMatch(adminHtml, /<script>([\s\S]*?)<\/script>/, 'admin frontend must comply with the inline-script CSP')
assert.ok(adminHtml.includes(`name="jtwz-admin-base-path" content="${adminBasePath}"`))
assert.match(adminHtml, /\/admin-assets\/assets\//)
const adminAssetPath = adminHtml.match(/(?:src|href)="(\/admin-assets\/assets\/[^"]+)"/)?.[1]
assert.ok(adminAssetPath)
const adminAsset = await fetch(`${base}${adminAssetPath}`)
assert.equal(adminAsset.status, 200)
const missingAdminAsset = await fetch(`${base}/admin-assets/assets/not-found.js`)
assert.equal(missingAdminAsset.status, 404)
const legacyLogin = await fetch(`${base}/login`, { redirect: 'manual' })
assert.equal(legacyLogin.status, 308)
assert.equal(legacyLogin.headers.get('location'), `${adminBasePath}/login`)
if (adminBasePath !== '/admin') {
  const disabledDefaultAdmin = await fetch(`${base}/admin`, { redirect: 'manual' })
  assert.equal(disabledDefaultAdmin.status, 404)
}
console.log('smoke: separated public and admin frontends passed')

const preflight = await fetch(`${base}/api/auth/login`, {
  method: 'OPTIONS',
  headers: { Origin: 'http://127.0.0.1:4174', 'Access-Control-Request-Method': 'POST' },
})
assert.equal(preflight.status, 204)
assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://127.0.0.1:4174')
const rejectedOrigin = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' },
  body: JSON.stringify({ username: 'nobody', password: 'not-a-password' }),
})
assert.equal(rejectedOrigin.status, 403)
console.log('smoke: API origin policy passed')

const publicSettings = await fetch(`${base}/api/public/settings`)
assert.equal(publicSettings.status, 200)
const publicSettingsPayload = await publicSettings.json()
assert.equal(typeof publicSettingsPayload.settings.publicMaintenance, 'boolean')
assert.equal(typeof publicSettingsPayload.settings.maintenanceMessage, 'string')
console.log('smoke: public state configuration passed')

const publicSoftware = await fetch(`${base}/api/public/software`)
assert.equal(publicSoftware.status, 200)
const softwarePayload = await publicSoftware.json()
assert.ok(Array.isArray(softwarePayload.software))
if (softwarePayload.software.length) {
  const detail = await fetch(`${base}/api/public/software/${encodeURIComponent(softwarePayload.software[0].slug)}`)
  assert.equal(detail.status, 200)
  const detailPayload = await detail.json()
  assert.equal(detailPayload.software.id, softwarePayload.software[0].id)
  assert.ok(Array.isArray(detailPayload.packages))
}
console.log('smoke: public software detail passed')

const announcements = await fetch(`${base}/api/public/announcements`)
assert.equal(announcements.status, 200)
const announcementPayload = await announcements.json()
assert.ok(Array.isArray(announcementPayload.announcements))
assert.ok(announcementPayload.announcements.every((item) => item.status === 'published'))
console.log('smoke: public announcements passed')

const username = process.env.TEST_ADMIN_USERNAME || 'admin'
const password = process.env.TEST_ADMIN_PASSWORD || 'local-development-password'
const login = await fetch(`${base}/api/auth/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ username, password }),
})
assert.equal(login.status, 200)
const setCookie = login.headers.get('set-cookie') || ''
const cookie = setCookie.split(';')[0]
assert.ok(cookie)
assert.match(cookie, /^jtwz_session=/)
if (base.startsWith('http://')) assert.doesNotMatch(setCookie, /;\s*Secure(?:;|$)/i, 'HTTP deployment must not emit a Secure-only session cookie')
const adminHeaders = { Cookie: cookie }
const currentAdmin = await fetch(`${base}/api/auth/me`, { headers: adminHeaders })
assert.equal(currentAdmin.status, 200, 'the issued session cookie must authenticate a follow-up request')
for (const path of ['/api/versions', '/api/announcements', '/api/admin/health', '/api/admin/system/update', '/api/admin/access']) {
  const response = await fetch(`${base}${path}`, { headers: adminHeaders })
  assert.equal(response.status, 200, `${path} should be available to the administrator`)
}
const versionsResponse = await fetch(`${base}/api/versions`, { headers: adminHeaders })
const versionsPayload = await versionsResponse.json()
assert.ok(Array.isArray(versionsPayload.versions))
assert.ok(versionsPayload.versions.every((item) => 'packageCount' in item && Array.isArray(item.platforms)))
console.log('smoke: versions, announcements and admin health passed')

const certificatesResponse = await fetch(`${base}/api/certificates`, { headers: adminHeaders })
assert.equal(certificatesResponse.status, 200)
const certificatesPayload = await certificatesResponse.json()
assert.ok(Array.isArray(certificatesPayload.certificates))
const domainsResponse = await fetch(`${base}/api/domains`, { headers: adminHeaders })
assert.equal(domainsResponse.status, 200)
const domainsPayload = await domainsResponse.json()
if (domainsPayload.domains.length) {
  const diagnostics = await fetch(`${base}/api/domains/${encodeURIComponent(domainsPayload.domains[0].id)}/certificate-diagnostics`, { headers: adminHeaders })
  assert.equal(diagnostics.status, 200)
  const diagnosticsPayload = await diagnostics.json()
  assert.ok(Array.isArray(diagnosticsPayload.certificates))
  assert.ok(Array.isArray(diagnosticsPayload.failures))
}
console.log('smoke: certificate lifecycle diagnostics passed')
