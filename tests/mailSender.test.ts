import { describe, expect, it } from 'vitest'
import net from 'net'
import { AddressInfo } from 'net'
import { sendZipAsMailParts, splitZipParts } from '@main/mailSender'

describe('打包邮件分卷', () => {
  it('按 chunkBytes 切分并按 {base}-{日期}-{hash4}.zip.{NNN} 命名', () => {
    const zip = Buffer.alloc(250, 7)
    const parts = splitZipParts(zip, 'order', 100)
    expect(parts).toHaveLength(3)
    expect(parts.map((p) => p.number)).toEqual([1, 2, 3])
    for (const p of parts) expect(p.data.length).toBe(p.number < 3 ? 100 : 50)
    const names = parts.map((p) => p.fileName)
    for (const n of names) expect(n).toMatch(/^order-\d{8}-[0-9a-f]{4}\.zip\.\d{3}$/)
    // 同一次切分的分卷共享同一 zip 主名（接收方按序拼接还原）
    const bases = new Set(names.map((n) => n.replace(/\.\d{3}$/, '')))
    expect(bases.size).toBe(1)
    // 字节序拼接无损还原
    expect(Buffer.concat(parts.map((p) => p.data))).toEqual(zip)
  })

  it('不足一卷时产出单个分卷；空流也保持一个可发送的分卷', () => {
    expect(splitZipParts(Buffer.alloc(10), 'demo', 30)).toHaveLength(1)
    expect(splitZipParts(Buffer.alloc(0), 'demo', 30)).toHaveLength(1)
  })

  it('非正整数分卷大小直接报错', () => {
    expect(() => splitZipParts(Buffer.alloc(1), 'demo', 0)).toThrow()
    expect(() => splitZipParts(Buffer.alloc(1), 'demo', 1.5)).toThrow()
  })
})

/** 测试助手：展开头域折行并解码 RFC 2047（B/Q）主题，断言与 looopsend 主题格式一致时用。 */
function decodeSubject(msg: string): string {
  const unfolded = msg.split('\r\n\r\n')[0].split('\r\n').reduce<string[]>((lines, line) => {
    if (line.startsWith(' ') && lines.length) lines[lines.length - 1] += line.slice(1)
    else lines.push(line)
    return lines
  }, []).join('\r\n')
  const subjectLine = /^Subject: (.*)$/m.exec(unfolded)?.[1] ?? ''
  // RFC 2047：相邻编码字之间的空白解码时忽略（只删空白，保留前字结尾 ?= 与后字开头 =?）
  const joined = subjectLine.replace(/\?=\s+=\?/g, '?==?')
  return joined.replace(/=\?utf-8\?([bq])\?([\s\S]*?)\?=/gi, (_s, enc: string, word: string) =>
    enc.toLowerCase() === 'b'
      ? Buffer.from(word, 'base64').toString('utf-8')
      : Buffer.from(word.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, h: string) => String.fromCharCode(parseInt(h, 16))), 'binary').toString('utf-8')
  )
}

describe('SMTP 发送（本地 mock 服务器）', () => {
  it('逐卷发送：AUTH PLAIN → 信封 → MIME 附件，主题与 looopsend 格式一致', async () => {
    // mock：EHLO 通告 AUTH PLAIN（nodemailer 仅在服务器通告时才认证）；DATA 后按行收集直至单独的 `.` 行
    const envelopes: string[] = []
    const auths: string[] = []
    const messages: string[] = []
    const progress: Array<{ number: number; total: number }> = []
    const server = net.createServer((socket) => {
      let inData = false
      let buf = Buffer.alloc(0)
      let msg = ''
      socket.write('220 mock ESMTP ready\r\n')
      socket.on('data', (chunk: Buffer) => {
        buf = Buffer.concat([buf, chunk])
        for (;;) {
          const idx = buf.indexOf('\r\n')
          if (idx < 0) break
          const line = buf.subarray(0, idx).toString('utf-8')
          buf = buf.subarray(idx + 2)
          if (inData) {
            if (line === '.') {
              messages.push(msg)
              msg = ''
              inData = false
              socket.write('250 OK queued\r\n')
            } else {
              msg += `${line}\r\n`
            }
            continue
          }
          const upper = line.toUpperCase()
          if (upper.startsWith('EHLO')) socket.write('250-mock\r\n250-SIZE 52428800\r\n250 AUTH PLAIN\r\n')
          else if (upper.startsWith('AUTH PLAIN')) { auths.push(line); socket.write('235 OK\r\n') }
          else if (upper.startsWith('MAIL FROM') || upper.startsWith('RCPT TO')) { envelopes.push(line); socket.write('250 OK\r\n') }
          else if (upper === 'DATA') { inData = true; socket.write('354 end with .\r\n') }
          else if (upper === 'QUIT') { socket.write('221 bye\r\n'); socket.end() }
          else socket.write('250 OK\r\n')
        }
      })
    })
    const port = await new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
    try {
      const r = await sendZipAsMailParts({
        zip: Buffer.alloc(100, 3), baseName: 'order', to: 'rcv@corp.com',
        cfg: { host: '127.0.0.1', port, tls: false, from: 'snd@corp.com', password: 'pw' },
        chunkBytes: 40, onProgress: (p) => progress.push({ number: p.number, total: p.total })
      })
      expect(r.total).toBe(3)
      expect(progress).toEqual([{ number: 1, total: 3 }, { number: 2, total: 3 }, { number: 3, total: 3 }])
      // nodemailer 默认每封新连接：每卷各认证一次（与 looopsend 每卷一连接一致），凭证相同
      expect(auths).toHaveLength(3)
      for (const a of auths) expect(a).toBe(`AUTH PLAIN ${Buffer.from('\u0000snd@corp.com\u0000pw').toString('base64')}`)
      expect(envelopes.filter((l) => l.startsWith('MAIL FROM:<snd@corp.com>'))).toHaveLength(3)
      expect(envelopes.filter((l) => l.startsWith('RCPT TO:<rcv@corp.com>'))).toHaveLength(3)
      expect(messages).toHaveLength(3)
      for (const [i, m] of messages.entries()) {
        expect(m).toContain('From: snd@corp.com')
        expect(m).toContain('To: rcv@corp.com')
        // 主题 RFC 2047 编码（B 或 Q、可能折行），解码后为带 ReportConsole 标题的分卷主题
        expect(decodeSubject(m)).toBe(`[ReportConsole] 文件传输 - ${r.fileNames[i]} - 第${i + 1}/3部分`)
        // 附件 base64 还原为该卷字节
        const attach = /Content-Disposition: attachment; filename=[^\r\n]*\r\n\r\n([\s\S]*)$/.exec(m)?.[1]?.replace(/\r\n/g, '') ?? ''
        expect(Buffer.from(attach, 'base64')).toEqual(Buffer.alloc(i < 2 ? 40 : 20, 3))
      }
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('服务器拒绝认证时报错带卷号与原因', async () => {
    const server = net.createServer((socket) => {
      socket.write('220 mock\r\n')
      socket.on('data', (chunk: Buffer) => {
        const line = chunk.toString('utf-8').trim()
        if (line.toUpperCase().startsWith('EHLO')) socket.write('250-mock\r\n250 AUTH PLAIN\r\n')
        else if (line.toUpperCase().startsWith('AUTH')) socket.write('535 authentication failed\r\n')
        else socket.write('250 OK\r\n')
      })
    })
    const port = await new Promise<number>((resolve) => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)))
    try {
      await expect(sendZipAsMailParts({
        zip: Buffer.alloc(10), baseName: 'demo', to: 'rcv@corp.com',
        cfg: { host: '127.0.0.1', port, tls: false, from: 'snd@corp.com', password: 'bad' },
        chunkBytes: 100
      })).rejects.toThrow(/第 1\/1 卷发送失败[\s\S]*535/)
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
