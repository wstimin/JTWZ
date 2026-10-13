import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { extname } from 'node:path'
import { HttpError } from '../http.js'

const allowedPackageExtensions = new Set(['.exe', '.msi', '.dmg', '.pkg', '.apk', '.zip', '.deb', '.rpm', '.appimage', '.tar', '.gz'])
const blockedMimeTypes = new Set(['text/html', 'image/svg+xml', 'application/javascript', 'text/javascript'])

export function validatePackageMetadata(fileName: string, contentType = '') {
  const extension = extname(fileName).toLowerCase()
  if (!allowedPackageExtensions.has(extension)) throw new HttpError(400, '不支持该安装包格式')
  const normalizedType = contentType.split(';')[0].trim().toLowerCase()
  if (blockedMimeTypes.has(normalizedType)) throw new HttpError(400, '安装包 Content-Type 不安全')
  return extension
}

function startsWith(buffer: Buffer, bytes: number[]) {
  return buffer.subarray(0, bytes.length).equals(Buffer.from(bytes))
}

export function validatePackageFile(filePath: string, fileName: string) {
  const extension = validatePackageMetadata(fileName)
  const stats = statSync(filePath)
  if (!stats.isFile() || stats.size <= 0) throw new HttpError(400, '安装包内容为空')
  const head = Buffer.alloc(Math.min(512, stats.size))
  const footer = Buffer.alloc(Math.min(512, stats.size))
  const descriptor = openSync(filePath, 'r')
  try {
    readSync(descriptor, head, 0, head.length, 0)
    readSync(descriptor, footer, 0, footer.length, Math.max(0, stats.size - footer.length))
  } finally { closeSync(descriptor) }

  const zip = startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])
  const valid = extension === '.exe' ? startsWith(head, [0x4d, 0x5a])
    : extension === '.msi' ? startsWith(head, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
      : extension === '.apk' || extension === '.zip' ? zip
        : extension === '.deb' ? head.subarray(0, 8).toString('ascii') === '!<arch>\n'
          : extension === '.rpm' ? startsWith(head, [0xed, 0xab, 0xee, 0xdb])
            : extension === '.appimage' ? startsWith(head, [0x7f, 0x45, 0x4c, 0x46])
              : extension === '.gz' ? startsWith(head, [0x1f, 0x8b])
                : extension === '.tar' ? head.subarray(257, 262).toString('ascii') === 'ustar'
                  : extension === '.pkg' ? head.subarray(0, 4).toString('ascii') === 'xar!' || zip
                    : extension === '.dmg' ? footer.includes(Buffer.from('koly'))
                      : false
  if (!valid) throw new HttpError(400, `文件内容与 ${extension.slice(1).toUpperCase()} 格式不匹配`)
}
