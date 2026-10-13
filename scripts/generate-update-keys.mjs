import { generateKeyPairSync } from 'node:crypto'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const privatePath = resolve(process.argv[2] || 'release-signing-private.pem')
const publicPath = resolve(process.argv[3] || 'deploy/installer/update-public-key.pem')
if (existsSync(privatePath) || existsSync(publicPath)) throw new Error('目标密钥文件已经存在；为避免覆盖发布密钥，操作已停止。')
const { privateKey, publicKey } = generateKeyPairSync('ed25519')
mkdirSync(dirname(privatePath), { recursive: true })
mkdirSync(dirname(publicPath), { recursive: true })
writeFileSync(privatePath, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
writeFileSync(publicPath, publicKey.export({ type: 'spki', format: 'pem' }), { mode: 0o644 })
console.log(`私钥（不要提交）：${privatePath}`)
console.log(`公钥（需要提交并随安装包发布）：${publicPath}`)
console.log(`GitHub Secret 值：node -e "process.stdout.write(require('fs').readFileSync('${privatePath.replace(/\\/g, '\\\\')}').toString('base64'))"`)
