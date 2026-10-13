import assert from 'node:assert/strict'
import { createHash, generateKeyPairSync, randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'

const root = mkdtempSync(resolve(tmpdir(), 'jtwz-stage5-'))
const dataDir = resolve(root, 'data')
const envPath = resolve(root, '.env')
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
const publicPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()

process.env.DATA_DIR = dataDir
process.env.JTWZ_ENV_FILE = envPath
process.env.ADMIN_USERNAME = 'migration-admin'
process.env.ADMIN_PASSWORD = 'stage5-password'
process.env.APP_SECRET = 'stage5-original-secret'
process.env.ADMIN_BASE_PATH = '/admin'
process.env.STORAGE_PROVIDER = 'local'
process.env.UPDATE_MANIFEST_URL = 'https://updates.example.test/update-manifest.json'
process.env.UPDATE_PUBLIC_KEY_B64 = Buffer.from(publicPem, 'utf8').toString('base64')
process.env.UPDATE_APPLY_COMMAND = resolve(root, 'missing-update-executor')
writeFileSync(envPath, [
  'NODE_ENV=development', 'ADMIN_USERNAME=migration-admin', 'ADMIN_PASSWORD=stage5-password',
  'APP_SECRET=stage5-original-secret', 'ADMIN_BASE_PATH=/admin', 'STORAGE_PROVIDER=local',
].join('\n') + '\n', 'utf8')

let openedDb
try {
  const [{ db }, backup, { checkForUpdate, installUpdate }, { createUpdateManifest }] = await Promise.all([
    import('../dist-server/db.js'), import('../dist-server/backup.js'), import('../dist-server/updateService.js'), import('../scripts/create-update-manifest.mjs'),
  ])
  openedDb = db
  const timestamp = new Date().toISOString()
  const siteId = randomUUID()
  const versionId = randomUUID()
  const releasePath = resolve(dataDir, 'site-releases', siteId, versionId)
  mkdirSync(releasePath, { recursive: true })
  writeFileSync(resolve(releasePath, 'index.html'), '<h1>portable-stage5</h1>', 'utf8')
  db.prepare(`INSERT INTO sites (id, name, path, domain, status, visits, category, current_version_id, updated_at, created_at)
    VALUES (?, 'Migration Site', '/migration', '', 'published', 0, 'test', ?, ?, ?)`).run(siteId, versionId, timestamp, timestamp)
  db.prepare(`INSERT INTO site_versions (id, site_id, release_path, source_name, file_count, byte_size, sha256, created_at)
    VALUES (?, ?, ?, 'stage5.zip', 1, 24, ?, ?)`).run(versionId, siteId, releasePath, createHash('sha256').update('<h1>portable-stage5</h1>').digest('hex'), timestamp)

  const objectKey = 'packages/stage5.bin'
  const objectPath = resolve(dataDir, 'storage', objectKey)
  mkdirSync(resolve(objectPath, '..'), { recursive: true })
  const packageBytes = Buffer.from('stage5-package-content')
  writeFileSync(objectPath, packageBytes)
  db.prepare(`INSERT INTO packages
    (id, file_name, software_id, version_id, version, platform, size, storage, object_key, byte_size, sha256, mime_type, downloads, status, release_notes, updated_at, created_at)
    VALUES (?, 'stage5.bin', NULL, NULL, '1.0.0', 'linux', '22 B', 'local', ?, ?, ?, 'application/octet-stream', 0, 'available', '', ?, ?)`)
    .run(randomUUID(), objectKey, packageBytes.length, createHash('sha256').update(packageBytes).digest('hex'), timestamp, timestamp)

  const created = await backup.createBackup()
  assert.equal(created.formatVersion, 3)
  assert.match(created.sha256, /^[a-f0-9]{64}$/)
  db.prepare("UPDATE sites SET name = 'Mutated Site'").run()
  writeFileSync(resolve(releasePath, 'index.html'), '<h1>mutated</h1>', 'utf8')
  writeFileSync(objectPath, 'mutated-package', 'utf8')
  writeFileSync(envPath, 'ADMIN_BASE_PATH=/mutated\nAPP_SECRET=mutated-secret\n', 'utf8')

  const restoredResult = await backup.restoreBackupWithRollback(backup.backupFilePath(created.fileName))
  assert.equal(restoredResult.rolledBack, false)
  assert.equal(restoredResult.restored.formatVersion, 3)
  assert.equal(db.prepare('SELECT name FROM sites WHERE id = ?').get(siteId).name, 'Migration Site')
  assert.equal(db.prepare('SELECT username FROM admins ORDER BY created_at LIMIT 1').get().username, 'migration-admin')
  assert.equal(readFileSync(resolve(releasePath, 'index.html'), 'utf8'), '<h1>portable-stage5</h1>')
  assert.deepEqual(readFileSync(objectPath), packageBytes)
  assert.match(readFileSync(envPath, 'utf8'), /ADMIN_BASE_PATH=\/admin/)
  assert.match(readFileSync(envPath, 'utf8'), /APP_SECRET=stage5-original-secret/)

  await new Promise((resolvePromise) => setTimeout(resolvePromise, 10))
  const corruptPath = resolve(root, 'corrupt.jtwz-backup')
  writeFileSync(corruptPath, 'not-a-backup', 'utf8')
  await assert.rejects(() => backup.restoreBackupWithRollback(corruptPath), /已自动恢复原网站/)
  assert.equal(db.prepare('SELECT name FROM sites WHERE id = ?').get(siteId).name, 'Migration Site')
  assert.equal(readFileSync(resolve(releasePath, 'index.html'), 'utf8'), '<h1>portable-stage5</h1>')

  const updateAsset = resolve(root, 'jtwz-one-click-v9.9.9.tar.gz')
  const updateManifest = resolve(root, 'update-manifest.json')
  writeFileSync(updateAsset, 'signed update artifact', 'utf8')
  createUpdateManifest({ version: '9.9.9', assetPath: updateAsset, outputPath: updateManifest,
    downloadUrl: 'https://updates.example.test/jtwz-one-click-v9.9.9.tar.gz', publishedAt: '2026-10-13T00:00:00.000Z', notes: 'signed stage 5 test',
    privateKeyB64: Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' })).toString('base64') })
  let manifest = JSON.parse(readFileSync(updateManifest, 'utf8'))
  const signedManifest = { ...manifest }
  globalThis.fetch = async (input) => String(input) === process.env.UPDATE_MANIFEST_URL
    ? new Response(JSON.stringify(manifest), { status: 200, headers: { 'Content-Type': 'application/json' } })
    : new Response(readFileSync(updateAsset), { status: 200, headers: { 'Content-Length': String(readFileSync(updateAsset).length) } })
  const update = await checkForUpdate()
  assert.equal(update.configured, true)
  assert.equal(update.signatureVerified, true)
  assert.equal(update.updateAvailable, true)
  manifest = { ...manifest, notes: 'tampered notes' }
  await assert.rejects(() => checkForUpdate(), /签名验证失败/)
  manifest = signedManifest
  await assert.rejects(() => installUpdate(), /安全更新执行器启动失败/)

  console.log('stage5: portable backup, account/config migration, automatic rollback and signed update verification passed')
} finally {
  try { openedDb?.close() } catch { /* already closed */ }
  rmSync(root, { recursive: true, force: true })
}
