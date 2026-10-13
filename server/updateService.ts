import { createHash, verify as verifySignature } from 'node:crypto'
import { closeSync, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { rename } from 'node:fs/promises'
import { basename, resolve, sep } from 'node:path'
import { Readable } from 'node:stream'
import { finished } from 'node:stream/promises'
import { spawn } from 'node:child_process'
import { config } from './config.js'
import { createBackup } from './backup.js'

type UpdateManifest = {
  version: string
  publishedAt?: string
  notes?: string
  downloadUrl: string
  sha256: string
  signature: string
  signatureAlgorithm: 'ed25519'
}

const updateDir = resolve(config.dataDir, 'updates')
const statePath = resolve(updateDir, 'state.json')
mkdirSync(updateDir, { recursive: true })

function parseVersion(value: string) {
  const match = value.trim().replace(/^v/i, '').match(/^(\d+)\.(\d+)\.(\d+)(?:[-+]([0-9A-Za-z.-]+))?$/)
  if (!match) return null
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], prerelease: match[4] || '' }
}

function isNewer(candidate: string, current: string) {
  const next = parseVersion(candidate)
  const installed = parseVersion(current)
  if (!next || !installed) return false
  for (let index = 0; index < 3; index += 1) {
    if (next.parts[index] !== installed.parts[index]) return next.parts[index] > installed.parts[index]
  }
  if (next.prerelease === installed.prerelease) return false
  if (!next.prerelease) return true
  if (!installed.prerelease) return false
  return next.prerelease.localeCompare(installed.prerelease, undefined, { numeric: true }) > 0
}

function signaturePayload(manifest: Pick<UpdateManifest, 'version' | 'publishedAt' | 'notes' | 'downloadUrl' | 'sha256'>) {
  return [manifest.version, manifest.publishedAt || '', manifest.notes || '', manifest.downloadUrl, manifest.sha256.toLowerCase()].join('\n')
}

function validateManifest(value: unknown): UpdateManifest {
  const manifest = value as Partial<UpdateManifest>
  if (!manifest || !parseVersion(String(manifest.version || ''))) throw new Error('更新清单的版本号无效')
  if (!/^https:\/\//i.test(String(manifest.downloadUrl || ''))) throw new Error('更新包地址必须使用 HTTPS')
  if (!/^[a-f0-9]{64}$/i.test(String(manifest.sha256 || ''))) throw new Error('更新包 SHA-256 无效')
  if (String(manifest.signatureAlgorithm || '').toLowerCase() !== 'ed25519') throw new Error('更新清单必须使用 Ed25519 签名')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(String(manifest.signature || ''))) throw new Error('更新清单签名格式无效')
  const validated: UpdateManifest = {
    version: String(manifest.version),
    publishedAt: manifest.publishedAt ? String(manifest.publishedAt) : undefined,
    notes: String(manifest.notes || '').slice(0, 20_000),
    downloadUrl: String(manifest.downloadUrl),
    sha256: String(manifest.sha256).toLowerCase(),
    signature: String(manifest.signature),
    signatureAlgorithm: 'ed25519',
  }
  let signatureValid = false
  try {
    signatureValid = verifySignature(null, Buffer.from(signaturePayload(validated), 'utf8'), config.updatePublicKey, Buffer.from(validated.signature, 'base64'))
  } catch {
    throw new Error('更新签名公钥无效')
  }
  if (!signatureValid) throw new Error('更新清单签名验证失败，已拒绝下载')
  return validated
}

function readState() {
  if (!existsSync(statePath)) return null
  try { return JSON.parse(readFileSync(statePath, 'utf8')) as Record<string, unknown> } catch { return null }
}

export function getUpdateState() {
  return readState()
}

export async function checkForUpdate() {
  if (!config.updateManifestUrl || !config.updatePublicKey) {
    return {
      configured: false, currentVersion: config.systemVersion, updateAvailable: false, applyConfigured: Boolean(config.updateApplyCommand),
      signatureConfigured: Boolean(config.updatePublicKey),
      configurationError: !config.updateManifestUrl ? '尚未配置更新清单地址' : '尚未配置 Ed25519 更新签名公钥', state: readState(),
    }
  }
  if (!/^https:\/\//i.test(config.updateManifestUrl)) throw new Error('更新清单地址必须使用 HTTPS')
  const response = await fetch(config.updateManifestUrl, { headers: { Accept: 'application/json', 'User-Agent': `JTWZ/${config.systemVersion}` }, signal: AbortSignal.timeout(15_000) })
  if (!response.ok) throw new Error(`更新清单请求失败（${response.status}）`)
  const manifest = validateManifest(await response.json())
  const status = {
    configured: true,
    currentVersion: config.systemVersion,
    latestVersion: manifest.version,
    updateAvailable: isNewer(manifest.version, config.systemVersion),
    applyConfigured: Boolean(config.updateApplyCommand),
    signatureConfigured: true,
    signatureVerified: true,
    manifest,
    checkedAt: new Date().toISOString(),
    state: readState(),
  }
  return status
}

async function downloadUpdate(manifest: UpdateManifest) {
  const response = await fetch(manifest.downloadUrl, { signal: AbortSignal.timeout(10 * 60_000) })
  if (!response.ok || !response.body) throw new Error(`更新包下载失败（${response.status}）`)
  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > config.maxUpdateBytes) throw new Error('更新包超过允许大小')
  const safeName = basename(new URL(manifest.downloadUrl).pathname).replace(/[^a-zA-Z0-9._-]/g, '_') || `jtwz-${manifest.version}.update`
  const destination = resolve(updateDir, `${manifest.version}-${safeName}`)
  if (!destination.startsWith(`${updateDir}${sep}`)) throw new Error('更新包路径无效')
  const temporary = `${destination}.tmp`
  const output = createWriteStream(temporary, { flags: 'w' })
  const hash = createHash('sha256')
  let bytes = 0
  try {
    for await (const chunk of Readable.fromWeb(response.body as never)) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array)
      bytes += buffer.length
      if (bytes > config.maxUpdateBytes) throw new Error('更新包超过允许大小')
      hash.update(buffer)
      if (!output.write(buffer)) await new Promise<void>((resolvePromise, reject) => { output.once('drain', resolvePromise); output.once('error', reject) })
    }
    output.end()
    await finished(output)
    const actualHash = hash.digest('hex')
    if (actualHash !== manifest.sha256) throw new Error('更新包 SHA-256 校验失败')
    await rename(temporary, destination)
    return { path: destination, byteSize: statSync(destination).size, sha256: actualHash }
  } catch (error) {
    output.destroy()
    rmSync(temporary, { force: true })
    throw error
  }
}

function configuredApplyArgs() {
  try {
    const parsed = JSON.parse(config.updateApplyArgsJson)
    if (!Array.isArray(parsed) || !parsed.every((item) => typeof item === 'string')) throw new Error()
    return parsed as string[]
  } catch {
    throw new Error('UPDATE_APPLY_ARGS_JSON 必须是字符串数组')
  }
}

export async function installUpdate() {
  const status = await checkForUpdate()
  if (!status.configured || !('manifest' in status)) throw new Error('系统更新源尚未配置')
  if (!status.updateAvailable) throw new Error('当前已经是最新版本')
  const rollbackBackup = await createBackup()
  const artifact = await downloadUpdate(status.manifest)
  const staged = { status: 'staged', version: status.manifest.version, stagedAt: new Date().toISOString(), artifact, manifest: status.manifest, rollbackBackup }
  writeFileSync(statePath, JSON.stringify(staged, null, 2), 'utf8')
  if (!config.updateApplyCommand) return { ...staged, applyStarted: false, message: '更新包已校验并暂存；配置安全更新执行器后可自动切换版本。' }
  const executorLogPath = resolve(updateDir, 'executor.log')
  rmSync(executorLogPath, { force: true })
  const executorLog = openSync(executorLogPath, 'a', 0o600)
  const child = spawn(config.updateApplyCommand, [...configuredApplyArgs(), artifact.path], { windowsHide: true, detached: true, stdio: ['ignore', executorLog, executorLog] })
  closeSync(executorLog)
  await new Promise<void>((resolvePromise, reject) => {
    child.once('spawn', resolvePromise)
    child.once('error', reject)
  }).catch((error) => {
    const failed = { ...staged, status: 'executor_failed', failedAt: new Date().toISOString(), error: error instanceof Error ? error.message : String(error) }
    writeFileSync(statePath, JSON.stringify(failed, null, 2), 'utf8')
    throw new Error(`安全更新执行器启动失败：${failed.error}`)
  })
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
  if (child.exitCode !== null && child.exitCode !== 0) {
    const executorDetail = existsSync(executorLogPath) ? readFileSync(executorLogPath, 'utf8').trim().split(/\r?\n/).slice(-4).join('；') : ''
    const detail = `安全更新执行器立即退出（代码 ${child.exitCode}）${executorDetail ? `：${executorDetail}` : '，请重新运行一键安装脚本修复执行权限'}`
    const failed = { ...staged, status: 'executor_failed', detail, failedAt: new Date().toISOString() }
    writeFileSync(statePath, JSON.stringify(failed, null, 2), 'utf8')
    throw new Error(detail)
  }
  child.unref()
  return { ...staged, applyStarted: true, message: '更新执行器已启动，服务将由进程管理器重启。' }
}
