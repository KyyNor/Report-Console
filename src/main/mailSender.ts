/**
 * 打包外发邮件 — 工作台「打包并发送邮箱」的主进程实现（移植自 looopsend 的发送约定，传输层用 nodemailer）
 * - 配置独立存 settings（不与 looop-studio 共享），分卷命名与正文格式沿用 looopsend 约定
 * - zip 分卷：{项目名}-{YYYYMMDD}-{hash4}.zip.001…（字节级切分，接收方按序拼接即还原 zip）
 * - 邮件：主题「[ReportConsole] 文件传输 - {分卷名} - 第{n}/{total}部分」，base64 zip 附件；
 *   隐式 TLS（465）或明文连接（nodemailer 在服务器通告 STARTTLS 时自动升级）
 * - 任一卷发送失败：全部分卷保留到系统临时目录后报错（带路径），供检查后手动补发
 * - 不设整体超时：大附件 base64 传输耗时长，硬超时会误杀合法传输（与 looopsend 行为一致）
 */
import { createHash, randomBytes } from 'crypto'
import { mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import nodemailer from 'nodemailer'

// ── 分卷 ───────────────────────────────────────────────────────

export interface ZipPart {
  fileName: string
  data: Buffer
  number: number
}

/** 把 zip 字节流按 chunkBytes 切分，命名 {base}-{YYYYMMDD}-{hash4}.zip.{001…}；hash4 区分同日多次发送。 */
export function splitZipParts(zip: Buffer, baseName: string, chunkBytes: number): ZipPart[] {
  if (!Number.isInteger(chunkBytes) || chunkBytes <= 0) throw new Error('分卷大小必须为正整数')
  const now = new Date()
  const date = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  const hash4 = createHash('sha256').update(`${baseName}|${now.getTime()}|${randomBytes(8).toString('hex')}`).digest('hex').slice(0, 4)
  const zipBase = `${baseName}-${date}-${hash4}.zip`
  const parts: ZipPart[] = []
  for (let off = 0, n = 1; off < zip.length || n === 1; off += chunkBytes, n++) {
    parts.push({
      fileName: `${zipBase}.${String(n).padStart(3, '0')}`,
      data: zip.subarray(off, off + chunkBytes),
      number: n
    })
  }
  return parts
}

// ── 发送配置与入口 ─────────────────────────────────────────────

export interface SmtpConfig {
  host: string
  port: number
  /** 隐式 TLS（465）；关闭时明文连接，服务器通告 STARTTLS 时 nodemailer 自动升级 */
  tls: boolean
  from: string
  password: string
}

export interface SendProgress {
  number: number
  total: number
  fileName: string
}

export interface SendResult {
  total: number
  bytes: number
  fileNames: string[]
}

/** 发送前置校验：配置不全给出可操作的报错（渲染层据此引导去设置页）。 */
export function assertSmtpConfig(cfg: SmtpConfig): void {
  const missing: string[] = []
  if (!cfg.host.trim()) missing.push('SMTP 服务器')
  if (!cfg.from.trim()) missing.push('发件邮箱')
  if (!cfg.password) missing.push('密码/授权码')
  if (missing.length) throw new Error(`发件配置不完整（${missing.join('、')}）：请到「设置 → 打包邮件发送」填写`)
}

function createTransport(cfg: SmtpConfig): nodemailer.Transporter {
  return nodemailer.createTransport({
    host: cfg.host.trim(),
    port: cfg.port,
    secure: cfg.tls,
    auth: { user: cfg.from.trim(), pass: cfg.password }
  })
}

/** 连接 + 认证探活（不发信），设置页「测试连接」用。 */
export async function testSmtp(cfg: SmtpConfig): Promise<void> {
  assertSmtpConfig(cfg)
  await createTransport(cfg).verify()
}

/** 发送失败时保留分卷的目录（系统临时目录下，按项目名+时间戳隔离；os.tmpdir 与 Electron app.getPath('temp') 同源）。 */
function retainPartsDir(baseName: string): string {
  const now = new Date()
  const p2 = (n: number): string => String(n).padStart(2, '0')
  const ts = `${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}-${p2(now.getHours())}${p2(now.getMinutes())}${p2(now.getSeconds())}`
  const dir = join(tmpdir(), 'report-console-send', `${baseName}-${ts}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * 把 zip 按分卷逐封发送。任一卷失败：全部分卷写入系统临时目录后抛错（带保留路径），
 * 便于用户检查后把分卷作为附件手动补发 —— 与 looopsend 的失败策略一致。
 */
export async function sendZipAsMailParts(opts: {
  zip: Buffer
  baseName: string
  to: string
  cfg: SmtpConfig
  chunkBytes: number
  onProgress?: (p: SendProgress) => void
}): Promise<SendResult> {
  assertSmtpConfig(opts.cfg)
  if (!/^[^@\s]+@[^@\s]+$/.test(opts.to)) throw new Error(`收件邮箱无效：${opts.to || '(空)'}`)
  const parts = splitZipParts(opts.zip, opts.baseName, opts.chunkBytes)
  const total = parts.length
  const transport = createTransport(opts.cfg)
  for (const part of parts) {
    opts.onProgress?.({ number: part.number, total, fileName: part.fileName })
    try {
      await transport.sendMail({
        from: opts.cfg.from.trim(),
        to: opts.to,
        subject: `[ReportConsole] 文件传输 - ${part.fileName} - 第${part.number}/${total}部分`,
        text: `文件名: ${part.fileName}\n第 ${part.number} 部分，共 ${total} 部分。`,
        attachments: [{ filename: part.fileName, content: part.data, contentType: 'application/zip' }]
      })
    } catch (e) {
      transport.close()
      const dir = retainPartsDir(opts.baseName)
      for (const p of parts) writeFileSync(join(dir, p.fileName), p.data)
      throw new Error(`第 ${part.number}/${total} 卷发送失败：${(e as Error).message}。全部分卷已保留在 ${dir}，可手动作为附件补发`)
    }
  }
  transport.close()
  return { total, bytes: opts.zip.length, fileNames: parts.map((p) => p.fileName) }
}
