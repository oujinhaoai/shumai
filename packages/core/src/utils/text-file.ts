import * as fs from 'fs'

export interface DecodedText {
  /** Decoded text with line endings normalized to LF. */
  text: string
  /** Encoding the bytes were decoded from. */
  encoding: string
}

export interface TextFileHead extends DecodedText {
  /** True when the file was larger than the byte limit and only its head was read. */
  truncated: boolean
}

function hasUtf16LeBom(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
}

function hasUtf16BeBom(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff
}

/** Converts CRLF and lone CR line endings to LF so line numbers are stable everywhere. */
export function normalizeLineEndings(text: string): string {
  return text.replace(/\r\n?/g, '\n')
}

/**
 * Decodes the bytes of a user-uploaded text file. UTF-16 is used when a BOM is
 * present; otherwise strict UTF-8 is tried first, falling back to GB18030 (a
 * superset of GBK/GB2312, common for Chinese text files).
 */
export function decodeTextBytes(bytes: Uint8Array): DecodedText {
  if (hasUtf16LeBom(bytes)) {
    return {
      text: normalizeLineEndings(new TextDecoder('utf-16le').decode(bytes)),
      encoding: 'utf-16le',
    }
  }
  if (hasUtf16BeBom(bytes)) {
    return {
      text: normalizeLineEndings(new TextDecoder('utf-16be').decode(bytes)),
      encoding: 'utf-16be',
    }
  }
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    return { text: normalizeLineEndings(text), encoding: 'utf-8' }
  } catch {
    return {
      text: normalizeLineEndings(new TextDecoder('gb18030').decode(bytes)),
      encoding: 'gb18030',
    }
  }
}

/**
 * Cuts a truncated byte buffer back to its last complete line so decoding never
 * sees half a character. Falls back to dropping an incomplete trailing UTF-8
 * sequence when the head contains no line break at all.
 */
function trimToCompleteLines(bytes: Uint8Array): Uint8Array {
  if (hasUtf16LeBom(bytes) || hasUtf16BeBom(bytes)) {
    const littleEndian = hasUtf16LeBom(bytes)
    const evenLength = bytes.length - (bytes.length % 2)
    for (let i = evenLength - 2; i >= 2; i -= 2) {
      const isLineFeed = littleEndian
        ? bytes[i] === 0x0a && bytes[i + 1] === 0x00
        : bytes[i] === 0x00 && bytes[i + 1] === 0x0a
      if (isLineFeed) return bytes.subarray(0, i + 2)
    }
    return bytes.subarray(0, evenLength)
  }

  // 0x0A never appears inside a multi-byte UTF-8 or GB18030 sequence.
  const lastLineFeed = bytes.lastIndexOf(0x0a)
  if (lastLineFeed >= 0) return bytes.subarray(0, lastLineFeed + 1)

  // Single huge line: drop a trailing, incomplete UTF-8 sequence (at most 3 bytes).
  for (let drop = 0; drop <= 3 && drop < bytes.length; drop++) {
    const candidate = bytes.subarray(0, bytes.length - drop)
    try {
      new TextDecoder('utf-8', { fatal: true }).decode(candidate)
      return candidate
    } catch {
      // try dropping one more byte
    }
  }
  return bytes
}

/**
 * Reads at most `maxBytes` of a text file and decodes it (see {@link decodeTextBytes}).
 * When the file is larger, the result stops at the last complete line.
 */
export function readTextFileHead(filePath: string, maxBytes: number): TextFileHead {
  const size = fs.statSync(filePath).size
  if (size <= maxBytes) {
    return { ...decodeTextBytes(fs.readFileSync(filePath)), truncated: false }
  }

  const buffer = Buffer.alloc(maxBytes)
  const fd = fs.openSync(filePath, 'r')
  let bytesRead: number
  try {
    bytesRead = fs.readSync(fd, buffer, 0, maxBytes, 0)
  } finally {
    fs.closeSync(fd)
  }
  const head = trimToCompleteLines(new Uint8Array(buffer.subarray(0, bytesRead)))
  return { ...decodeTextBytes(head), truncated: true }
}

/**
 * Splits text into display lines: a trailing line break does not start an extra
 * empty line. Must stay in sync with the WebUI text viewer's line splitting.
 */
export function splitTextLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

export function countTextLines(text: string): number {
  return splitTextLines(text).length
}
