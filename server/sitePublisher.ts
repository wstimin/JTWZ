import { createReadStream, createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, extname, resolve, sep } from 'node:path'
import { pipeline } from 'node:stream/promises'
import yauzl from 'yauzl'
import { HttpError } from './http.js'

const maxFiles = 2000
const maxUncompressedBytes = 200 * 1024 * 1024
const blockedExtensions = new Set(['.exe', '.dll', '.msi', '.dmg', '.apk', '.deb', '.rpm'])

function validateEntryName(name: string) {
  const normalized = name.replace(/\\/g, '/')
  if (!normalized || normalized.startsWith('/') || normalized.includes('\0')) throw new HttpError(400, 'ZIP 中包含无效路径')
  const segments = normalized.split('/')
  if (segments.some((segment) => segment === '..')) throw new HttpError(400, 'ZIP 中检测到路径穿越内容')
  if (/^[a-z]:/i.test(normalized)) throw new HttpError(400, 'ZIP 中不能包含绝对路径')
  if (blockedExtensions.has(extname(normalized).toLowerCase())) throw new HttpError(400, `静态网站不能包含 ${extname(normalized)} 文件`)
  return normalized
}

function openZip(zipPath: string) {
  return new Promise<yauzl.ZipFile>((resolvePromise, reject) => {
    yauzl.open(zipPath, { lazyEntries: true, decodeStrings: true, validateEntrySizes: true }, (error, zipFile) => {
      if (error || !zipFile) reject(new HttpError(400, '无法读取 ZIP 文件，文件可能已损坏'))
      else resolvePromise(zipFile)
    })
  })
}

export async function extractStaticSite(zipPath: string, destination: string) {
  rmSync(destination, { recursive: true, force: true })
  mkdirSync(destination, { recursive: true })
  const zipFile = await openZip(zipPath)
  let files = 0
  let totalBytes = 0
  let hasIndex = false

  try {
    await new Promise<void>((resolvePromise, reject) => {
      const fail = (error: unknown) => {
        zipFile.close()
        reject(error)
      }
      zipFile.on('error', fail)
      zipFile.on('end', resolvePromise)
      zipFile.on('entry', (entry: yauzl.Entry) => {
        try {
          const name = validateEntryName(entry.fileName)
          const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff
          if ((unixMode & 0o170000) === 0o120000) throw new HttpError(400, 'ZIP 中不能包含符号链接')
          if (/\/$/.test(name)) {
            mkdirSync(resolve(destination, name), { recursive: true })
            zipFile.readEntry()
            return
          }

          files += 1
          totalBytes += entry.uncompressedSize
          if (files > maxFiles) throw new HttpError(413, `静态网站文件数量不能超过 ${maxFiles}`)
          if (totalBytes > maxUncompressedBytes) throw new HttpError(413, 'ZIP 解压后的总大小不能超过 200 MB')

          const outputPath = resolve(destination, name)
          if (!outputPath.startsWith(`${destination}${sep}`)) throw new HttpError(400, 'ZIP 中检测到路径穿越内容')
          mkdirSync(dirname(outputPath), { recursive: true })
          if (name.toLowerCase() === 'index.html') hasIndex = true

          zipFile.openReadStream(entry, (error, readStream) => {
            if (error || !readStream) return fail(error || new Error('ZIP 条目读取失败'))
            void pipeline(readStream, createWriteStream(outputPath, { flags: 'wx' }))
              .then(() => zipFile.readEntry())
              .catch(fail)
          })
        } catch (error) {
          fail(error)
        }
      })
      zipFile.readEntry()
    })
  } catch (error) {
    rmSync(destination, { recursive: true, force: true })
    throw error
  }

  if (!hasIndex || !existsSync(resolve(destination, 'index.html'))) {
    rmSync(destination, { recursive: true, force: true })
    throw new HttpError(400, 'ZIP 根目录必须包含 index.html')
  }
  return { files, totalBytes }
}

