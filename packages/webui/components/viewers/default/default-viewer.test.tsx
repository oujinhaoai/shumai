// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { m } from '@/ui/paraglide/messages.js'
import { setLocale } from '@/ui/paraglide/runtime.js'
import type { AssetInfo } from '@shumai/dtos'
import { DefaultViewer } from './default-viewer'

const file = {
  id: 'file-1',
  name: 'archive.zip',
  media: { original: { key: 'files/archive.zip' } },
} as AssetInfo

describe('DefaultViewer', () => {
  afterEach(() => {
    cleanup()
    setLocale('en', { reload: false })
  })

  it.each(['en', 'zh'] as const)(
    'renders the placeholder and download button in the active locale (%s)',
    (locale) => {
      setLocale(locale, { reload: false })
      render(<DefaultViewer file={file} />)

      expect(screen.getByText(m.preview_unavailable({}, { locale }))).toBeDefined()
      const downloadButton = screen.getByRole('button', { name: m.download({}, { locale }) })
      expect(downloadButton.getAttribute('title')).toBe(m.download_original_file({}, { locale }))
    },
  )

  const reason = 'Failed to get media info: Input file contains unsupported image format'
  const failedFile = {
    id: 'file-2',
    name: 'render.exr',
    media: {
      original: { key: 'files/render.exr' },
      transcodeError: {
        taskType: 'transcode_image',
        message: reason,
        failedAt: '2026-09-25T08:00:00.000Z',
      },
    },
  } as AssetInfo

  it.each(['en', 'zh'] as const)(
    'adds one line with the failure reason under the placeholder when the transcode failed (%s)',
    (locale) => {
      setLocale(locale, { reload: false })
      render(<DefaultViewer file={failedFile} />)

      expect(screen.getByText(m.preview_unavailable({}, { locale }))).toBeDefined()
      const line = screen.getByText(m.preview_transcode_failed_reason({ reason }, { locale }))
      expect(line.tagName).toBe('P')
      expect(line.className).toContain('truncate')
      expect(line.getAttribute('title')).toBe(reason)
    },
  )

  it('renders the reason in English and Chinese', () => {
    render(<DefaultViewer file={failedFile} />)
    expect(screen.getByText(`Transcoding failed: ${reason}`)).toBeDefined()
    cleanup()

    setLocale('zh', { reload: false })
    render(<DefaultViewer file={failedFile} />)
    expect(screen.getByText(`转码失败：${reason}`)).toBeDefined()
  })

  it('shows no failure line for files that simply have no preview', () => {
    render(<DefaultViewer file={file} />)

    expect(screen.getByText(m.preview_unavailable())).toBeDefined()
    expect(screen.queryByText(/Transcoding failed/)).toBeNull()
  })
})
