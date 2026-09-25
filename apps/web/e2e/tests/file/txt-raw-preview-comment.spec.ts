import { expect, test } from '../../fixtures'

test.use({ fileOptions: { mediaType: 'text', textPreviewMode: 'raw' } })

test('preview a txt file as original text and comment on a line', async ({ file, prisma }) => {
  const { page, projectId, fileId } = file
  const commentText = `Line comment ${Date.now()}`

  // The raw text preview stores a text proxy instead of converting to PDF
  await expect
    .poll(
      async () => {
        const asset = await prisma.asset.findUnique({ where: { id: fileId } })
        return asset?.status
      },
      { timeout: 60_000 },
    )
    .toBe('processed')
  const asset = await prisma.asset.findUnique({ where: { id: fileId } })
  const media = asset?.media as { proxyType?: string; pdfTranscode?: unknown } | null
  expect(media?.proxyType).toBe('text')
  expect(media?.pdfTranscode).toBeUndefined()

  await page.goto(`/projects/${projectId}/files/${fileId}`)

  const viewer = page.getByTestId('text-viewer')
  const secondLine = viewer.locator('[data-line="2"]')
  await expect(secondLine).toContainText('Second line of text content.', { timeout: 30_000 })

  // Raw text previews anchor comments to lines only, so there is no drawing tool
  await expect(page.getByTitle('Toggle Annotation')).toHaveCount(0)

  // Select line 2 and comment on it
  await secondLine.click()
  await expect(secondLine).toHaveAttribute('data-active', 'true')
  await expect(page.getByTestId('text-viewer-line-indicator')).toContainText('Line 2 of 2')

  const input = page.locator('[contenteditable="true"]').first()
  await input.fill(commentText)
  const sendBtn = page.locator('button:has(svg.lucide-arrow-up)').last()
  await sendBtn.click()

  await expect(page.getByText(commentText)).toBeVisible()
  await expect
    .poll(async () => {
      const comment = await prisma.assetComment.findFirst({
        where: { assetId: fileId, message: commentText },
      })
      return comment?.second
    })
    .toBe(2)

  // After a reload, selecting the comment jumps back to its line
  await page.reload()
  await expect(viewer.locator('[data-line="2"]')).toBeVisible({ timeout: 30_000 })
  await expect(viewer.locator('[data-line="2"]')).not.toHaveAttribute('data-active', 'true')
  const commentCard = page.getByText(commentText).first()
  await expect(commentCard).toBeVisible()
  await expect(page.getByText('L2', { exact: true }).first()).toBeVisible()
  await commentCard.click()
  await expect(viewer.locator('[data-line="2"]')).toHaveAttribute('data-active', 'true')
})
