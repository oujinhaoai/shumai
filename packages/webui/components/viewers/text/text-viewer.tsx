import { client } from '@/ui/api/client'
import { ScrollArea } from '@/ui/components/ui/scroll-area'
import { cn } from '@/ui/lib/utils'
import { m } from '@/ui/paraglide/messages.js'
import { useQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import React, {
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import { FileViewerProps, MediaController } from '../types'
import { MarkdownContent } from './markdown-content'
import { TextControlBar, type TextViewMode } from './text-control-bar'
import {
  MAX_MARKDOWN_RENDER_CHARS,
  clampLine,
  findBlockLine,
  isMarkdownFile,
  splitTextLines,
} from './text-utils'

const LINE_HEIGHT_ESTIMATE = 24
/** Space kept above a block when scrolling it into view in the Markdown view. */
const SCROLL_MARGIN = 16

interface MarkdownBlocks {
  /** Blocks carrying a `data-line`, in document order. */
  elements: HTMLElement[]
  /** Distinct block start lines, ascending. */
  lines: number[]
  byLine: Map<number, HTMLElement>
}

const EMPTY_BLOCKS: MarkdownBlocks = { elements: [], lines: [], byLine: new Map() }

function collectMarkdownBlocks(container: HTMLElement | null): MarkdownBlocks {
  if (!container) return EMPTY_BLOCKS
  const elements = Array.from(container.querySelectorAll<HTMLElement>('[data-line]'))
  const byLine = new Map<number, HTMLElement>()
  for (const el of elements) {
    const line = Number(el.dataset.line)
    if (Number.isFinite(line) && !byLine.has(line)) byLine.set(line, el)
  }
  return { elements, lines: [...byLine.keys()].sort((a, b) => a - b), byLine }
}

function isElementVisible(el: HTMLElement, viewport: HTMLElement): boolean {
  const rect = el.getBoundingClientRect()
  const view = viewport.getBoundingClientRect()
  return rect.bottom > view.top && rect.top < view.bottom
}

/**
 * Previews Markdown and plain-text files from their UTF-8 text proxy. Comments
 * are anchored to 1-based source line numbers, stored in the comment's `second`
 * field the same way PDF comments store page numbers.
 */
export const TextViewer = React.forwardRef<MediaController, FileViewerProps>(
  ({ file, shareId, children, onPlay, onPause, onTimeUpdate, startTime, allowDownload }, ref) => {
    const proxy = file.media?.textTranscode
    const proxyUrl = proxy?.url

    // Keyed by the proxy's storage key: presigned URLs rotate on refetch, the content does not.
    const {
      data: text,
      isLoading,
      isError,
    } = useQuery({
      queryKey: ['text-proxy', file.id, proxy?.key ?? proxyUrl],
      queryFn: async () => {
        const res = await fetch(proxyUrl as string)
        if (!res.ok) throw new Error(`Failed to load text preview (${res.status})`)
        return res.text()
      },
      enabled: !!proxyUrl,
      staleTime: Infinity,
      retry: 1,
    })

    const lines = useMemo(() => splitTextLines(text ?? ''), [text])
    const totalLines = lines.length
    const isLoaded = text !== undefined

    const canRenderMarkdown =
      isMarkdownFile(file) && (text?.length ?? 0) <= MAX_MARKDOWN_RENDER_CHARS
    const [viewMode, setViewMode] = useState<TextViewMode>('rendered')
    const showMarkdown = canRenderMarkdown && viewMode === 'rendered'

    const initialLine =
      startTime !== undefined && Number.isFinite(startTime) && startTime > 0
        ? Math.round(startTime)
        : null
    /** The line new comments attach to: the selected line, else the first visible one. */
    const [currentLine, setCurrentLine] = useState(initialLine ?? 1)
    /** A clicked or sought line; stays highlighted until it is scrolled out of view. */
    const [selectedLine, setSelectedLine] = useState<number | null>(null)
    const selectedLineRef = useRef<number | null>(null)
    useEffect(() => {
      selectedLineRef.current = selectedLine
    }, [selectedLine])
    /**
     * Scroll to apply once the content has rendered: the initial position, a seek
     * that arrived while loading, or the current line after switching views.
     */
    const pendingScrollRef = useRef<{ line: number; select: boolean } | null>(
      initialLine !== null ? { line: initialLine, select: true } : null,
    )
    /** Set while a programmatic scroll is in flight so scroll tracking does not drop the selection. */
    const seekTargetRef = useRef<number | null>(null)

    // The viewer stays mounted when switching between text files, so reset the
    // per-file position and view when a different file is shown.
    const shownFileIdRef = useRef(file.id)
    useEffect(() => {
      if (shownFileIdRef.current === file.id) return
      shownFileIdRef.current = file.id
      seekTargetRef.current = null
      pendingScrollRef.current = { line: initialLine ?? 1, select: initialLine !== null }
      setSelectedLine(null)
      setCurrentLine(initialLine ?? 1)
      setViewMode('rendered')
    }, [file.id, initialLine])

    useEffect(() => {
      onTimeUpdate?.(currentLine)
    }, [currentLine, onTimeUpdate])

    const viewportRef = useRef<HTMLDivElement | null>(null)
    const markdownRef = useRef<HTMLDivElement | null>(null)
    const blocksRef = useRef<MarkdownBlocks>(EMPTY_BLOCKS)
    const [blocksVersion, setBlocksVersion] = useState(0)

    const virtualizer = useVirtualizer({
      count: isLoaded && !showMarkdown ? totalLines : 0,
      getScrollElement: () => viewportRef.current,
      estimateSize: () => LINE_HEIGHT_ESTIMATE,
      overscan: 20,
    })

    const scrollToLine = useCallback(
      (line: number) => {
        if (showMarkdown) {
          const blockLine = findBlockLine(blocksRef.current.lines, line)
          const el = blockLine !== undefined ? blocksRef.current.byLine.get(blockLine) : undefined
          const viewport = viewportRef.current
          if (el && viewport) {
            viewport.scrollTop +=
              el.getBoundingClientRect().top - viewport.getBoundingClientRect().top - SCROLL_MARGIN
          }
        } else if (totalLines > 0) {
          virtualizer.scrollToIndex(line - 1, { align: 'start' })
        }
      },
      [showMarkdown, totalLines, virtualizer],
    )

    const selectLine = useCallback(
      (line: number, { scroll }: { scroll: boolean }) => {
        if (!isLoaded) {
          pendingScrollRef.current = { line, select: true }
          return
        }
        const target = clampLine(line, totalLines)
        setSelectedLine(target)
        setCurrentLine(target)
        if (!scroll) return
        seekTargetRef.current = target
        scrollToLine(target)
      },
      [isLoaded, scrollToLine, totalLines],
    )

    useImperativeHandle(
      ref,
      () => ({
        play: () => onPlay?.(),
        pause: () => onPause?.(),
        seekTo: (second: number) => {
          if (!Number.isFinite(second)) return
          selectLine(second, { scroll: true })
        },
        getCurrentTime: () => currentLine,
        getDuration: () => totalLines,
      }),
      [currentLine, onPause, onPlay, selectLine, totalLines],
    )

    // Collect the rendered Markdown blocks after each render of the document; bumping
    // the version re-runs the scroll, highlight and tracking effects below.
    useLayoutEffect(() => {
      blocksRef.current = showMarkdown ? collectMarkdownBlocks(markdownRef.current) : EMPTY_BLOCKS
      setBlocksVersion((v) => v + 1)
    }, [showMarkdown, text])

    // Apply a pending scroll once the (re)rendered content is ready.
    useEffect(() => {
      const pending = pendingScrollRef.current
      if (!isLoaded || !pending) return
      pendingScrollRef.current = null
      const line = clampLine(pending.line, totalLines)
      if (pending.select) {
        setSelectedLine(line)
        setCurrentLine(line)
      }
      seekTargetRef.current = line
      scrollToLine(line)
    }, [blocksVersion, isLoaded, scrollToLine, totalLines])

    // Highlight the selected block in the Markdown view without re-rendering the document.
    useEffect(() => {
      if (!showMarkdown) return
      const { byLine, lines: blockLines } = blocksRef.current
      const blockLine = selectedLine !== null ? findBlockLine(blockLines, selectedLine) : undefined
      const active = blockLine !== undefined ? byLine.get(blockLine) : undefined
      active?.setAttribute('data-active', 'true')
      return () => active?.removeAttribute('data-active')
    }, [blocksVersion, selectedLine, showMarkdown])

    // Track the first visible line of the plain-text view.
    const range = virtualizer.range
    const firstVisibleIndex = range?.startIndex
    const lastVisibleIndex = range?.endIndex
    useEffect(() => {
      if (showMarkdown || firstVisibleIndex === undefined || lastVisibleIndex === undefined) return
      const firstVisible = firstVisibleIndex + 1
      const lastVisible = lastVisibleIndex + 1
      const isVisible = (line: number) => line >= firstVisible && line <= lastVisible
      if (seekTargetRef.current !== null) {
        if (isVisible(seekTargetRef.current)) seekTargetRef.current = null
        return
      }
      if (selectedLine !== null && isVisible(selectedLine)) return
      setSelectedLine(null)
      setCurrentLine(firstVisible)
    }, [firstVisibleIndex, lastVisibleIndex, selectedLine, showMarkdown])

    // Track the first visible block of the Markdown view.
    useEffect(() => {
      const viewport = viewportRef.current
      if (!showMarkdown || !viewport) return
      let frame = 0
      const update = () => {
        frame = 0
        const { elements, byLine, lines: blockLines } = blocksRef.current
        if (elements.length === 0) return
        const seekTarget = seekTargetRef.current
        if (seekTarget !== null) {
          const blockLine = findBlockLine(blockLines, seekTarget)
          const el = blockLine !== undefined ? byLine.get(blockLine) : undefined
          if (!el || isElementVisible(el, viewport)) seekTargetRef.current = null
          return
        }
        const viewTop = viewport.getBoundingClientRect().top
        let low = 0
        let high = elements.length - 1
        let first = elements.length - 1
        while (low <= high) {
          const mid = (low + high) >> 1
          if (elements[mid].getBoundingClientRect().bottom > viewTop + 1) {
            first = mid
            high = mid - 1
          } else {
            low = mid + 1
          }
        }
        const selected = selectedLineRef.current
        if (selected !== null) {
          const blockLine = findBlockLine(blockLines, selected)
          const el = blockLine !== undefined ? byLine.get(blockLine) : undefined
          if (el && isElementVisible(el, viewport)) return
        }
        setSelectedLine(null)
        setCurrentLine(Number(elements[first].dataset.line) || 1)
      }
      const onScroll = () => {
        if (!frame) frame = requestAnimationFrame(update)
      }
      viewport.addEventListener('scroll', onScroll, { passive: true })
      return () => {
        viewport.removeEventListener('scroll', onScroll)
        if (frame) cancelAnimationFrame(frame)
      }
    }, [showMarkdown, blocksVersion])

    const handleLineClick = (line: number) => {
      selectLine(line, { scroll: false })
      onPlay?.()
    }

    const handleMarkdownClick = (e: React.MouseEvent<HTMLDivElement>) => {
      const block = (e.target as HTMLElement).closest<HTMLElement>('[data-line]')
      if (!block || !markdownRef.current?.contains(block)) return
      const line = Number(block.dataset.line)
      if (Number.isFinite(line)) handleLineClick(line)
    }

    const handleViewModeChange = (mode: TextViewMode) => {
      if (mode === viewMode) return
      pendingScrollRef.current = { line: currentLine, select: false }
      setViewMode(mode)
    }

    const handleDownload = async () => {
      const key = file.media?.original?.key
      if (!key || !file.id) return
      try {
        const res = shareId
          ? await client.api.shares[':shareId'].files[':fileId']['download-url'].$post({
              param: { shareId, fileId: file.id },
              json: { key },
            })
          : await client.api.files['download-url'].$post({
              json: { key, assetId: file.id },
            })
        if (!res.ok) return
        const { url } = await res.json()
        const link = document.createElement('a')
        link.href = url
        link.download = file.name || 'document.txt'
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      } catch {
        // fail silently
      }
    }

    const gutterWidth = `${Math.max(String(totalLines).length, 2) + 2}ch`

    let content: React.ReactNode
    if (!proxyUrl) {
      content = <StatusMessage>{m.preview_unavailable()}</StatusMessage>
    } else if (isError) {
      content = <StatusMessage>{m.text_preview_load_failed()}</StatusMessage>
    } else if (isLoading || !isLoaded) {
      content = (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-8 h-8 border-4 border-muted border-t-primary rounded-full animate-spin" />
        </div>
      )
    } else if (totalLines === 0) {
      content = <StatusMessage>{m.text_preview_empty()}</StatusMessage>
    } else if (showMarkdown) {
      content = (
        <div
          ref={markdownRef}
          data-testid="text-viewer-markdown"
          className="mx-auto max-w-4xl px-4 py-4 sm:px-8 sm:py-6 cursor-text"
          onClick={handleMarkdownClick}
        >
          <MarkdownContent text={text} />
        </div>
      )
    } else {
      content = (
        <div
          data-testid="text-viewer-lines"
          className="relative w-full py-2"
          style={{ height: virtualizer.getTotalSize() }}
        >
          {virtualizer.getVirtualItems().map((item) => {
            const lineNumber = item.index + 1
            const isActive = lineNumber === selectedLine
            return (
              <div
                key={item.key}
                data-index={item.index}
                data-line={lineNumber}
                data-active={isActive}
                ref={virtualizer.measureElement}
                onClick={() => handleLineClick(lineNumber)}
                className={cn(
                  'absolute left-0 top-0 flex w-full cursor-pointer font-mono text-[13px] leading-6 transition-colors hover:bg-muted/60',
                  isActive && 'bg-primary/10 hover:bg-primary/15',
                )}
                style={{ transform: `translateY(${item.start}px)` }}
              >
                <span
                  className="shrink-0 select-none pr-3 text-right text-muted-foreground tabular-nums"
                  style={{ width: gutterWidth }}
                >
                  {lineNumber}
                </span>
                <span className="min-w-0 flex-1 whitespace-pre-wrap break-words pr-4 text-foreground">
                  {lines[item.index] || ' '}
                </span>
              </div>
            )
          })}
        </div>
      )
    }

    return (
      <div
        data-testid="text-viewer"
        className="flex flex-col flex-1 h-full overflow-hidden bg-background relative"
      >
        <div className="flex-1 flex flex-col-reverse md:flex-row min-h-0 relative">
          {children}
          <div className="flex-1 min-w-0 min-h-0 flex flex-col relative">
            {proxy?.truncated && isLoaded && (
              <div className="shrink-0 border-b border-border bg-muted px-4 py-2 text-xs text-muted-foreground">
                {m.text_preview_truncated({ count: totalLines })}
              </div>
            )}
            <ScrollArea className="flex-1 min-h-0 [&>div>div]:block!" viewportRef={viewportRef}>
              {content}
            </ScrollArea>
          </div>
        </div>
        <TextControlBar
          currentLine={clampLine(currentLine, totalLines)}
          totalLines={totalLines}
          viewMode={canRenderMarkdown ? viewMode : undefined}
          onViewModeChange={canRenderMarkdown ? handleViewModeChange : undefined}
          onDownload={handleDownload}
          canDownload={!!file.media?.original?.key}
          allowDownload={allowDownload}
        />
      </div>
    )
  },
)

function StatusMessage({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center px-4 text-center text-sm text-muted-foreground">
      {children}
    </div>
  )
}

export default TextViewer
