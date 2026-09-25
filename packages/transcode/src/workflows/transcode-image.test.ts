import { describe, it, expect, vi, beforeEach } from 'vitest'
import { transcodeImageWorkflow } from './transcode-image'
import { WorkflowTask, WorkflowTaskStatus, WorkflowTaskType, AssetStatus } from '@shumai/db'
import * as workflowUtils from '@shumai/workflow-core'

vi.mock('@shumai/workflow-core', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actual = (await importOriginal()) as any
  return {
    ...actual,
    getActivities: vi.fn(),
    executeActivity: vi.fn(),
    sleep: vi.fn(),
  }
})

describe('transcodeImageWorkflow', () => {
  const mockActivities = {
    updateTaskStatusActivity: Object.assign(vi.fn(), {
      _activityName: 'updateTaskStatusActivity',
    }),
    updateAssetStatusActivity: Object.assign(vi.fn(), {
      _activityName: 'updateAssetStatusActivity',
    }),
    getAssetActivity: Object.assign(vi.fn(), { _activityName: 'getAssetActivity' }),
    getMediaInfoActivity: Object.assign(vi.fn(), { _activityName: 'getMediaInfoActivity' }),
    transcodeImageActivity: Object.assign(vi.fn(), { _activityName: 'transcodeImageActivity' }),
    updateAssetMediaActivity: Object.assign(vi.fn(), {
      _activityName: 'updateAssetMediaActivity',
    }),
    getTranscodeWorkerQueueActivity: Object.assign(vi.fn(), {
      _activityName: 'getTranscodeWorkerQueueActivity',
    }),
    downloadMediaToTmpActivity: Object.assign(vi.fn(), {
      _activityName: 'downloadMediaToTmpActivity',
    }),
    cleanupTmpDirActivity: Object.assign(vi.fn(), { _activityName: 'cleanupTmpDirActivity' }),
    createEmbeddingTaskIfEnabledActivity: Object.assign(vi.fn(), {
      _activityName: 'createEmbeddingTaskIfEnabledActivity',
    }),
    createAutofillTaskIfEnabledActivity: Object.assign(vi.fn(), {
      _activityName: 'createAutofillTaskIfEnabledActivity',
    }),
    markAssetTranscodeFailedActivity: Object.assign(vi.fn(), {
      _activityName: 'markAssetTranscodeFailedActivity',
    }),
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(workflowUtils.getActivities as any).mockReturnValue(mockActivities)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(workflowUtils.executeActivity as any).mockImplementation(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (_queue: string, fn: any, ...args: any[]) => {
        if (typeof fn !== 'function') {
          throw new Error(`fn is not a function in executeActivity. Queue: ${_queue}`)
        }
        return fn(...args)
      },
    )

    mockActivities.getTranscodeWorkerQueueActivity.mockResolvedValue('transcode_worker_queue')
    mockActivities.downloadMediaToTmpActivity.mockResolvedValue({
      filePath: '/tmp/image.jpg',
      tmpDir: '/tmp',
    })
  })

  it('should process image transcode and thumbnail successfully', async () => {
    const task: WorkflowTask = {
      id: 'task-image',
      assetId: 'asset-image',
      type: WorkflowTaskType.transcode_image,
      status: WorkflowTaskStatus.pending,
      sessionId: null,
      output: null,
      payload: {
        projectId: 'proj-1',
        transcode: {
          thumbnail: true,
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      heartbeat: null,
      teamId: 'team-1',
      projectId: 'proj-1',
      uid: 'task-uid',
      model: null,
      inputTokens: 0,
      outputTokens: 0,
    }

    mockActivities.getAssetActivity.mockResolvedValue({
      id: 'asset-image',
      storageKey: { key: 'image.jpg' },
      mediaType: 'image/jpeg',
    })

    mockActivities.getMediaInfoActivity.mockResolvedValue({
      proxyType: 'image',
      metadata: {
        originalWidth: 1000,
        originalHeight: 1000,
        duration: 0,
        frameRate: 0,
        totalFrames: 0,
        startTimecode: '00:00:00:00',
        bitRate: 0,
        hasAudio: false,
        format: {},
      },
      videoTranscodes: [],
      imageTranscodes: [],
    })

    mockActivities.transcodeImageActivity.mockResolvedValue({
      key: 't.webp',
      width: 300,
      height: 300,
      format: 'webp',
    })

    await transcodeImageWorkflow(task)

    expect(mockActivities.updateAssetStatusActivity).toHaveBeenCalledWith({
      assetId: 'asset-image',
      status: AssetStatus.processing,
    })

    expect(mockActivities.updateAssetMediaActivity).toHaveBeenCalledWith({
      assetId: 'asset-image',
      mediaInfo: expect.objectContaining({
        thumbnail: expect.objectContaining({
          key: 't.webp',
          width: 300,
          height: 300,
        }),
      }),
    })

    expect(mockActivities.updateAssetStatusActivity).toHaveBeenCalledWith({
      assetId: 'asset-image',
      status: AssetStatus.processed,
    })

    expect(mockActivities.createEmbeddingTaskIfEnabledActivity).toHaveBeenCalledWith({
      assetId: 'asset-image',
      teamId: 'team-1',
      projectId: 'proj-1',
    })

    expect(mockActivities.createAutofillTaskIfEnabledActivity).toHaveBeenCalledWith({
      assetId: 'asset-image',
      teamId: 'team-1',
      projectId: 'proj-1',
    })
  })

  describe('when the transcode fails for good', () => {
    const task: WorkflowTask = {
      id: 'task-exr',
      assetId: 'asset-exr',
      type: WorkflowTaskType.transcode_image,
      status: WorkflowTaskStatus.pending,
      sessionId: null,
      output: null,
      payload: { projectId: 'proj-1', transcode: { thumbnail: true } },
      createdAt: new Date(),
      updatedAt: new Date(),
      heartbeat: null,
      teamId: 'team-1',
      projectId: 'proj-1',
      uid: 'task-uid-exr',
      model: null,
      inputTokens: 0,
      outputTokens: 0,
    }
    const reason = 'Failed to get media info: Input file contains unsupported image format'

    beforeEach(() => {
      mockActivities.getAssetActivity.mockResolvedValue({
        id: 'asset-exr',
        name: 'render.exr',
        storageKey: { key: 'files/asset-exr/render.exr' },
        mediaType: 'image/aces',
        status: 'processing',
      })
      mockActivities.getMediaInfoActivity.mockRejectedValue(new Error(reason))
      mockActivities.markAssetTranscodeFailedActivity.mockResolvedValue(true)
    })

    it('fails the task, records the failure on the asset and finishes without throwing', async () => {
      await expect(transcodeImageWorkflow(task)).resolves.toBeUndefined()

      expect(mockActivities.markAssetTranscodeFailedActivity).toHaveBeenCalledTimes(1)
      expect(mockActivities.markAssetTranscodeFailedActivity).toHaveBeenCalledWith({
        assetId: 'asset-exr',
        taskType: 'transcode_image',
        message: reason,
      })
      expect(mockActivities.updateTaskStatusActivity).toHaveBeenLastCalledWith({
        taskId: 'task-exr',
        status: 'failed',
        output: { error: reason },
      })
      expect(mockActivities.updateTaskStatusActivity).not.toHaveBeenCalledWith(
        expect.objectContaining({ status: 'completed' }),
      )
      // The asset only leaves processing through the guarded activity, never through the
      // unconditional status update that would also revive trashed assets.
      expect(mockActivities.updateAssetStatusActivity).toHaveBeenCalledTimes(1)
      expect(mockActivities.updateAssetStatusActivity).toHaveBeenCalledWith({
        assetId: 'asset-exr',
        status: AssetStatus.processing,
      })
      // Nothing runs again: the failed step ran once and no later step started.
      expect(mockActivities.getMediaInfoActivity).toHaveBeenCalledTimes(1)
      expect(mockActivities.transcodeImageActivity).not.toHaveBeenCalled()
      expect(mockActivities.updateAssetMediaActivity).not.toHaveBeenCalled()
      expect(mockActivities.createEmbeddingTaskIfEnabledActivity).not.toHaveBeenCalled()
      expect(mockActivities.createAutofillTaskIfEnabledActivity).not.toHaveBeenCalled()
      expect(mockActivities.cleanupTmpDirActivity).toHaveBeenCalledWith({ tmpDir: '/tmp' })
    })

    it('leaves the asset to the guarded activity when it was trashed meanwhile', async () => {
      // The activity reports that the asset is no longer processing (trashed or purging).
      mockActivities.markAssetTranscodeFailedActivity.mockResolvedValue(false)

      await expect(transcodeImageWorkflow(task)).resolves.toBeUndefined()

      expect(mockActivities.updateAssetStatusActivity).not.toHaveBeenCalledWith({
        assetId: 'asset-exr',
        status: AssetStatus.processed,
      })
      expect(mockActivities.updateTaskStatusActivity).toHaveBeenLastCalledWith({
        taskId: 'task-exr',
        status: 'failed',
        output: { error: reason },
      })
    })

    it('finishes without throwing for errors raised by the workflow code itself', async () => {
      // A TypeError in workflow code would make Temporal retry the workflow task forever
      // if it escaped the workflow.
      mockActivities.getMediaInfoActivity.mockResolvedValue(undefined)

      await expect(transcodeImageWorkflow(task)).resolves.toBeUndefined()

      expect(mockActivities.markAssetTranscodeFailedActivity).toHaveBeenCalledWith({
        assetId: 'asset-exr',
        taskType: 'transcode_image',
        message: expect.stringMatching(/\S/),
      })
      expect(mockActivities.updateTaskStatusActivity).toHaveBeenLastCalledWith(
        expect.objectContaining({ taskId: 'task-exr', status: 'failed' }),
      )
    })
  })

  it('writes fresh media on success, dropping a failure recorded by an earlier run', async () => {
    const task: WorkflowTask = {
      id: 'task-retry',
      assetId: 'asset-retry',
      type: WorkflowTaskType.transcode_image,
      status: WorkflowTaskStatus.pending,
      sessionId: null,
      output: null,
      payload: { projectId: 'proj-1', transcode: {} },
      createdAt: new Date(),
      updatedAt: new Date(),
      heartbeat: null,
      teamId: 'team-1',
      projectId: 'proj-1',
      uid: 'task-uid-retry',
      model: null,
      inputTokens: 0,
      outputTokens: 0,
    }
    mockActivities.getAssetActivity.mockResolvedValue({
      id: 'asset-retry',
      storageKey: { key: 'image.png' },
      mediaType: 'image/png',
      media: {
        transcodeError: {
          taskType: 'transcode_image',
          message: 'earlier failure',
          failedAt: '2026-09-25T00:00:00.000Z',
        },
      },
    })
    mockActivities.getMediaInfoActivity.mockResolvedValue({
      proxyType: 'image',
      metadata: { originalWidth: 64, originalHeight: 48 },
      videoTranscodes: [],
      imageTranscodes: [],
    })
    mockActivities.transcodeImageActivity.mockResolvedValue({ key: 'image-64p.webp' })

    await transcodeImageWorkflow(task)

    const [{ mediaInfo }] = mockActivities.updateAssetMediaActivity.mock.calls[0]
    expect(mediaInfo).not.toHaveProperty('transcodeError')
    expect(mockActivities.markAssetTranscodeFailedActivity).not.toHaveBeenCalled()
    expect(mockActivities.updateTaskStatusActivity).toHaveBeenLastCalledWith({
      taskId: 'task-retry',
      status: 'completed',
    })
  })
})
