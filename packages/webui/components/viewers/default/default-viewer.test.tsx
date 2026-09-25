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
})
