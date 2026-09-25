import { Download } from 'lucide-react'
import { cn } from '@/ui/lib/utils'
import { m } from '@/ui/paraglide/messages.js'

export type TextViewMode = 'rendered' | 'source'

export interface TextControlBarProps {
  currentLine: number
  totalLines: number
  /** Only set for Markdown files, which can switch between rendered and source views. */
  viewMode?: TextViewMode
  onViewModeChange?: (mode: TextViewMode) => void
  onDownload: () => void
  canDownload: boolean
  /** When false, hides the download affordance. Defaults to true. */
  allowDownload?: boolean
}

export function TextControlBar({
  currentLine,
  totalLines,
  viewMode,
  onViewModeChange,
  onDownload,
  canDownload,
  allowDownload = true,
}: TextControlBarProps) {
  const viewModes: { mode: TextViewMode; label: string }[] = [
    { mode: 'rendered', label: m.text_view_rendered() },
    { mode: 'source', label: m.text_view_source() },
  ]

  return (
    <div className="relative px-2 py-2 sm:px-4 sm:py-3 bg-card border-t border-border z-10 flex items-center justify-between gap-1.5 sm:gap-2 transition-colors duration-200 shrink-0">
      <span
        data-testid="text-viewer-line-indicator"
        className="px-1 sm:px-2 text-xs font-mono font-medium text-foreground select-none whitespace-nowrap"
      >
        <span className="hidden sm:inline">
          {m.line_of_lines({ current: currentLine, total: totalLines || 1 })}
        </span>
        <span className="inline sm:hidden">
          {currentLine}/{totalLines || 1}
        </span>
      </span>

      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {viewMode && onViewModeChange && (
          <div className="flex items-center gap-0.5 bg-muted rounded-md p-0.5">
            {viewModes.map(({ mode, label }) => (
              <button
                key={mode}
                onClick={() => onViewModeChange(mode)}
                aria-pressed={viewMode === mode}
                className={cn(
                  'text-xs font-medium px-2 py-1 sm:px-3 sm:py-1.5 rounded transition-colors',
                  viewMode === mode
                    ? 'bg-background text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        {allowDownload && (
          <button
            onClick={onDownload}
            disabled={!canDownload}
            className="flex items-center gap-1 text-xs font-medium px-2 py-1 sm:px-3 sm:py-1.5 rounded bg-muted hover:bg-foreground/20 text-foreground transition-colors border border-transparent disabled:opacity-50"
            title={m.download_original_file()}
          >
            <Download size={14} />
            <span className="hidden sm:inline">{m.download()}</span>
          </button>
        )}
      </div>
    </div>
  )
}
