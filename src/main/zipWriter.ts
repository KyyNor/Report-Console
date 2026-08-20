/**
 * 极简 ZIP 打包器 — 只覆盖项目导出所需：已知大小的本地文件 + 目录条目，
 * deflate 压缩（压不小则回退 store）、UTF-8 文件名（meta 文档可能是中文）。
 * 不引第三方依赖：跨平台行为一致（Windows 无自带 zip CLI），字节流自包含可测。
 * 不支持 ZIP64 —— 单项目 reportlets 远达不到 4GB / 65535 条目，超限直接报错。
 */
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative, sep } from 'path'
import { deflateRawSync } from 'zlib'

export interface ZipEntry {
  /** zip 内相对路径（/ 分隔）；目录条目以 / 结尾 */
  name: string
  data: Buffer
  mtime: Date
}

/** 版本库、依赖与系统杂项不进入交付包 */
const SKIP_NAMES = new Set(['.git', 'node_modules', '.DS_Store', 'Thumbs.db'])

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf: Buffer): number {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** DOS 时间戳从 1980 年起算，更早的时间直接钳制 */
function dosDateTime(d: Date): { time: number; date: number } {
  const year = Math.max(d.getFullYear(), 1980)
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  }
}

/** 递归收集 root 下全部文件与目录条目（相对 root、名字序稳定）；调用方负责加顶层前缀。 */
export function collectZipEntries(root: string): ZipEntry[] {
  const out: ZipEntry[] = []
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (SKIP_NAMES.has(entry.name)) continue
      const file = join(dir, entry.name)
      const rel = relative(root, file).split(sep).join('/')
      if (entry.isDirectory()) {
        out.push({ name: `${rel}/`, data: Buffer.alloc(0), mtime: statSync(file).mtime })
        visit(file)
      } else if (entry.isFile()) {
        out.push({ name: rel, data: readFileSync(file), mtime: statSync(file).mtime })
      }
    }
  }
  visit(root)
  return out
}

export function buildZip(entries: ZipEntry[]): Buffer {
  if (entries.length > 0xffff) throw new Error(`条目数 ${entries.length} 超出打包器上限 65535`)
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf-8')
    const isDir = entry.name.endsWith('/')
    const raw = entry.data
    const deflated = isDir || raw.length === 0 ? null : deflateRawSync(raw)
    const useDeflate = !!deflated && deflated.length < raw.length
    const method = useDeflate ? 8 : 0
    const data = useDeflate ? deflated! : raw
    const crc = crc32(raw)
    const { time, date } = dosDateTime(entry.mtime)

    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)          // version needed
    local.writeUInt16LE(0x0800, 6)      // UTF-8 文件名
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(time, 10)
    local.writeUInt16LE(date, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)          // extra len
    name.copy(local, 30)
    locals.push(local, data)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)        // version made by
    central.writeUInt16LE(20, 6)        // version needed
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(method, 10)
    central.writeUInt16LE(time, 12)
    central.writeUInt16LE(date, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(data.length, 20)
    central.writeUInt32LE(raw.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt16LE(0, 30)        // extra len
    central.writeUInt16LE(0, 32)        // comment len
    central.writeUInt16LE(0, 34)        // disk start
    central.writeUInt16LE(0, 36)        // internal attrs
    central.writeUInt32LE(isDir ? 0x100000 : 0, 38) // DOS 目录位
    central.writeUInt32LE(offset, 42)   // 本地头偏移
    name.copy(central, 46)
    centrals.push(central)

    offset += local.length + data.length
  }
  const centralDir = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(centralDir.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralDir, eocd])
}
