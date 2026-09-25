import { describe, it, expect } from 'vitest'
import {
  CODE_AND_CONFIG_EXTENSIONS,
  detectSupportedMimeType,
  getProxyType,
  isCodeOrConfigDocument,
  isOfficeDocument,
  isHtmlDocument,
  isMarkdownDocument,
  isCsvDocument,
  isPlainTextDocument,
  isTxtDocument,
  normalizeMediaType,
  supportsRawTextPreview,
} from './mime'

/** Code and config extensions that must get the raw text preview. */
const REQUIRED_CODE_EXTENSIONS = [
  'json',
  'yaml',
  'yml',
  'toml',
  'ini',
  'conf',
  'xml',
  'log',
  'py',
  'js',
  'sh',
  'sql',
  'css',
  'srt',
  'vtt',
]

/** Media types clients report for code and config files (null/empty: none reported). */
const CLIENT_MEDIA_TYPES = [
  'application/octet-stream',
  'application/json',
  'text/yaml',
  'text/javascript;charset=utf-8',
  'text/plain;charset=utf-8',
  '',
  null,
]

describe('detectSupportedMimeType', () => {
  it('should detect JPEG', () => {
    const buffer = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46])
    expect(detectSupportedMimeType(buffer)).toBe('image/jpeg')
  })

  it('should detect PNG', () => {
    const buffer = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52,
    ])
    expect(detectSupportedMimeType(buffer)).toBe('image/png')
  })

  it('should detect GIF', () => {
    const buffer = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61])
    expect(detectSupportedMimeType(buffer)).toBe('image/gif')
  })

  it('should detect WEBP', () => {
    const buffer = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ])
    expect(detectSupportedMimeType(buffer)).toBe('image/webp')
  })

  it('should detect PSD', () => {
    const buffer = new Uint8Array([0x38, 0x42, 0x50, 0x53, 0x00, 0x01])
    expect(detectSupportedMimeType(buffer)).toBe('image/vnd.adobe.photoshop')
  })

  it('should detect MP4', () => {
    const buffer = new Uint8Array([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
    ])
    expect(detectSupportedMimeType(buffer)).toBe('video/mp4')
  })

  it('should return null for unknown type', () => {
    const buffer = new Uint8Array([0x00, 0x00, 0x00, 0x00])
    expect(detectSupportedMimeType(buffer)).toBeNull()
  })
})

describe('document helpers', () => {
  it('isOfficeDocument should correctly identify office files', () => {
    expect(isOfficeDocument('application/msword', 'letter.doc')).toBe(true)
    expect(
      isOfficeDocument(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'file.docx',
      ),
    ).toBe(true)
    expect(isOfficeDocument(null, 'sheet.xlsx')).toBe(true)
    expect(isOfficeDocument(null, 'slides.pptx')).toBe(true)
    expect(isOfficeDocument(null, 'notes.rtf')).toBe(true)
    expect(isOfficeDocument('text/plain', 'notes.txt')).toBe(false)
  })

  it('isHtmlDocument should correctly identify html files', () => {
    expect(isHtmlDocument('text/html', 'page.html')).toBe(true)
    expect(isHtmlDocument(null, 'index.htm')).toBe(true)
    expect(isHtmlDocument('text/plain', 'notes.txt')).toBe(false)
  })

  it('isMarkdownDocument should correctly identify markdown files', () => {
    expect(isMarkdownDocument('text/markdown', 'README.md')).toBe(true)
    expect(isMarkdownDocument(null, 'doc.markdown')).toBe(true)
  })

  it('isCsvDocument should correctly identify csv files', () => {
    expect(isCsvDocument('text/csv', 'data.csv')).toBe(true)
    expect(isCsvDocument(null, 'data.csv')).toBe(true)
  })

  it('isPlainTextDocument should identify markdown and plain text files', () => {
    expect(isPlainTextDocument('text/markdown', 'README.md')).toBe(true)
    expect(isPlainTextDocument(null, 'doc.markdown')).toBe(true)
    expect(isPlainTextDocument('text/plain', 'notes.txt')).toBe(true)
    expect(isPlainTextDocument(null, 'NOTES.TXT')).toBe(true)
    expect(isPlainTextDocument('text/plain', 'server.log')).toBe(true)
  })

  it('isPlainTextDocument should exclude csv, html, office and pdf files', () => {
    expect(isPlainTextDocument('text/csv', 'data.csv')).toBe(false)
    expect(isPlainTextDocument('text/plain', 'data.csv')).toBe(false)
    expect(isPlainTextDocument('text/html', 'page.html')).toBe(false)
    expect(isPlainTextDocument('text/plain', 'index.htm')).toBe(false)
    expect(isPlainTextDocument('application/msword', 'letter.doc')).toBe(false)
    expect(isPlainTextDocument('text/plain', 'broken.pdf')).toBe(false)
    expect(isPlainTextDocument('application/octet-stream', 'archive.zip')).toBe(false)
    expect(isPlainTextDocument(null, null)).toBe(false)
  })
})

describe('normalizeMediaType', () => {
  it('lowercases media types and drops their parameters', () => {
    expect(normalizeMediaType('Text/Plain; charset=UTF-8')).toBe('text/plain')
    expect(normalizeMediaType('text/javascript;charset=utf-8')).toBe('text/javascript')
    expect(normalizeMediaType(' application/json ')).toBe('application/json')
    expect(normalizeMediaType('')).toBe('')
    expect(normalizeMediaType(null)).toBe('')
    expect(normalizeMediaType(undefined)).toBe('')
  })

  it('makes every document helper ignore media type parameters', () => {
    expect(isOfficeDocument('application/msword; charset=binary', 'letter')).toBe(true)
    expect(isHtmlDocument('text/html;charset=utf-8', 'page')).toBe(true)
    expect(isMarkdownDocument('text/markdown; charset=UTF-8', 'notes')).toBe(true)
    expect(isCsvDocument('text/csv; header=present', 'data')).toBe(true)
    expect(isTxtDocument('text/plain;charset=utf-8', 'README')).toBe(true)
    expect(isPlainTextDocument('Text/Plain; charset=utf-8', 'README')).toBe(true)
    expect(supportsRawTextPreview('text/plain;charset=utf-8', 'README')).toBe(true)
    expect(getProxyType('text/plain;charset=utf-8', 'README')).toBe('pdf')
    expect(getProxyType('application/pdf; version=1.7', 'scan')).toBe('pdf')
    expect(getProxyType('image/png; q=0.9', 'photo')).toBe('image')
    expect(getProxyType('Video/MP4; codecs="avc1.42E01E"', 'clip')).toBe('video')
    expect(getProxyType('audio/mpeg; rate=44100', 'song')).toBe('audio')
  })
})

describe('isCodeOrConfigDocument', () => {
  it('whitelists the required code, config, log and subtitle extensions', () => {
    for (const ext of REQUIRED_CODE_EXTENSIONS) {
      expect(CODE_AND_CONFIG_EXTENSIONS).toContain(`.${ext}`)
    }
  })

  it.each(REQUIRED_CODE_EXTENSIONS)('matches .%s whatever media type the client reports', (ext) => {
    for (const mediaType of CLIENT_MEDIA_TYPES) {
      expect(isCodeOrConfigDocument(mediaType, `file.${ext}`), String(mediaType)).toBe(true)
      expect(supportsRawTextPreview(mediaType, `file.${ext}`), String(mediaType)).toBe(true)
    }
  })

  it('matches extensions case-insensitively', () => {
    expect(isCodeOrConfigDocument('application/json', 'CONFIG.JSON')).toBe(true)
    expect(isCodeOrConfigDocument(null, 'Build.Log')).toBe(true)
    expect(isCodeOrConfigDocument('', 'Deploy.SH')).toBe(true)
  })

  it('does not treat .ts, .mts or .env files as code by their extension', () => {
    for (const name of ['main.ts', 'clip.ts', 'module.mts', 'clip.mts', 'prod.env']) {
      for (const mediaType of [...CLIENT_MEDIA_TYPES, 'video/mp2t']) {
        expect(isCodeOrConfigDocument(mediaType, name), `${name} ${mediaType}`).toBe(false)
      }
    }

    // Bun resolves .ts/.mts to text/javascript and .env to application/octet-stream.
    expect(supportsRawTextPreview('text/javascript;charset=utf-8', 'main.ts')).toBe(false)
    expect(supportsRawTextPreview('text/javascript;charset=utf-8', 'module.mts')).toBe(false)
    expect(supportsRawTextPreview('application/octet-stream', 'prod.env')).toBe(false)
    expect(supportsRawTextPreview('', 'prod.env')).toBe(false)
    expect(getProxyType('text/javascript;charset=utf-8', 'main.ts')).toBeNull()
    expect(getProxyType('application/octet-stream', 'prod.env')).toBeNull()
    expect(getProxyType('video/mp2t', 'clip.ts')).toBe('video')
    expect(getProxyType('video/mp2t', 'clip.mts')).toBe('video')
  })

  it('leaves media, PDF, Office, HTML, CSV and Markdown files to their own handling', () => {
    expect(isCodeOrConfigDocument('image/png', 'diagram.xml')).toBe(false)
    expect(isCodeOrConfigDocument('video/mp4', 'recording.log')).toBe(false)
    expect(isCodeOrConfigDocument('audio/mpeg', 'track.srt')).toBe(false)
    expect(isCodeOrConfigDocument('application/pdf', 'report.json')).toBe(false)
    expect(isCodeOrConfigDocument('application/msword', 'letter.conf')).toBe(false)
    expect(isCodeOrConfigDocument('text/html', 'page.xml')).toBe(false)
    expect(isCodeOrConfigDocument('text/csv', 'export.log')).toBe(false)
    expect(isCodeOrConfigDocument('text/markdown', 'notes.yaml')).toBe(false)
    expect(isCodeOrConfigDocument(null, 'README.md')).toBe(false)
    expect(isCodeOrConfigDocument('text/plain', 'notes.txt')).toBe(false)
    expect(isCodeOrConfigDocument(null, 'archive.zip')).toBe(false)
    expect(isCodeOrConfigDocument(null, null)).toBe(false)
  })
})

describe('supportsRawTextPreview', () => {
  it('covers Markdown, plain text and code or config files', () => {
    expect(supportsRawTextPreview('text/markdown', 'README.md')).toBe(true)
    expect(supportsRawTextPreview('text/plain', 'notes.txt')).toBe(true)
    expect(supportsRawTextPreview('application/json', 'package.json')).toBe(true)
    expect(supportsRawTextPreview('text/x-python', 'script.py')).toBe(true)
  })

  it('excludes CSV, HTML, Office, PDF, image, audio, video and unknown files', () => {
    expect(supportsRawTextPreview('text/csv', 'data.csv')).toBe(false)
    expect(supportsRawTextPreview('text/html', 'index.html')).toBe(false)
    expect(supportsRawTextPreview(null, 'sheet.xlsx')).toBe(false)
    expect(supportsRawTextPreview('application/pdf', 'doc.pdf')).toBe(false)
    expect(supportsRawTextPreview('image/png', 'photo.png')).toBe(false)
    expect(supportsRawTextPreview('audio/mpeg', 'song.mp3')).toBe(false)
    expect(supportsRawTextPreview('video/mp4', 'clip.mp4')).toBe(false)
    expect(supportsRawTextPreview('image/png', 'screenshot.txt')).toBe(false)
    expect(supportsRawTextPreview('application/octet-stream', 'archive.zip')).toBe(false)
  })
})

describe('getProxyType', () => {
  it('should detect image proxyType', () => {
    expect(getProxyType('image/png', 'test.png')).toBe('image')
    expect(getProxyType('image/jpeg', 'photo.jpg')).toBe('image')
    expect(getProxyType('image/vnd.adobe.photoshop', 'design.psd')).toBe('image')
    expect(getProxyType(null, 'design.psd')).toBe('image')
  })

  it('should detect video proxyType', () => {
    expect(getProxyType('video/mp4', 'clip.mp4')).toBe('video')
  })

  it('should detect audio proxyType', () => {
    expect(getProxyType('audio/mpeg', 'song.mp3')).toBe('audio')
  })

  it('should detect pdf proxyType for pdf, csv, txt, markdown, html, and office files', () => {
    expect(getProxyType('application/pdf', 'doc.pdf')).toBe('pdf')
    expect(getProxyType('text/plain', 'notes.txt')).toBe('pdf')
    expect(getProxyType('text/csv', 'data.csv')).toBe('pdf')
    expect(getProxyType('text/markdown', 'README.md')).toBe('pdf')
    expect(getProxyType('text/x-markdown', 'doc.markdown')).toBe('pdf')
    expect(getProxyType('text/html', 'index.html')).toBe('pdf')
    expect(getProxyType('application/msword', 'letter.doc')).toBe('pdf')
    expect(getProxyType(null, 'sheet.xlsx')).toBe('pdf')
    expect(getProxyType(null, 'slides.pptx')).toBe('pdf')
  })

  it('should give code and config files no PDF preview, even as text/plain', () => {
    for (const ext of REQUIRED_CODE_EXTENSIONS) {
      for (const mediaType of [...CLIENT_MEDIA_TYPES, 'text/plain']) {
        expect(getProxyType(mediaType, `file.${ext}`), `${ext} ${mediaType}`).toBeNull()
      }
    }
  })

  it('should keep converting md and txt files to PDF whatever their media type parameters', () => {
    expect(getProxyType('text/markdown', 'README.md')).toBe('pdf')
    expect(getProxyType('text/plain;charset=utf-8', 'notes.txt')).toBe('pdf')
    expect(getProxyType('application/octet-stream', 'notes.txt')).toBe('pdf')
    expect(getProxyType(null, 'guide.markdown')).toBe('pdf')
  })

  it('should return null for unsupported files', () => {
    expect(getProxyType('application/zip', 'archive.zip')).toBeNull()
    expect(getProxyType(null, 'unknown.bin')).toBeNull()
  })
})
