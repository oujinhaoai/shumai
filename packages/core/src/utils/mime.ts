export type ProxyType = 'image' | 'video' | 'audio' | 'pdf' | 'text'

/**
 * Lowercases a media type and drops its parameters, so `Text/Plain; charset=UTF-8`
 * compares equal to `text/plain`. Every media type check in this module goes through it.
 */
export function normalizeMediaType(mediaType?: string | null): string {
  return (mediaType ?? '').split(';')[0].trim().toLowerCase()
}

export function isOfficeDocument(mediaType?: string | null, filename?: string | null): boolean {
  const lowerMediaType = normalizeMediaType(mediaType)
  const lowerFilename = filename?.toLowerCase() || ''

  if (
    lowerMediaType === 'application/msword' ||
    lowerMediaType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    lowerMediaType === 'application/vnd.ms-excel' ||
    lowerMediaType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' ||
    lowerMediaType === 'application/vnd.ms-powerpoint' ||
    lowerMediaType ===
      'application/vnd.openxmlformats-officedocument.presentationml.presentation' ||
    lowerMediaType === 'application/vnd.oasis.opendocument.text' ||
    lowerMediaType === 'application/vnd.oasis.opendocument.spreadsheet' ||
    lowerMediaType === 'application/vnd.oasis.opendocument.presentation' ||
    lowerMediaType === 'application/rtf' ||
    lowerMediaType === 'text/rtf'
  ) {
    return true
  }

  const officeExtensions = [
    '.doc',
    '.docx',
    '.xls',
    '.xlsx',
    '.ppt',
    '.pptx',
    '.odt',
    '.ods',
    '.odp',
    '.rtf',
  ]
  return officeExtensions.some((ext) => lowerFilename.endsWith(ext))
}

export function isHtmlDocument(mediaType?: string | null, filename?: string | null): boolean {
  const lowerMediaType = normalizeMediaType(mediaType)
  const lowerFilename = filename?.toLowerCase() || ''

  return (
    lowerMediaType === 'text/html' ||
    lowerFilename.endsWith('.html') ||
    lowerFilename.endsWith('.htm')
  )
}

export function isMarkdownDocument(mediaType?: string | null, filename?: string | null): boolean {
  const lowerMediaType = normalizeMediaType(mediaType)
  const lowerFilename = filename?.toLowerCase() || ''

  return (
    lowerMediaType === 'text/markdown' ||
    lowerMediaType === 'text/x-markdown' ||
    lowerFilename.endsWith('.md') ||
    lowerFilename.endsWith('.markdown')
  )
}

export function isCsvDocument(mediaType?: string | null, filename?: string | null): boolean {
  const lowerMediaType = normalizeMediaType(mediaType)
  const lowerFilename = filename?.toLowerCase() || ''

  return lowerMediaType === 'text/csv' || lowerFilename.endsWith('.csv')
}

/** Plain-text files: a `.txt` name or a `text/plain` media type. */
export function isTxtDocument(mediaType?: string | null, filename?: string | null): boolean {
  const lowerFilename = filename?.toLowerCase() || ''

  return normalizeMediaType(mediaType) === 'text/plain' || lowerFilename.endsWith('.txt')
}

/**
 * Code, config, log and subtitle file extensions that the raw text preview shows as
 * their original text. They are matched by extension whatever media type the client
 * reports, since browsers and the CLI report these files inconsistently (often as
 * `application/octet-stream` or not at all). `.ts` and `.mts` are left out on purpose
 * because they are also video extensions (MPEG transport stream, AVCHD), and so is
 * `.env` because such files usually hold secrets.
 */
export const CODE_AND_CONFIG_EXTENSIONS: readonly string[] = [
  // Data and configuration
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.properties',
  '.xml',
  '.log',
  // Code and scripts
  '.py',
  '.js',
  '.mjs',
  '.cjs',
  '.jsx',
  '.sh',
  '.bash',
  '.sql',
  '.css',
  // Subtitles
  '.srt',
  '.vtt',
]

/**
 * Files that keep their own preview whatever their name suggests: images, audio and
 * video (by media type, plus Photoshop files) and the PDF, Office, HTML and CSV
 * documents that are converted to PDF.
 */
function hasDedicatedPreview(mediaType?: string | null, filename?: string | null): boolean {
  const lowerMediaType = normalizeMediaType(mediaType)
  const lowerFilename = filename?.toLowerCase() || ''

  return (
    lowerMediaType.startsWith('image/') ||
    lowerMediaType.startsWith('video/') ||
    lowerMediaType.startsWith('audio/') ||
    lowerFilename.endsWith('.psd') ||
    lowerMediaType === 'application/pdf' ||
    lowerFilename.endsWith('.pdf') ||
    isOfficeDocument(mediaType, filename) ||
    isHtmlDocument(mediaType, filename) ||
    isCsvDocument(mediaType, filename)
  )
}

/**
 * Markdown and plain-text (.txt / text/plain) documents. CSV, HTML, Office and PDF
 * files are excluded even when uploaded as `text/plain`, matching the precedence
 * used for PDF proxies, and so are images, audio and video.
 */
export function isPlainTextDocument(mediaType?: string | null, filename?: string | null): boolean {
  if (hasDedicatedPreview(mediaType, filename)) return false

  return isMarkdownDocument(mediaType, filename) || isTxtDocument(mediaType, filename)
}

/**
 * Code, config, log and subtitle files (see {@link CODE_AND_CONFIG_EXTENSIONS}). The
 * extension decides, unless the media type marks the file as an image, audio, video,
 * PDF, Office, HTML, CSV or Markdown document, which keep their own handling.
 */
export function isCodeOrConfigDocument(
  mediaType?: string | null,
  filename?: string | null,
): boolean {
  const lowerFilename = filename?.toLowerCase() || ''
  if (!CODE_AND_CONFIG_EXTENSIONS.some((ext) => lowerFilename.endsWith(ext))) return false

  return !hasDedicatedPreview(mediaType, filename) && !isMarkdownDocument(mediaType, filename)
}

/**
 * Files the raw text preview (team setting `textPreviewMode: raw`) shows as their
 * original text: Markdown and plain-text documents, and code and config files.
 */
export function supportsRawTextPreview(
  mediaType?: string | null,
  filename?: string | null,
): boolean {
  return isPlainTextDocument(mediaType, filename) || isCodeOrConfigDocument(mediaType, filename)
}

/**
 * Image formats the preview pipeline cannot decode: sharp's bundled libvips has no loader
 * for OpenEXR, Radiance HDR, Targa, DirectDraw Surface, BMP or JPEG 2000, and only
 * Photoshop files go through ImageMagick. They are matched by extension, whatever media
 * type the client reported or Bun inferred from the name (`image/aces`, `image/x-tga`,
 * `image/vnd.ms-dds`, `image/x-ms-bmp`, `image/jp2`, or none at all for `.hdr`).
 */
export const UNDECODABLE_IMAGE_EXTENSIONS: readonly string[] = [
  '.exr',
  '.hdr',
  '.tga',
  '.dds',
  '.bmp',
  '.jp2',
]

/** Whether the file is an image format with no preview (see {@link UNDECODABLE_IMAGE_EXTENSIONS}). */
export function isUndecodableImage(filename?: string | null): boolean {
  const lowerFilename = filename?.toLowerCase() || ''
  return UNDECODABLE_IMAGE_EXTENSIONS.some((ext) => lowerFilename.endsWith(ext))
}

/**
 * The preview proxy a file gets by default, before the team's text preview mode is
 * applied. Code and config files get none: they are never converted to PDF, even when
 * reported as `text/plain`, and are only previewed as original text in raw mode. Image
 * formats that cannot be decoded get none either, so their uploads are marked processed
 * right away instead of starting a transcode that can only fail.
 */
export function getProxyType(
  mediaType?: string | null,
  filename?: string | null,
): ProxyType | null {
  const lowerMediaType = normalizeMediaType(mediaType)
  const lowerFilename = filename?.toLowerCase() || ''

  if (isUndecodableImage(filename)) return null
  if (lowerMediaType.startsWith('image/') || lowerFilename.endsWith('.psd')) return 'image'
  if (lowerMediaType.startsWith('video/')) return 'video'
  if (lowerMediaType.startsWith('audio/')) return 'audio'

  if (isCodeOrConfigDocument(mediaType, filename)) return null

  if (
    lowerMediaType === 'application/pdf' ||
    lowerFilename.endsWith('.pdf') ||
    isTxtDocument(mediaType, filename) ||
    isCsvDocument(mediaType, filename) ||
    isMarkdownDocument(mediaType, filename) ||
    isHtmlDocument(mediaType, filename) ||
    isOfficeDocument(mediaType, filename)
  ) {
    return 'pdf'
  }

  return null
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

export function detectSupportedMimeType(buffer: Uint8Array): string | null {
  if (startsWithAscii(buffer, 0, '8BPS')) {
    return 'image/vnd.adobe.photoshop'
  }
  if (startsWith(buffer, [0xff, 0xd8, 0xff])) {
    return buffer[3] === 0xf7 ? null : 'image/jpeg'
  }
  if (startsWith(buffer, PNG_SIGNATURE)) {
    return isPng(buffer) && !isAnimatedPng(buffer) ? 'image/png' : null
  }
  if (startsWithAscii(buffer, 0, 'GIF')) {
    return 'image/gif'
  }
  if (startsWithAscii(buffer, 0, 'RIFF') && startsWithAscii(buffer, 8, 'WEBP')) {
    return 'image/webp'
  }
  if (startsWithAscii(buffer, 4, 'ftyp')) {
    return 'video/mp4'
  }
  return null
}

function isPng(buffer: Uint8Array): boolean {
  return (
    buffer.length >= 16 &&
    readUint32Be(buffer, PNG_SIGNATURE.length) === 13 &&
    startsWithAscii(buffer, 12, 'IHDR')
  )
}

function isAnimatedPng(buffer: Uint8Array): boolean {
  let offset = PNG_SIGNATURE.length
  while (offset + 8 <= buffer.length) {
    const chunkLength = readUint32Be(buffer, offset)
    const chunkTypeOffset = offset + 4
    if (startsWithAscii(buffer, chunkTypeOffset, 'acTL')) return true
    if (startsWithAscii(buffer, chunkTypeOffset, 'IDAT')) return false

    const nextOffset = offset + 8 + chunkLength + 4
    if (nextOffset <= offset || nextOffset > buffer.length) return false
    offset = nextOffset
  }
  return false
}

function readUint32Be(buffer: Uint8Array, offset: number): number {
  return (
    (buffer[offset] ?? 0) * 0x1000000 +
    ((buffer[offset + 1] ?? 0) << 16) +
    ((buffer[offset + 2] ?? 0) << 8) +
    (buffer[offset + 3] ?? 0)
  )
}

function startsWith(buffer: Uint8Array, bytes: number[]): boolean {
  if (buffer.length < bytes.length) return false
  return bytes.every((byte, index) => buffer[index] === byte)
}

function startsWithAscii(buffer: Uint8Array, offset: number, text: string): boolean {
  if (buffer.length < offset + text.length) return false
  for (let index = 0; index < text.length; index++) {
    if (buffer[offset + index] !== text.charCodeAt(index)) return false
  }
  return true
}
