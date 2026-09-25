import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import {
  countTextLines,
  decodeTextBytes,
  normalizeLineEndings,
  readTextFileHead,
  splitTextLines,
} from './text-file'

// "你好" encoded as GBK/GB18030
const GBK_NIHAO = [0xc4, 0xe3, 0xba, 0xc3]

describe('normalizeLineEndings', () => {
  it('converts CRLF and lone CR to LF', () => {
    expect(normalizeLineEndings('a\r\nb\rc\nd')).toBe('a\nb\nc\nd')
  })
})

describe('decodeTextBytes', () => {
  it('decodes UTF-8 and strips the BOM', () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...Buffer.from('标题\r\nline')])
    expect(decodeTextBytes(bytes)).toEqual({ text: '标题\nline', encoding: 'utf-8' })
  })

  it('falls back to GB18030 for invalid UTF-8', () => {
    const bytes = new Uint8Array([...GBK_NIHAO, 0x0a, ...Buffer.from('ok')])
    expect(decodeTextBytes(bytes)).toEqual({ text: '你好\nok', encoding: 'gb18030' })
  })

  it('decodes UTF-16 when a BOM is present', () => {
    const le = new Uint8Array([0xff, 0xfe, 0x60, 0x4f, 0x0d, 0x00, 0x0a, 0x00, 0x41, 0x00])
    expect(decodeTextBytes(le)).toEqual({ text: '你\nA', encoding: 'utf-16le' })

    const be = new Uint8Array([0xfe, 0xff, 0x4f, 0x60, 0x00, 0x0a, 0x00, 0x41])
    expect(decodeTextBytes(be)).toEqual({ text: '你\nA', encoding: 'utf-16be' })
  })
})

describe('readTextFileHead', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'text-file-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  function writeFile(name: string, content: Uint8Array | string): string {
    const filePath = path.join(tmpDir, name)
    fs.writeFileSync(filePath, content)
    return filePath
  }

  it('reads small files completely', () => {
    const filePath = writeFile('small.txt', 'one\ntwo\n')
    expect(readTextFileHead(filePath, 1024)).toEqual({
      text: 'one\ntwo\n',
      encoding: 'utf-8',
      truncated: false,
    })
  })

  it('cuts large files at the last complete line without splitting characters', () => {
    // Each line is "行N\n": 3 bytes for 行 + digits + newline.
    const content = Array.from({ length: 50 }, (_, i) => `行${i}`).join('\n') + '\n'
    const filePath = writeFile('large.txt', content)

    const head = readTextFileHead(filePath, 40)
    expect(head.truncated).toBe(true)
    expect(head.encoding).toBe('utf-8')
    expect(head.text.endsWith('\n')).toBe(true)
    expect(Buffer.byteLength(head.text, 'utf-8')).toBeLessThanOrEqual(40)
    expect(content.startsWith(head.text)).toBe(true)
  })

  it('keeps GB18030 detection when truncating', () => {
    const line = [...GBK_NIHAO, 0x0a]
    const bytes = new Uint8Array(Array.from({ length: 20 }, () => line).flat())
    const filePath = writeFile('gbk.txt', bytes)

    const head = readTextFileHead(filePath, 12)
    expect(head).toEqual({ text: '你好\n你好\n', encoding: 'gb18030', truncated: true })
  })

  it('drops an incomplete trailing character when a huge single line is cut', () => {
    const filePath = writeFile('single-line.txt', '中'.repeat(100))

    const head = readTextFileHead(filePath, 10)
    expect(head).toEqual({ text: '中中中', encoding: 'utf-8', truncated: true })
  })

  it('cuts UTF-16 files at a line break', () => {
    const units = [0xff, 0xfe]
    for (let i = 0; i < 10; i++) units.push(0x41, 0x00, 0x0a, 0x00)
    const filePath = writeFile('utf16.txt', new Uint8Array(units))

    const head = readTextFileHead(filePath, 11)
    expect(head).toEqual({ text: 'A\nA\n', encoding: 'utf-16le', truncated: true })
  })
})

describe('splitTextLines', () => {
  it('does not count a trailing line break as an extra line', () => {
    expect(splitTextLines('')).toEqual([])
    expect(splitTextLines('a')).toEqual(['a'])
    expect(splitTextLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitTextLines('a\n\nb')).toEqual(['a', '', 'b'])
    expect(splitTextLines('\n')).toEqual([''])
    expect(countTextLines('a\nb\n')).toBe(2)
  })
})
