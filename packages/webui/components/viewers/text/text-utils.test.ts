import { describe, expect, it } from 'vitest'
import type { AssetInfo } from '@shumai/dtos'
import { clampLine, findBlockLine, isMarkdownFile, splitTextLines } from './text-utils'

describe('splitTextLines', () => {
  it('matches the backend line model', () => {
    expect(splitTextLines('')).toEqual([])
    expect(splitTextLines('a')).toEqual(['a'])
    expect(splitTextLines('a\nb\n')).toEqual(['a', 'b'])
    expect(splitTextLines('a\n\nb')).toEqual(['a', '', 'b'])
    expect(splitTextLines('\n')).toEqual([''])
  })
})

describe('clampLine', () => {
  it('rounds and clamps positions to the document', () => {
    expect(clampLine(2.6, 10)).toBe(3)
    expect(clampLine(0, 10)).toBe(1)
    expect(clampLine(-4, 10)).toBe(1)
    expect(clampLine(42, 10)).toBe(10)
    expect(clampLine(Number.NaN, 10)).toBe(1)
    expect(clampLine(5, 0)).toBe(1)
  })
})

describe('findBlockLine', () => {
  it('returns the last block starting at or before the line', () => {
    const blocks = [1, 3, 6, 7]
    expect(findBlockLine(blocks, 1)).toBe(1)
    expect(findBlockLine(blocks, 2)).toBe(1)
    expect(findBlockLine(blocks, 5)).toBe(3)
    expect(findBlockLine(blocks, 7)).toBe(7)
    expect(findBlockLine(blocks, 100)).toBe(7)
  })

  it('falls back to the first block for lines before it and handles no blocks', () => {
    expect(findBlockLine([4, 8], 2)).toBe(4)
    expect(findBlockLine([], 3)).toBeUndefined()
  })
})

describe('isMarkdownFile', () => {
  const file = (name: string, format?: 'markdown' | 'plain') =>
    ({ name, media: format ? { textTranscode: { url: 'u', format } } : undefined }) as AssetInfo

  it('prefers the format recorded by the transcode worker', () => {
    expect(isMarkdownFile(file('README', 'markdown'))).toBe(true)
    expect(isMarkdownFile(file('notes.md', 'plain'))).toBe(false)
  })

  it('falls back to the file extension', () => {
    expect(isMarkdownFile(file('notes.MD'))).toBe(true)
    expect(isMarkdownFile(file('doc.markdown'))).toBe(true)
    expect(isMarkdownFile(file('notes.txt'))).toBe(false)
  })
})
