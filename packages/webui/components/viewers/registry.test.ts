import { describe, expect, it, vi } from 'vitest'
import type { AssetInfo } from '@shumai/dtos'
import { getViewerForFile, hidesAnnotationControl } from './registry'

vi.mock('@/ui/paraglide/messages.js', () => ({
  m: new Proxy({}, { get: () => () => '' }),
}))

describe('viewer registry', () => {
  it('uses the text viewer with line-anchored comments for raw text previews', () => {
    const def = getViewerForFile({ id: 'a', name: 'notes.md', proxyType: 'text' } as AssetInfo)

    expect(def.id).toBe('text')
    expect(def.commentsConfig).toMatchObject({ hasTimestamp: true, hasAnnotations: false })
    expect(def.commentsConfig?.formatTimestamp?.(12)).toBe('L12')
  })

  it.each(['settings.json', 'config.yaml', 'tool.py', 'server.log', 'captions.srt'])(
    'opens %s with a text proxy in the text viewer with line comments and no drawing',
    (name) => {
      const file = { id: 'a', name, proxyType: 'text' } as AssetInfo
      const def = getViewerForFile(file)

      expect(def.id).toBe('text')
      expect(def.commentsConfig).toMatchObject({ hasTimestamp: true, hasAnnotations: false })
      expect(def.commentsConfig?.formatTimestamp?.(7)).toBe('L7')
      expect(hidesAnnotationControl(file)).toBe(true)
    },
  )

  it('keeps the PDF viewer for PDF proxies', () => {
    expect(getViewerForFile({ id: 'a', name: 'notes.md', proxyType: 'pdf' } as AssetInfo).id).toBe(
      'pdf',
    )
  })

  it('hides the drawing tool for audio and raw text previews only', () => {
    expect(hidesAnnotationControl({ proxyType: 'audio' })).toBe(true)
    expect(hidesAnnotationControl({ proxyType: 'text' })).toBe(true)
    expect(hidesAnnotationControl({ proxyType: 'pdf' })).toBe(false)
    expect(hidesAnnotationControl({ proxyType: 'image' })).toBe(false)
    expect(hidesAnnotationControl(null)).toBe(false)
  })

  it('shows files whose transcode failed in the default viewer, whatever their proxy type', () => {
    const transcodeError = {
      taskType: 'transcode_video',
      message: 'Video transcoding failed: ffmpeg exited with code 1',
      failedAt: '2026-09-25T08:00:00.000Z',
    }
    for (const proxyType of ['image', 'video', 'audio', 'pdf', 'text', null] as const) {
      const file = { id: 'a', name: 'clip.mov', proxyType, media: { transcodeError } } as AssetInfo
      expect(getViewerForFile(file).id, String(proxyType)).toBe('default')
    }
  })

  it('keeps the regular viewers for files without a transcode failure', () => {
    const video = { id: 'a', name: 'clip.mov', proxyType: 'video', media: {} } as AssetInfo
    const image = { id: 'b', name: 'photo.png', proxyType: 'image' } as AssetInfo
    expect(getViewerForFile(video).id).toBe('video')
    expect(getViewerForFile(image).id).toBe('image')
  })
})
