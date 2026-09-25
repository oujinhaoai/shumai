// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import React from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AssetInfo } from '@shumai/dtos'
import type { MediaController } from '../types'
import TextViewer from './text-viewer'

const scrollToIndexMock = vi.fn()

vi.mock('@tanstack/react-virtual', () => ({
  useVirtualizer: (options: { count: number }) => ({
    getVirtualItems: () =>
      Array.from({ length: options.count }, (_, i) => ({
        index: i,
        start: i * 24,
        size: 24,
        key: i,
      })),
    getTotalSize: () => options.count * 24,
    measureElement: () => {},
    scrollToIndex: scrollToIndexMock,
    range: options.count > 0 ? { startIndex: 0, endIndex: options.count - 1 } : null,
  }),
}))

vi.mock('@/ui/paraglide/messages.js', () => ({
  m: new Proxy(
    {},
    {
      get: (_target, key) => (args?: Record<string, unknown>) =>
        args ? `${String(key)} ${JSON.stringify(args)}` : String(key),
    },
  ),
}))

function makeFile(overrides: Partial<AssetInfo> = {}, textTranscode = {}): AssetInfo {
  return {
    id: 'file-1',
    name: 'notes.txt',
    proxyType: 'text',
    media: {
      original: { key: 'files/file-1/notes.txt' },
      textTranscode: {
        url: 'https://storage.example.com/files/file-1/proxy.txt',
        key: 'files/file-1/proxy.txt',
        format: 'plain',
        ...textTranscode,
      },
    },
    ...overrides,
  } as unknown as AssetInfo
}

function renderViewer(
  file: AssetInfo,
  props: Partial<React.ComponentProps<typeof TextViewer>> = {},
) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const ref = React.createRef<MediaController>()
  const onTimeUpdate = vi.fn()
  const onPlay = vi.fn()
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <TextViewer ref={ref} file={file} onTimeUpdate={onTimeUpdate} onPlay={onPlay} {...props} />
    </QueryClientProvider>,
  )
  return { ...utils, ref, onTimeUpdate, onPlay }
}

function mockFetchText(text: string, ok = true) {
  const fetchMock = vi.fn(async () => new Response(text, { status: ok ? 200 : 500 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('TextViewer', () => {
  beforeEach(() => {
    scrollToIndexMock.mockClear()
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
  })

  describe('plain text', () => {
    it('renders every line with its line number and reports line 1', async () => {
      const fetchMock = mockFetchText('first\n\nthird\n')
      const { onTimeUpdate } = renderViewer(makeFile())

      await screen.findByText('first')
      expect(fetchMock).toHaveBeenCalledWith('https://storage.example.com/files/file-1/proxy.txt')

      const rows = document.querySelectorAll('[data-testid="text-viewer-lines"] [data-line]')
      expect(Array.from(rows).map((r) => r.getAttribute('data-line'))).toEqual(['1', '2', '3'])
      expect(rows[2].textContent).toBe('3third')
      expect(screen.getByTestId('text-viewer-line-indicator').textContent).toContain(
        'line_of_lines {"current":1,"total":3}',
      )
      expect(onTimeUpdate).toHaveBeenLastCalledWith(1)
    })

    it('selects a clicked line so new comments attach to it', async () => {
      mockFetchText('a\nb\nc')
      const { onTimeUpdate, onPlay } = renderViewer(makeFile())
      await screen.findByText('b')

      fireEvent.click(screen.getByText('b'))

      const row = document.querySelector('[data-line="2"]')
      expect(row?.getAttribute('data-active')).toBe('true')
      expect(onTimeUpdate).toHaveBeenLastCalledWith(2)
      expect(onPlay).toHaveBeenCalled()
    })

    it('scrolls to and highlights the line a comment points at', async () => {
      mockFetchText('a\nb\nc\nd')
      const { ref, onTimeUpdate, onPlay } = renderViewer(makeFile())
      await screen.findByText('d')

      act(() => ref.current?.seekTo(3))

      expect(scrollToIndexMock).toHaveBeenCalledWith(2, { align: 'start' })
      expect(document.querySelector('[data-line="3"]')?.getAttribute('data-active')).toBe('true')
      expect(onTimeUpdate).toHaveBeenLastCalledWith(3)
      expect(onPlay).not.toHaveBeenCalled()
    })

    it('clamps positions outside the document to its lines', async () => {
      mockFetchText('a\nb')
      const { ref, onTimeUpdate } = renderViewer(makeFile())
      await screen.findByText('b')

      act(() => ref.current?.seekTo(99))

      expect(onTimeUpdate).toHaveBeenLastCalledWith(2)
      expect(document.querySelector('[data-line="2"]')?.getAttribute('data-active')).toBe('true')
    })

    it('applies a seek that arrives before the text has loaded', async () => {
      let resolveFetch: (res: Response) => void = () => {}
      vi.stubGlobal(
        'fetch',
        vi.fn(
          () =>
            new Promise<Response>((resolve) => {
              resolveFetch = resolve
            }),
        ),
      )
      const { ref, onTimeUpdate } = renderViewer(makeFile())

      act(() => ref.current?.seekTo(2))
      await act(async () => resolveFetch(new Response('a\nb\nc')))

      await waitFor(() =>
        expect(document.querySelector('[data-line="2"]')?.getAttribute('data-active')).toBe('true'),
      )
      expect(scrollToIndexMock).toHaveBeenCalledWith(1, { align: 'start' })
      expect(onTimeUpdate).toHaveBeenLastCalledWith(2)
    })

    it('starts at the line given by startTime', async () => {
      mockFetchText('a\nb\nc\nd\ne')
      const { onTimeUpdate } = renderViewer(makeFile(), { startTime: 4 })
      await screen.findByText('e')

      await waitFor(() =>
        expect(document.querySelector('[data-line="4"]')?.getAttribute('data-active')).toBe('true'),
      )
      expect(scrollToIndexMock).toHaveBeenCalledWith(3, { align: 'start' })
      expect(onTimeUpdate).toHaveBeenLastCalledWith(4)
    })

    it('resets the position when switching to another file', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) =>
          url.endsWith('b.txt') ? new Response('x\ny') : new Response('a\nb\nc'),
        ),
      )
      const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
      const onTimeUpdate = vi.fn()
      const fileA = makeFile({ id: 'file-a' }, { url: 'https://storage/a.txt', key: 'a' })
      const fileB = makeFile({ id: 'file-b' }, { url: 'https://storage/b.txt', key: 'b' })
      const { rerender } = render(
        <QueryClientProvider client={queryClient}>
          <TextViewer file={fileA} onTimeUpdate={onTimeUpdate} />
        </QueryClientProvider>,
      )
      await screen.findByText('c')
      fireEvent.click(screen.getByText('c'))
      expect(onTimeUpdate).toHaveBeenLastCalledWith(3)

      rerender(
        <QueryClientProvider client={queryClient}>
          <TextViewer file={fileB} onTimeUpdate={onTimeUpdate} />
        </QueryClientProvider>,
      )
      await screen.findByText('y')

      expect(onTimeUpdate).toHaveBeenLastCalledWith(1)
      expect(document.querySelector('[data-active="true"]')).toBeNull()
    })

    it('warns when the preview only holds the head of a large file', async () => {
      mockFetchText('a\nb')
      renderViewer(makeFile({}, { truncated: true }))

      expect(await screen.findByText('text_preview_truncated {"count":2}')).toBeTruthy()
    })

    it('shows an empty state for empty files', async () => {
      mockFetchText('')
      renderViewer(makeFile())

      expect(await screen.findByText('text_preview_empty')).toBeTruthy()
    })

    it('shows an error when the text proxy cannot be loaded', async () => {
      mockFetchText('nope', false)
      renderViewer(makeFile())

      // The viewer retries a failed load once before showing the error.
      expect(
        await screen.findByText('text_preview_load_failed', undefined, { timeout: 5000 }),
      ).toBeTruthy()
    })

    it('shows preview unavailable when there is no text proxy yet', () => {
      const fetchMock = mockFetchText('')
      renderViewer({ ...makeFile(), media: { original: { key: 'k' } } } as unknown as AssetInfo)

      expect(screen.getByText('preview_unavailable')).toBeTruthy()
      expect(fetchMock).not.toHaveBeenCalled()
    })
  })

  describe('markdown', () => {
    const markdown = [
      '# Title', // 1
      '', // 2
      'First paragraph', // 3
      'continues here.', // 4
      '', // 5
      '- item one', // 6
      '- item two', // 7
      '', // 8
      '<b>raw html</b>', // 9
      '', // 10
      '![diagram](./diagram.png)', // 11
      '', // 12
      '| a | b |', // 13
      '| - | - |', // 14
      '| 1 | 2 |', // 15
    ].join('\n')

    const markdownFile = () =>
      makeFile({ name: 'notes.md' }, { format: 'markdown', url: 'https://storage/proxy.txt' })

    it('renders Markdown blocks tagged with their source lines', async () => {
      mockFetchText(markdown)
      renderViewer(markdownFile())

      const heading = await screen.findByRole('heading', { name: 'Title' })
      expect(heading.getAttribute('data-line')).toBe('1')
      expect(screen.getByText(/First paragraph/).getAttribute('data-line')).toBe('3')
      expect(screen.getByText('item two').closest('li')?.getAttribute('data-line')).toBe('7')
      expect(document.querySelector('table tr[data-line="15"]')).toBeTruthy()
    })

    it('never renders raw HTML or loads images', async () => {
      mockFetchText(markdown)
      renderViewer(markdownFile())
      await screen.findByRole('heading', { name: 'Title' })

      expect(document.querySelector('[data-testid="text-viewer-markdown"] b')).toBeNull()
      expect(screen.getByText(/<b>raw html<\/b>/)).toBeTruthy()
      expect(document.querySelector('[data-testid="text-viewer-markdown"] img')).toBeNull()
      expect(screen.getByText('markdown_image_with_alt {"alt":"diagram"}')).toBeTruthy()
    })

    it('selects the clicked block and highlights the block a comment points at', async () => {
      mockFetchText(markdown)
      const { ref, onTimeUpdate } = renderViewer(markdownFile())
      await screen.findByRole('heading', { name: 'Title' })

      fireEvent.click(screen.getByText('item one'))
      expect(onTimeUpdate).toHaveBeenLastCalledWith(6)

      act(() => ref.current?.seekTo(4))
      await waitFor(() =>
        expect(screen.getByText(/First paragraph/).getAttribute('data-active')).toBe('true'),
      )
      expect(onTimeUpdate).toHaveBeenLastCalledWith(4)
    })

    it('switches to the source view with line numbers', async () => {
      mockFetchText(markdown)
      renderViewer(markdownFile())
      await screen.findByRole('heading', { name: 'Title' })

      fireEvent.click(screen.getByText('text_view_source'))

      expect(screen.queryByTestId('text-viewer-markdown')).toBeNull()
      expect(
        document.querySelector('[data-testid="text-viewer-lines"] [data-line="1"]')?.textContent,
      ).toBe('1# Title')
      expect(screen.getByText('text_view_rendered').getAttribute('aria-pressed')).toBe('false')
    })

    it('offers no view switch for plain text files', async () => {
      mockFetchText('plain')
      renderViewer(makeFile())
      await screen.findByText('plain')

      expect(screen.queryByText('text_view_source')).toBeNull()
    })
  })
})
