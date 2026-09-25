import { AssetStatus, prisma, WorkflowTaskStatus, WorkflowTaskType } from '@shumai/db'
import '@shumai/db/src/prisma-json-types'
import { logger } from '../logger'

/** Longest failure reason kept in `media.transcodeError.message`. */
export const TRANSCODE_ERROR_MESSAGE_MAX_LENGTH = 500

/**
 * Task types whose workflows move an asset into `processing` and out of it again: the
 * image, video/audio, PDF and text preview workflows, and the legacy `transcode`
 * dispatcher that runs them.
 */
export const PREVIEW_TRANSCODE_TASK_TYPES: readonly WorkflowTaskType[] = [
  WorkflowTaskType.transcode,
  WorkflowTaskType.transcode_video,
  WorkflowTaskType.transcode_image,
  WorkflowTaskType.transcode_pdf,
  WorkflowTaskType.transcode_text,
]

const DEFAULT_FAILURE_MESSAGE = 'Transcode failed'

/**
 * Cuts a failure reason to {@link TRANSCODE_ERROR_MESSAGE_MAX_LENGTH} characters without
 * splitting a surrogate pair, and drops NUL characters, which Postgres JSON rejects.
 */
export function truncateTranscodeErrorMessage(message: string): string {
  const cleaned = message.replaceAll('\u0000', '')
  if (cleaned.length <= TRANSCODE_ERROR_MESSAGE_MAX_LENGTH) return cleaned
  const cut = cleaned.slice(0, TRANSCODE_ERROR_MESSAGE_MAX_LENGTH)
  const lastCode = cut.charCodeAt(cut.length - 1)
  return lastCode >= 0xd800 && lastCode <= 0xdbff ? cut.slice(0, -1) : cut
}

export function buildTranscodeError(
  taskType: string,
  message: string,
  failedAt: Date,
): PrismaJson.TranscodeError {
  return {
    taskType,
    message: truncateTranscodeErrorMessage(message) || DEFAULT_FAILURE_MESSAGE,
    failedAt: failedAt.toISOString(),
  }
}

/**
 * The asset's media with the failure recorded. Whatever the failed run already stored
 * (a video's poster and sprite, say) is kept; an asset without media gets an empty record.
 */
export function withTranscodeError(
  media: PrismaJson.MediaInfo | null | undefined,
  transcodeError: PrismaJson.TranscodeError,
): PrismaJson.MediaInfo {
  return {
    ...(media ?? {
      duration: 0,
      filesize: 0,
      frames: 0,
      imageTranscodes: [],
      videoTranscodes: [],
      finishedAt: transcodeError.failedAt,
      metadata: null,
      original: null,
    }),
    transcodeError,
  }
}

/** The failure reason a failed workflow task recorded in its output, if any. */
function getTaskErrorMessage(output: unknown): string {
  if (output && typeof output === 'object' && 'error' in output) {
    const error = (output as { error?: unknown }).error
    if (typeof error === 'string' && error) return error
  }
  return DEFAULT_FAILURE_MESSAGE
}

export interface MarkAssetTranscodeFailedParams {
  assetId: string
  /** Type of the workflow task whose final attempt failed. */
  taskType: string
  /** Failure reason; cut to {@link TRANSCODE_ERROR_MESSAGE_MAX_LENGTH} characters. */
  message: string
  /** When the transcode failed. Defaults to now. */
  failedAt?: Date
}

export class TranscodeFailureService {
  constructor(private readonly prismaClient: typeof prisma = prisma) {}

  /**
   * Ends a transcode that failed for good: an asset still in `processing` becomes
   * `processed` with the reason in `media.transcodeError`, so it stops showing as in
   * progress. Assets in any other state are left alone, so a file moved to the trash
   * (`trashed`) or being purged (`pending_purge`) while it was transcoding keeps its state.
   *
   * @returns whether the asset was updated
   */
  async markAssetTranscodeFailed(params: MarkAssetTranscodeFailedParams): Promise<boolean> {
    const transcodeError = buildTranscodeError(
      params.taskType,
      params.message,
      params.failedAt ?? new Date(),
    )

    return this.prismaClient.$transaction(async (tx) => {
      const asset = await tx.asset.findFirst({
        where: { id: params.assetId, status: AssetStatus.processing },
        select: { media: true },
      })
      if (!asset) return false

      const { count } = await tx.asset.updateMany({
        where: { id: params.assetId, status: AssetStatus.processing },
        data: {
          status: AssetStatus.processed,
          media: withTranscodeError(asset.media, transcodeError),
        },
      })
      return count > 0
    })
  }

  /**
   * Drops a failure recorded by an earlier transcode of the asset, for runs that finish
   * without writing new media (a text upload that turns out to be binary). Runs that do
   * write media replace it whole, which drops the failure as well.
   */
  async clearTranscodeError(assetId: string): Promise<void> {
    await this.prismaClient.$transaction(async (tx) => {
      const asset = await tx.asset.findUnique({
        where: { id: assetId },
        select: { media: true },
      })
      if (!asset?.media?.transcodeError) return

      const media: PrismaJson.MediaInfo = { ...asset.media }
      delete media.transcodeError
      await tx.asset.updateMany({
        where: { id: assetId },
        data: { media },
      })
    })
  }

  /**
   * Repairs assets that transcodes left in `processing` before failures were recorded on
   * the asset: every asset still `processing` whose latest preview transcode task
   * ({@link PREVIEW_TRANSCODE_TASK_TYPES}) has `failed` becomes `processed`, with the
   * task's error as `media.transcodeError`. Assets whose latest transcode task is still
   * pending or running are not touched.
   *
   * Idempotent: repaired assets are `processed`, so running it again changes nothing.
   *
   * @returns how many assets were repaired
   */
  async recoverAssetsStuckAfterFailedTranscode(batchSize = 100): Promise<number> {
    let recovered = 0
    let cursor: string | undefined

    for (;;) {
      const assets = await this.prismaClient.asset.findMany({
        where: {
          status: AssetStatus.processing,
          ...(cursor ? { id: { lt: cursor } } : {}),
        },
        orderBy: { id: 'desc' },
        take: batchSize,
        select: { id: true },
      })
      if (assets.length === 0) break
      cursor = assets[assets.length - 1].id

      const tasks = await this.prismaClient.workflowTask.findMany({
        where: {
          assetId: { in: assets.map((a) => a.id) },
          type: { in: [...PREVIEW_TRANSCODE_TASK_TYPES] },
        },
        orderBy: { id: 'desc' },
        select: {
          id: true,
          assetId: true,
          type: true,
          status: true,
          output: true,
          updatedAt: true,
        },
      })

      // Tasks come newest first, so the first one seen for an asset is its latest.
      const latestTaskByAsset = new Map<string, (typeof tasks)[number]>()
      for (const task of tasks) {
        if (!latestTaskByAsset.has(task.assetId)) latestTaskByAsset.set(task.assetId, task)
      }

      for (const [assetId, task] of latestTaskByAsset) {
        if (task.status !== WorkflowTaskStatus.failed) continue

        const updated = await this.markAssetTranscodeFailed({
          assetId,
          taskType: task.type ?? WorkflowTaskType.transcode,
          message: getTaskErrorMessage(task.output),
          failedAt: task.updatedAt,
        })
        if (updated) {
          recovered++
          logger.info(
            { assetId, taskId: task.id, taskType: task.type },
            'Marked asset stuck in processing after a failed transcode as processed',
          )
        }
      }

      if (assets.length < batchSize) break
    }

    if (recovered > 0) {
      logger.info({ recovered }, 'Repaired assets stuck in processing after failed transcodes')
    }
    return recovered
  }
}

export const transcodeFailureService = new TranscodeFailureService()
