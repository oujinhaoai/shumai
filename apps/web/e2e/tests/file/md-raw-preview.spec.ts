import { expect, test } from '../../fixtures'

test.use({ fileOptions: { mediaType: 'markdown', textPreviewMode: 'raw' } })

test('preview a Markdown file rendered and as source with line numbers', async ({
  file,
  prisma,
}) => {
  const { page, projectId, fileId } = file

  await expect
    .poll(
      async () => {
        const asset = await prisma.asset.findUnique({ where: { id: fileId } })
        return asset?.status
      },
      { timeout: 60_000 },
    )
    .toBe('processed')

  await page.goto(`/projects/${projectId}/files/${fileId}`)

  // Rendered view: Markdown blocks carry their source line numbers
  const markdown = page.getByTestId('text-viewer-markdown')
  const heading = markdown.getByRole('heading', { name: 'Release Notes' })
  await expect(heading).toBeVisible({ timeout: 30_000 })
  await expect(heading).toHaveAttribute('data-line', '1')
  await expect(markdown.getByText('Second item')).toHaveAttribute('data-line', '6')

  // Clicking a block selects its first line for new comments
  await markdown.getByText('Intro paragraph for the raw text preview test.').click()
  await expect(page.getByTestId('text-viewer-line-indicator')).toContainText('Line 3 of 10')

  // Source view shows the original Markdown with line numbers
  await page.getByRole('button', { name: 'Source' }).click()
  const lines = page.getByTestId('text-viewer-lines')
  await expect(lines.locator('[data-line="1"]')).toContainText('# Release Notes')
  await expect(lines.locator('[data-line="8"]')).toContainText('```')
  await expect(markdown).toHaveCount(0)
})
