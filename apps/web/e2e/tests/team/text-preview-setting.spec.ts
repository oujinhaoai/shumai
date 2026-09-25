import { expect, test } from '../../fixtures'

test('owner switches text file preview to original text in transcode settings', async ({
  owner,
  prisma,
}) => {
  const { page, teamId } = owner

  await page.goto(`/teams/${teamId}/settings#transcode`)

  const pdfOption = page.getByTestId('text-preview-mode-pdf')
  const rawOption = page.getByTestId('text-preview-mode-raw')
  await expect(pdfOption).toHaveAttribute('aria-pressed', 'true')
  await expect(rawOption).toHaveAttribute('aria-pressed', 'false')

  await rawOption.click()
  await expect(rawOption).toHaveAttribute('aria-pressed', 'true')

  await expect
    .poll(async () => {
      const team = await prisma.team.findUnique({ where: { id: teamId } })
      const settings = team?.settings as { transcode?: { textPreviewMode?: string } } | null
      return settings?.transcode?.textPreviewMode
    })
    .toBe('raw')

  // The choice persists across reloads
  await page.reload()
  await expect(page.getByTestId('text-preview-mode-raw')).toHaveAttribute('aria-pressed', 'true')
})
