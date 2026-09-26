import { describe, it, expect } from 'vitest'
import { AssetStatus, prisma, WorkflowTaskStatus, WorkflowTaskType } from '@shumai/db'
import { setupTestDbHooks } from '@shumai/db/test'
import {
  TRANSCODE_ERROR_MESSAGE_MAX_LENGTH,
  buildTranscodeError,
  transcodeFailureService,
  truncateTranscodeErrorMessage,
  withTranscodeError,
} from './transcode-failure'

async function createAsset(
  status: AssetStatus,
  options: { media?: PrismaJson.MediaInfo; isDeleted?: boolean; name?: string } = {},
) {
  const team = await prisma.team.create({ data: { name: 'Transcode Failure Team' } })
  const project = await prisma.project.create({
    data: { name: 'Transcode Failure Project', teamId: team.id },
  })
  const name = options.name ?? 'render.exr'
  const storageKey = await prisma.storageKey.create({ data: { key: `projects/tf/${name}` } })
  return prisma.asset.create({
    data: {
      name,
      type: 'file',
      status,
      mediaType: 'image/aces',
      projectId: project.id,
      storageKeyId: storageKey.id,
      isDeleted: options.isDeleted ?? false,
      ...(options.media ? { media: options.media } : {}),
    },
  })
}

async function createTask(
  assetId: string,
  type: WorkflowTaskType,
  status: WorkflowTaskStatus,
  output?: Record<string, unknown>,
) {
  return prisma.workflowTask.create({
    data: { assetId, type, status, ...(output ? { output } : {}) },
  })
}

const videoMediaWithPoster: PrismaJson.MediaInfo = {
  duration: 12,
  filesize: 0,
  frames: 288,
  proxyType: 'video',
  imageTranscodes: [],
  videoTranscodes: [],
  poster: { key: 'projects/tf/poster.webp' },
  finishedAt: '2026-09-25T00:00:00.000Z',
  metadata: null,
  original: { key: 'projects/tf/clip.mov', filesizeInBytes: 0, codec: '' },
}

describe('transcode failure helpers', () => {
  it('keeps short messages and cuts long ones to 500 characters', () => {
    expect(truncateTranscodeErrorMessage('Input file contains unsupported image format')).toBe(
      'Input file contains unsupported image format',
    )
    const long = 'x'.repeat(TRANSCODE_ERROR_MESSAGE_MAX_LENGTH + 250)
    expect(truncateTranscodeErrorMessage(long)).toBe('x'.repeat(500))
  })

  it('does not split a surrogate pair and drops NUL characters', () => {
    const emojiAtCut = `${'a'.repeat(TRANSCODE_ERROR_MESSAGE_MAX_LENGTH - 1)}😀tail`
    const cut = truncateTranscodeErrorMessage(emojiAtCut)
    expect(cut).toBe('a'.repeat(TRANSCODE_ERROR_MESSAGE_MAX_LENGTH - 1))
    expect(cut.length).toBeLessThanOrEqual(TRANSCODE_ERROR_MESSAGE_MAX_LENGTH)
    expect(truncateTranscodeErrorMessage('bad\u0000byte')).toBe('badbyte')
  })

  it('builds the transcode error with an ISO timestamp and a fallback message', () => {
    const failedAt = new Date('2026-09-25T08:00:00.000Z')
    expect(buildTranscodeError('transcode_image', 'boom', failedAt)).toEqual({
      taskType: 'transcode_image',
      message: 'boom',
      failedAt: '2026-09-25T08:00:00.000Z',
    })
    expect(buildTranscodeError('transcode_image', '', failedAt).message).toBe('Transcode failed')
  })

  it('keeps existing media fields when recording a failure', () => {
    const transcodeError = buildTranscodeError('transcode_video', 'boom', new Date())
    expect(withTranscodeError(videoMediaWithPoster, transcodeError)).toEqual({
      ...videoMediaWithPoster,
      transcodeError,
    })
    expect(withTranscodeError(null, transcodeError)).toMatchObject({
      imageTranscodes: [],
      videoTranscodes: [],
      metadata: null,
      original: null,
      transcodeError,
    })
  })
})

describe('TranscodeFailureService', () => {
  setupTestDbHooks()

  describe('markAssetTranscodeFailed', () => {
    it('marks a processing asset processed and records the failure', async () => {
      const asset = await createAsset(AssetStatus.processing)
      const failedAt = new Date('2026-09-25T08:30:00.000Z')

      const updated = await transcodeFailureService.markAssetTranscodeFailed({
        assetId: asset.id,
        taskType: 'transcode_image',
        message: 'Failed to get media info: Input file contains unsupported image format',
        failedAt,
      })

      expect(updated).toBe(true)
      const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
      expect(after.status).toBe(AssetStatus.processed)
      expect(after.media?.proxyType).toBeUndefined()
      expect(after.media?.transcodeError).toEqual({
        taskType: 'transcode_image',
        message: 'Failed to get media info: Input file contains unsupported image format',
        failedAt: '2026-09-25T08:30:00.000Z',
      })
    })

    it('keeps what the failed run already stored, such as a video poster', async () => {
      const asset = await createAsset(AssetStatus.processing, {
        media: videoMediaWithPoster,
        name: 'clip.mov',
      })

      await transcodeFailureService.markAssetTranscodeFailed({
        assetId: asset.id,
        taskType: 'transcode_video',
        message: 'Failed to transcode video',
      })

      const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
      expect(after.status).toBe(AssetStatus.processed)
      expect(after.media).toMatchObject({
        proxyType: 'video',
        poster: { key: 'projects/tf/poster.webp' },
        transcodeError: { taskType: 'transcode_video', message: 'Failed to transcode video' },
      })
      expect(Date.parse(after.media?.transcodeError?.failedAt ?? '')).not.toBeNaN()
    })

    it('stores at most 500 characters of the failure reason', async () => {
      const asset = await createAsset(AssetStatus.processing)

      await transcodeFailureService.markAssetTranscodeFailed({
        assetId: asset.id,
        taskType: 'transcode_pdf',
        message: 'e'.repeat(2000),
      })

      const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
      expect(after.media?.transcodeError?.message).toBe('e'.repeat(500))
    })

    it.each([
      ['trashed', AssetStatus.trashed, true],
      ['pending_purge', AssetStatus.pending_purge, true],
      ['processed', AssetStatus.processed, false],
      ['uploaded', AssetStatus.uploaded, false],
    ] as const)('leaves a %s asset unchanged', async (_label, status, isDeleted) => {
      const asset = await createAsset(status, { isDeleted })

      const updated = await transcodeFailureService.markAssetTranscodeFailed({
        assetId: asset.id,
        taskType: 'transcode_image',
        message: 'boom',
      })

      expect(updated).toBe(false)
      const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
      expect(after.status).toBe(status)
      expect(after.isDeleted).toBe(isDeleted)
      expect(after.media).toBeNull()
    })

    it('still finishes a processing asset inside a trashed folder so it is not stuck after a restore', async () => {
      // Trashing a folder only flags its files isDeleted; their status stays processing.
      const asset = await createAsset(AssetStatus.processing, { isDeleted: true })

      const updated = await transcodeFailureService.markAssetTranscodeFailed({
        assetId: asset.id,
        taskType: 'transcode_image',
        message: 'boom',
      })

      expect(updated).toBe(true)
      const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
      expect(after.status).toBe(AssetStatus.processed)
      expect(after.isDeleted).toBe(true)
      expect(after.media?.transcodeError?.message).toBe('boom')
    })

    it('returns false for an asset that no longer exists', async () => {
      await expect(
        transcodeFailureService.markAssetTranscodeFailed({
          assetId: 'missing-asset',
          taskType: 'transcode_image',
          message: 'boom',
        }),
      ).resolves.toBe(false)
    })
  })

  describe('clearTranscodeError', () => {
    it('removes a recorded failure and keeps the rest of the media', async () => {
      const transcodeError = buildTranscodeError('transcode_video', 'old failure', new Date())
      const asset = await createAsset(AssetStatus.processing, {
        media: { ...videoMediaWithPoster, transcodeError },
        name: 'clip.mov',
      })

      await transcodeFailureService.clearTranscodeError(asset.id)

      const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
      expect(after.media).toEqual(videoMediaWithPoster)
      expect(after.status).toBe(AssetStatus.processing)
    })

    it('leaves assets without a recorded failure untouched', async () => {
      const asset = await createAsset(AssetStatus.processing)

      await transcodeFailureService.clearTranscodeError(asset.id)
      await transcodeFailureService.clearTranscodeError('missing-asset')

      const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
      expect(after.media).toBeNull()
    })
  })

  describe('recoverAssetsStuckAfterFailedTranscode', () => {
    it('repairs a processing asset whose latest transcode task failed, and is idempotent', async () => {
      const asset = await createAsset(AssetStatus.processing)
      const task = await createTask(
        asset.id,
        WorkflowTaskType.transcode_image,
        WorkflowTaskStatus.failed,
        { error: 'Failed to get media info: Input file contains unsupported image format' },
      )

      expect(await transcodeFailureService.recoverAssetsStuckAfterFailedTranscode()).toBe(1)

      const repaired = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
      expect(repaired.status).toBe(AssetStatus.processed)
      expect(repaired.media?.transcodeError).toEqual({
        taskType: 'transcode_image',
        message: 'Failed to get media info: Input file contains unsupported image format',
        failedAt: task.updatedAt.toISOString(),
      })

      // A second run finds nothing to do and leaves the repaired asset as it was.
      expect(await transcodeFailureService.recoverAssetsStuckAfterFailedTranscode()).toBe(0)
      const again = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
      expect(again.status).toBe(AssetStatus.processed)
      expect(again.media).toEqual(repaired.media)
      expect(again.updatedAt).toEqual(repaired.updatedAt)
    })

    it('uses a generic reason when the failed task recorded none', async () => {
      const asset = await createAsset(AssetStatus.processing, { name: 'clip.mov' })
      await createTask(asset.id, WorkflowTaskType.transcode_video, WorkflowTaskStatus.failed)

      expect(await transcodeFailureService.recoverAssetsStuckAfterFailedTranscode()).toBe(1)

      const repaired = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
      expect(repaired.media?.transcodeError).toMatchObject({
        taskType: 'transcode_video',
        message: 'Transcode failed',
      })
    })

    it('leaves assets whose latest transcode task is still pending, running or completed', async () => {
      const retried = await createAsset(AssetStatus.processing, { name: 'retried.png' })
      await createTask(retried.id, WorkflowTaskType.transcode_image, WorkflowTaskStatus.failed, {
        error: 'first attempt failed',
      })
      await createTask(retried.id, WorkflowTaskType.transcode_image, WorkflowTaskStatus.processing)

      const running = await createAsset(AssetStatus.processing, { name: 'running.mov' })
      await createTask(running.id, WorkflowTaskType.transcode_video, WorkflowTaskStatus.processing)

      const completed = await createAsset(AssetStatus.processing, { name: 'completed.pdf' })
      await createTask(completed.id, WorkflowTaskType.transcode_pdf, WorkflowTaskStatus.completed)

      const withoutTasks = await createAsset(AssetStatus.processing, { name: 'no-task.png' })

      expect(await transcodeFailureService.recoverAssetsStuckAfterFailedTranscode()).toBe(0)

      for (const asset of [retried, running, completed, withoutTasks]) {
        const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
        expect(after.status).toBe(AssetStatus.processing)
        expect(after.media).toBeNull()
      }
    })

    it('only looks at preview transcode tasks when finding the latest one', async () => {
      const asset = await createAsset(AssetStatus.processing, { name: 'notes.md' })
      await createTask(asset.id, WorkflowTaskType.transcode_text, WorkflowTaskStatus.failed, {
        error: 'Failed to download media to tmp',
      })
      // Newer tasks of other kinds do not hide the failed transcode.
      await createTask(asset.id, WorkflowTaskType.ai_embedding, WorkflowTaskStatus.completed)
      await createTask(asset.id, WorkflowTaskType.transcode_screenshot, WorkflowTaskStatus.pending)

      expect(await transcodeFailureService.recoverAssetsStuckAfterFailedTranscode()).toBe(1)

      const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
      expect(after.media?.transcodeError).toMatchObject({
        taskType: 'transcode_text',
        message: 'Failed to download media to tmp',
      })
    })

    it('does not touch trashed or processed assets with a failed transcode task', async () => {
      const trashed = await createAsset(AssetStatus.trashed, { isDeleted: true })
      await createTask(trashed.id, WorkflowTaskType.transcode_image, WorkflowTaskStatus.failed, {
        error: 'boom',
      })
      const processed = await createAsset(AssetStatus.processed, { name: 'done.png' })
      await createTask(processed.id, WorkflowTaskType.transcode_image, WorkflowTaskStatus.failed, {
        error: 'boom',
      })

      expect(await transcodeFailureService.recoverAssetsStuckAfterFailedTranscode()).toBe(0)

      expect((await prisma.asset.findUniqueOrThrow({ where: { id: trashed.id } })).status).toBe(
        AssetStatus.trashed,
      )
      const processedAfter = await prisma.asset.findUniqueOrThrow({ where: { id: processed.id } })
      expect(processedAfter.status).toBe(AssetStatus.processed)
      expect(processedAfter.media).toBeNull()
    })

    it('walks through every stuck asset across batches', async () => {
      const stuck = []
      for (const name of ['a.exr', 'b.exr', 'c.exr']) {
        const asset = await createAsset(AssetStatus.processing, { name })
        await createTask(asset.id, WorkflowTaskType.transcode_image, WorkflowTaskStatus.failed, {
          error: `failed ${name}`,
        })
        stuck.push(asset)
      }

      expect(await transcodeFailureService.recoverAssetsStuckAfterFailedTranscode(1)).toBe(3)
      expect(await transcodeFailureService.recoverAssetsStuckAfterFailedTranscode(1)).toBe(0)

      for (const asset of stuck) {
        const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
        expect(after.status).toBe(AssetStatus.processed)
        expect(after.media?.transcodeError?.message).toBe(`failed ${asset.name}`)
      }
    })
  })
})
