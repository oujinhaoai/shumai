import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { m } from '@/ui/paraglide/messages.js'

function readMessages(locale: 'en' | 'zh'): Record<string, string> {
  const file = fileURLToPath(new URL(`./${locale}.json`, import.meta.url))
  const messages: Record<string, string> = JSON.parse(readFileSync(file, 'utf-8'))
  delete messages.$schema
  return messages
}

describe('messages', () => {
  it('defines every message in both en.json and zh.json', () => {
    const en = readMessages('en')
    const zh = readMessages('zh')

    expect(Object.keys(zh).sort()).toEqual(Object.keys(en).sort())
    for (const [key, value] of Object.entries(zh)) {
      expect(value, key).not.toBe('')
    }
  })

  it.each(['en', 'zh'] as const)(
    'describes code and config file previews in the text preview setting (%s)',
    (locale) => {
      const description = m.text_preview_mode_description({}, { locale })
      for (const ext of ['.md', '.txt', '.json', '.yaml', '.py', '.log']) {
        expect(description).toContain(ext)
      }
      expect(m.text_preview_mode_pdf_description({}, { locale })).not.toBe('')
      expect(m.text_preview_mode_raw_description({}, { locale })).not.toBe('')
    },
  )

  it('translates the text preview setting into Chinese', () => {
    for (const message of [
      m.text_preview_mode_description,
      m.text_preview_mode_pdf_description,
      m.text_preview_mode_raw_description,
    ]) {
      expect(message({}, { locale: 'zh' })).not.toBe(message({}, { locale: 'en' }))
    }
    expect(m.text_preview_mode_description({}, { locale: 'zh' })).toContain('代码和配置文件')
    expect(m.text_preview_mode_raw_description({}, { locale: 'zh' })).toContain('行号')
  })
})
