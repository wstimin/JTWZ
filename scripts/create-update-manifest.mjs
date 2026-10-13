import { createHash, createPrivateKey, sign } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

export function createUpdateManifest({ version, assetPath, outputPath, downloadUrl, publishedAt = new Date().toISOString(), notes = '', privateKeyB64 = process.env.JTWZ_UPDATE_PRIVATE_KEY_B64 || '' }) {
  if (!version || !assetPath || !outputPath || !downloadUrl) {
    throw new Error('用法：node scripts/create-update-manifest.mjs <version> <asset> <output> <downloadUrl> [publishedAt] [notes]')
  }
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error('版本号格式无效')
  if (!/^https:\/\//i.test(downloadUrl)) throw new Error('下载地址必须使用 HTTPS')
  if (!privateKeyB64) throw new Error('缺少 GitHub Secret：JTWZ_UPDATE_PRIVATE_KEY_B64')

  const sha256 = createHash('sha256').update(readFileSync(assetPath)).digest('hex')
  const payload = [version, publishedAt, notes, downloadUrl, sha256].join('\n')
  const privateKey = createPrivateKey(Buffer.from(privateKeyB64, 'base64').toString('utf8'))
  if (privateKey.asymmetricKeyType !== 'ed25519') throw new Error('更新私钥必须是 Ed25519')
  const signature = sign(null, Buffer.from(payload, 'utf8'), privateKey).toString('base64')
  const manifest = {
  version, publishedAt, notes, downloadUrl, sha256, signatureAlgorithm: 'ed25519', signature,
  }
  writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  return manifest
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [version, assetPath, outputPath, downloadUrl, publishedAt = new Date().toISOString(), notes = ''] = process.argv.slice(2)
  createUpdateManifest({ version, assetPath, outputPath, downloadUrl, publishedAt, notes })
}
