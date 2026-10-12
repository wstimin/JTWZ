import assert from 'node:assert/strict'

const base = process.env.TEST_BASE_URL || 'http://127.0.0.1:8787'
const health = await fetch(`${base}/api/health`)
assert.equal(health.status, 200)
const payload = await health.json()
assert.equal(payload.ok, true)
console.log('smoke: health endpoint passed')

const publicFrontend = await fetch(`${base}/`)
assert.equal(publicFrontend.status, 200)
assert.match(await publicFrontend.text(), /数字入口管理平台/)
const adminFrontend = await fetch(`${base}/admin/versions`)
assert.equal(adminFrontend.status, 200)
assert.match(await adminFrontend.text(), /管理控制台/)
const legacyLogin = await fetch(`${base}/login`, { redirect: 'manual' })
assert.equal(legacyLogin.status, 308)
assert.equal(legacyLogin.headers.get('location'), '/admin/login')
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
const cookie = login.headers.get('set-cookie')?.split(';')[0]
assert.ok(cookie)
const adminHeaders = { Cookie: cookie }
for (const path of ['/api/versions', '/api/announcements', '/api/admin/health', '/api/admin/system/update']) {
  const response = await fetch(`${base}${path}`, { headers: adminHeaders })
  assert.equal(response.status, 200, `${path} should be available to the administrator`)
}
const versionsResponse = await fetch(`${base}/api/versions`, { headers: adminHeaders })
const versionsPayload = await versionsResponse.json()
assert.ok(Array.isArray(versionsPayload.versions))
assert.ok(versionsPayload.versions.every((item) => 'packageCount' in item && Array.isArray(item.platforms)))
console.log('smoke: versions, announcements and admin health passed')
