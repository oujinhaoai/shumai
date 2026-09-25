// @vitest-environment happy-dom
import { cleanup, render, screen } from '@testing-library/react'
import React from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import { FilePreview } from './file-preview'

describe('FilePreview', () => {
  afterEach(() => {
    cleanup()
  })

  it('shows a document icon for raw text previews without a thumbnail', () => {
    render(
      <FilePreview item={{ type: 'file', proxyType: 'text', preview: { proxyType: 'text' } }} />,
    )

    expect(screen.getByTestId('text-file-icon')).toBeTruthy()
  })

  it('keeps the generic file icon for files without a proxy', () => {
    render(<FilePreview item={{ type: 'file', proxyType: null }} />)

    expect(screen.queryByTestId('text-file-icon')).toBeNull()
  })
})
