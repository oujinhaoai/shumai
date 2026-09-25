import type { AssetInfo } from '@shumai/dtos'

/** Markdown longer than this (in characters) is shown as plain lines to keep rendering fast. */
export const MAX_MARKDOWN_RENDER_CHARS = 512 * 1024

/**
 * Whether the text proxy should be rendered as Markdown. Prefers the format the
 * transcode worker recorded, falling back to the file extension.
 */
export function isMarkdownFile(file: Pick<AssetInfo, 'name' | 'media'>): boolean {
  const format = file.media?.textTranscode?.format
  if (format) return format === 'markdown'
  const name = file.name.toLowerCase()
  return name.endsWith('.md') || name.endsWith('.markdown')
}

/**
 * Splits the text proxy into display lines. A trailing line break does not start
 * an extra empty line. Mirrors `splitTextLines` in `@shumai/core/src/utils/text-file`,
 * which the transcode worker and the agent use, so line numbers match everywhere.
 */
export function splitTextLines(text: string): string[] {
  if (text === '') return []
  const lines = text.split('\n')
  if (lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** Clamps a comment position (stored in the comment's `second` field) to a 1-based line. */
export function clampLine(line: number, lineCount: number): number {
  if (!Number.isFinite(line)) return 1
  return Math.max(1, Math.min(Math.max(lineCount, 1), Math.round(line)))
}

/**
 * Finds the rendered block that contains `line`: the last block starting at or
 * before it. `blockLines` must be sorted ascending. Returns undefined when empty.
 */
export function findBlockLine(blockLines: number[], line: number): number | undefined {
  let found: number | undefined
  let low = 0
  let high = blockLines.length - 1
  while (low <= high) {
    const mid = (low + high) >> 1
    if (blockLines[mid] <= line) {
      found = blockLines[mid]
      low = mid + 1
    } else {
      high = mid - 1
    }
  }
  return found ?? blockLines[0]
}
