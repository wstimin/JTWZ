import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import type { IncomingMessage } from 'node:http'
import { dirname, resolve, sep } from 'node:path'
import { once } from 'node:events'
import { config } from './config.js'
import { HttpError } from './http.js'

mkdirSync(config.storageDir, { recursive: true })
mkdirSync(config.tempDir, { recursive: true })
mkdirSync(config.siteReleasesDir, { recursive: true })

export function safeStoragePath(root: string, key: string) {
  const filePath = resolve(root, key)
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) throw new HttpError(400, '文件路径无效')
  return filePath
}

export async function writeRequestToFile(request: IncomingMessage, filePath: string, maxBytes: number) {
  mkdirSync(dirname(filePath), { recursive: true })
  const stream = createWriteStream(filePath, { flags: 'wx' })
  const hash = createHash('sha256')
  let bytes = 0

  try {
    for await (const rawChunk of request) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk)
      bytes += chunk.length
      if (bytes > maxBytes) throw new HttpError(413, `文件超过允许大小（最大 ${Math.round(maxBytes / 1024 / 1024)} MB）`)
      hash.update(chunk)
      if (!stream.write(chunk)) await once(stream, 'drain')
    }
    stream.end()
    await once(stream, 'finish')
    if (bytes === 0) throw new HttpError(400, '上传文件不能为空')
    return { bytes, sha256: hash.digest('hex') }
  } catch (error) {
    stream.destroy()
    rmSync(filePath, { force: true })
    throw error
  }
}

export function removeStoredFile(objectKey: string) {
  const filePath = safeStoragePath(config.storageDir, objectKey)
  if (existsSync(filePath)) rmSync(filePath, { force: true })
}

export function signDownload(packageId: string, expires: number) {
  return createHmac('sha256', config.appSecret).update(`${packageId}:${expires}`).digest('base64url')
}

export function verifyDownloadSignature(packageId: string, expires: number, signature: string) {
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false
  const expected = Buffer.from(signDownload(packageId, expires))
  const actual = Buffer.from(signature)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function signedDownloadPath(packageId: string, lifetimeSeconds = 15 * 60) {
  const expires = Math.floor(Date.now() / 1000) + lifetimeSeconds
  return `/api/public/files/${encodeURIComponent(packageId)}/download?expires=${expires}&signature=${encodeURIComponent(signDownload(packageId, expires))}`
}

export function signedStorageUpload(packageId: string, objectKey: string, expires: number) {
  return createHmac('sha256', config.appSecret).update(`upload:${packageId}:${objectKey}:${expires}`).digest('base64url')
}

export function verifyStorageUpload(packageId: string, objectKey: string, expires: number, signature: string) {
  if (!Number.isFinite(expires) || expires < Math.floor(Date.now() / 1000)) return false
  const expected = Buffer.from(signedStorageUpload(packageId, objectKey, expires))
  const actual = Buffer.from(signature)
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

export function formatBytes(bytes: number) {
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

