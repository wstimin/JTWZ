import { createHash, createHmac } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { config } from './config.js'
import { safeStoragePath, writeRequestToFile } from './storage.js'
import type { IncomingMessage } from 'node:http'
import { HttpError } from './http.js'

export type StorageHead = { byteSize: number; sha256: string; contentType: string }

export let objectStorageMode: 's3' | 'local' = config.storageProvider === 's3' ? 's3' : 'local'

export function refreshObjectStorageMode() {
  objectStorageMode = config.storageProvider === 's3' ? 's3' : 'local'
  return objectStorageMode
}

export function isStorageConfigured() {
  return objectStorageMode === 'local' || Boolean(config.s3Endpoint && config.s3Bucket && config.s3AccessKey && config.s3SecretKey)
}

function assertS3Config() {
  if (objectStorageMode !== 's3' || !isStorageConfigured()) {
    throw new HttpError(503, '对象存储尚未完成配置')
  }
}

function hmac(key: Buffer | string, value: string) {
  return createHmac('sha256', key).update(value).digest()
}

function hash(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function encodePath(value: string) {
  return value.split('/').map((part) => encodeURIComponent(part)).join('/')
}

function s3Url(objectKey: string) {
  assertS3Config()
  const endpoint = new URL(config.s3Endpoint)
  endpoint.pathname = `${endpoint.pathname.replace(/\/$/, '')}/${encodeURIComponent(config.s3Bucket)}/${encodePath(objectKey)}`
  return endpoint
}

function presign(method: 'PUT' | 'GET' | 'HEAD' | 'DELETE' | 'POST', objectKey: string, expires = config.storageUrlTtl, contentType = '', extraParams: Record<string, string> = {}, extraHeaders: Record<string, string> = {}) {
  const url = s3Url(objectKey)
  const host = url.host
  const now = new Date()
  const date = now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const shortDate = date.slice(0, 8)
  const scope = `${shortDate}/${config.s3Region}/s3/aws4_request`
  const credential = `${config.s3AccessKey}/${scope}`
  const headers = new Map<string, string>([['host', host]])
  if (contentType) headers.set('content-type', contentType)
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key.toLowerCase(), value.trim().replace(/\s+/g, ' '))
  const signedHeaders = [...headers.keys()].sort().join(';')
  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': credential,
    'X-Amz-Date': date,
    'X-Amz-Expires': String(expires),
    'X-Amz-SignedHeaders': signedHeaders,
    ...extraParams,
  })
  const canonicalQuery = [...query.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`).join('&')
  const canonicalHeaders = [...headers.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => `${key}:${value}\n`).join('')
  const canonicalRequest = [method, url.pathname, canonicalQuery, canonicalHeaders, signedHeaders, 'UNSIGNED-PAYLOAD'].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', date, scope, hash(canonicalRequest)].join('\n')
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${config.s3SecretKey}`, shortDate), config.s3Region), 's3'), 'aws4_request')
  query.set('X-Amz-Signature', createHmac('sha256', signingKey).update(stringToSign).digest('hex'))
  url.search = query.toString()
  return url.toString()
}

export async function createMultipartUpload(objectKey: string, contentType: string, sha256: string) {
  assertS3Config()
  const metadataHeaders = { 'x-amz-meta-sha256': sha256 }
  const response = await fetch(presign('POST', objectKey, config.storageUrlTtl, contentType, { uploads: '' }, metadataHeaders), {
    method: 'POST',
    headers: { 'Content-Type': contentType, 'x-amz-meta-sha256': sha256 },
  })
  if (!response.ok) throw new HttpError(502, `对象存储无法创建分片上传（${response.status}）`)
  const xml = await response.text()
  const uploadId = xml.match(/<UploadId>([^<]+)<\/UploadId>/)?.[1]
  if (!uploadId) throw new HttpError(502, '对象存储未返回 multipart uploadId')
  return uploadId
}

export function createMultipartPartUpload(objectKey: string, uploadId: string, partNumber: number) {
  assertS3Config()
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > 10_000) throw new HttpError(400, '分片序号无效')
  return { url: presign('PUT', objectKey, config.storageUrlTtl, '', { partNumber: String(partNumber), uploadId }), headers: {} }
}

export async function completeMultipartUpload(objectKey: string, uploadId: string, parts: Array<{ partNumber: number; etag: string }>) {
  assertS3Config()
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber)
  const body = `<CompleteMultipartUpload>${sorted.map((part) => `<Part><PartNumber>${part.partNumber}</PartNumber><ETag>${part.etag}</ETag></Part>`).join('')}</CompleteMultipartUpload>`
  const response = await fetch(presign('POST', objectKey, config.storageUrlTtl, '', { uploadId }), { method: 'POST', headers: { 'Content-Type': 'application/xml' }, body })
  if (!response.ok) throw new HttpError(502, `对象存储无法完成分片上传（${response.status}）`)
  return true
}

export function createStorageUpload(objectKey: string, contentType = 'application/octet-stream', sha256 = '') {
  if (objectStorageMode === 's3') {
    const metadataHeaders: Record<string, string> = sha256 ? { 'x-amz-meta-sha256': sha256 } : {}
    const headers: Record<string, string> = { 'Content-Type': contentType, ...metadataHeaders }
    return {
      provider: 's3',
      url: presign('PUT', objectKey, config.storageUrlTtl, contentType, {}, metadataHeaders),
      headers,
      expiresIn: config.storageUrlTtl,
    }
  }
  const headers: Record<string, string> = { 'Content-Type': contentType }
  return { provider: 'local', url: '', headers, expiresIn: config.storageUrlTtl }
}

export function createStorageDownload(objectKey: string) {
  if (objectStorageMode === 's3') return presign('GET', objectKey, config.storageUrlTtl)
  return ''
}

export async function uploadLocal(request: IncomingMessage, objectKey: string, maxBytes: number) {
  const filePath = safeStoragePath(config.storageDir, objectKey)
  return writeRequestToFile(request, filePath, maxBytes)
}

export function localFilePath(objectKey: string) {
  return safeStoragePath(config.storageDir, objectKey)
}

async function hashLocal(filePath: string) {
  const sha = createHash('sha256')
  let bytes = 0
  for await (const chunk of createReadStream(filePath)) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    sha.update(buffer)
  }
  return { byteSize: bytes, sha256: sha.digest('hex') }
}

export async function completeStorageUpload(objectKey: string, contentType: string): Promise<StorageHead> {
  if (objectStorageMode === 'local') {
    const filePath = localFilePath(objectKey)
    if (!existsSync(filePath)) throw new HttpError(404, '对象存储中找不到上传文件')
    const result = await hashLocal(filePath)
    return { ...result, contentType }
  }
  assertS3Config()
  const response = await fetch(presign('HEAD', objectKey), { method: 'HEAD' })
  if (!response.ok) throw new HttpError(409, '对象存储尚未收到文件，请确认直传已完成')
  const size = Number(response.headers.get('content-length') || 0)
  return { byteSize: size, sha256: response.headers.get('x-amz-meta-sha256') || '', contentType: response.headers.get('content-type') || contentType }
}

export async function removeObject(objectKey: string) {
  if (objectStorageMode === 'local') {
    const filePath = localFilePath(objectKey)
    if (existsSync(filePath)) {
      const { rmSync } = await import('node:fs')
      rmSync(filePath, { force: true })
    }
    return
  }
  assertS3Config()
  const response = await fetch(presign('DELETE', objectKey), { method: 'DELETE' })
  if (!response.ok && response.status !== 404) throw new HttpError(502, `对象存储文件删除失败（${response.status}）`)
}

