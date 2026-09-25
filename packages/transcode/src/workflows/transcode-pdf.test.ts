import { describe, it, expect, vi, beforeEach } from 'vitest'
import { transcodePdfWorkflow } from './transcode-pdf'
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

describe('transcodePdfWorkflow', () => {
  const mockActivities = {
    updateTaskStatusActivity: Object.assign(vi.fn(), {
      _activityName: 'updateTaskStatusActivity',
    }),
    updateAssetStatusActivity: Object.assign(vi.fn(), {
      _activityName: 'updateAssetStatusActivity',
    }),
    getAssetActivity: Object.assign(vi.fn(), { _activityName: 'getAssetActivity' }),
    getMediaInfoActivity: Object.assign(vi.fn(), { _activityName: 'getMediaInfoActivity' }),
    generateSpriteActivity: Object.assign(vi.fn(), { _activityName: 'generateSpriteActivity' }),
    updateAssetMediaActivity: Object.assign(vi.fn(), {
      _activityName: 'updateAssetMediaActivity',
    }),
    getTranscodeWorkerQueueActivity: Object.assign(vi.fn(), {
      _activityName: 'getTranscodeWorkerQueueActivity',
    }),
    downloadMediaToTmpActivity: Object.assign(vi.fn(), {
      _activityName: 'downloadMediaToTmpActivity',
    }),
    generatePdfProxyActivity: Object.assign(vi.fn(), {
      _activityName: 'generatePdfProxyActivity',
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
      filePath: '/tmp/doc.pdf',
      tmpDir: '/tmp',
    })
    mockActivities.generatePdfProxyActivity.mockResolvedValue({
      pdfProxyKey: 'document.pdf',
      pdfFilePath: '/tmp/doc.pdf',
    })
  })

  it('should process pdf transcode and sprite generation successfully', async () => {
    const task: WorkflowTask = {
      id: 'task-pdf',
      assetId: 'asset-pdf',
      type: WorkflowTaskType.transcode_pdf,
      status: WorkflowTaskStatus.pending,
      sessionId: null,
      output: null,
      payload: {
        projectId: 'proj-1',
        transcode: {
          sprite: true,
          poster: true,
        },
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      heartbeat: null,
      teamId: 'team-1',
      projectId: 'proj-1',
      uid: 'task-uid-pdf',
      model: null,
      inputTokens: 0,
      outputTokens: 0,
    }

    mockActivities.getAssetActivity.mockResolvedValue({
      id: 'asset-pdf',
      storageKey: { key: 'document.pdf' },
      mediaType: 'application/pdf',
    })

    mockActivities.getMediaInfoActivity.mockResolvedValue({
      proxyType: 'pdf',
      metadata: {
        originalWidth: 800,
        originalHeight: 1000,
        duration: 0,
        frameRate: 0,
        totalFrames: 12,
        startTimecode: '00:00:00:00',
        bitRate: 0,
        hasAudio: false,
        format: {},
      },
      videoTranscodes: [],
      imageTranscodes: [],
    })

    mockActivities.generateSpriteActivity.mockResolvedValue({
      sprite: { key: 'sprite.webp', frames: 100, tileX: 10, tileY: 10 },
      poster: { key: 'poster.webp' },
    })

    await transcodePdfWorkflow(task)

    expect(mockActivities.updateAssetStatusActivity).toHaveBeenCalledWith({
      assetId: 'asset-pdf',
      status: AssetStatus.processing,
    })

    expect(mockActivities.generateSpriteActivity).toHaveBeenCalledWith({
      assetKey: 'document.pdf',
      filePath: '/tmp/doc.pdf',
      spriteSpec: expect.objectContaining({ key: 'sprite.webp' }),
      posterSpec: expect.objectContaining({ key: 'poster.webp' }),
      mediaInfo: expect.objectContaining({ proxyType: 'pdf' }),
    })

    expect(mockActivities.updateAssetMediaActivity).toHaveBeenCalledWith({
      assetId: 'asset-pdf',
      mediaInfo: expect.objectContaining({
        sprite: { key: 'sprite.webp', frames: 100, tileX: 10, tileY: 10 },
        poster: { key: 'poster.webp' },
      }),
    })

    expect(mockActivities.updateAssetStatusActivity).toHaveBeenCalledWith({
      assetId: 'asset-pdf',
      status: AssetStatus.processed,
    })

    expect(mockActivities.createAutofillTaskIfEnabledActivity).toHaveBeenCalledWith({
      assetId: 'asset-pdf',
      teamId: 'team-1',
      projectId: 'proj-1',
    })
  })

  describe('when the transcode fails for good', () => {
    const task: WorkflowTask = {
      id: 'task-bad-pdf',
      assetId: 'asset-bad-pdf',
      type: WorkflowTaskType.transcode_pdf,
      status: WorkflowTaskStatus.pending,
      sessionId: null,
      output: null,
      payload: { projectId: 'proj-1', transcode: { sprite: true, poster: true } },
      createdAt: new Date(),
      updatedAt: new Date(),
      heartbeat: null,
      teamId: 'team-1',
      projectId: 'proj-1',
      uid: 'task-uid-bad-pdf',
      model: null,
      inputTokens: 0,
      outputTokens: 0,
    }
    const reason = "Failed to get media info: Syntax Error: Couldn't find trailer dictionary"

    beforeEach(() => {
      mockActivities.getAssetActivity.mockResolvedValue({
        id: 'asset-bad-pdf',
        name: 'broken.pdf',
        storageKey: { key: 'files/asset-bad-pdf/broken.pdf' },
        mediaType: 'application/pdf',
        status: 'processing',
      })
      mockActivities.getMediaInfoActivity.mockRejectedValue(new Error(reason))
      mockActivities.markAssetTranscodeFailedActivity.mockResolvedValue(true)
    })

    it('fails the task, records the failure on the asset and finishes without throwing', async () => {
      await expect(transcodePdfWorkflow(task)).resolves.toBeUndefined()

      expect(mockActivities.markAssetTranscodeFailedActivity).toHaveBeenCalledWith({
        assetId: 'asset-bad-pdf',
        taskType: 'transcode_pdf',
        message: reason,
      })
      expect(mockActivities.updateTaskStatusActivity).toHaveBeenLastCalledWith({
        taskId: 'task-bad-pdf',
        status: 'failed',
        output: { error: reason },
      })
      expect(mockActivities.updateAssetStatusActivity).toHaveBeenCalledTimes(1)
      expect(mockActivities.updateAssetStatusActivity).toHaveBeenCalledWith({
        assetId: 'asset-bad-pdf',
        status: AssetStatus.processing,
      })
      expect(mockActivities.getMediaInfoActivity).toHaveBeenCalledTimes(1)
      expect(mockActivities.generateSpriteActivity).not.toHaveBeenCalled()
      expect(mockActivities.updateAssetMediaActivity).not.toHaveBeenCalled()
      expect(mockActivities.createAutofillTaskIfEnabledActivity).not.toHaveBeenCalled()
      expect(mockActivities.cleanupTmpDirActivity).toHaveBeenCalledWith({ tmpDir: '/tmp' })
    })

    it('handles a document that cannot be converted to PDF the same way', async () => {
      mockActivities.generatePdfProxyActivity.mockRejectedValue(
        new Error('Gotenberg conversion failed: 503 Service Unavailable'),
      )

      await expect(transcodePdfWorkflow(task)).resolves.toBeUndefined()

      expect(mockActivities.generatePdfProxyActivity).toHaveBeenCalledTimes(1)
      expect(mockActivities.markAssetTranscodeFailedActivity).toHaveBeenCalledWith({
        assetId: 'asset-bad-pdf',
        taskType: 'transcode_pdf',
        message: 'Gotenberg conversion failed: 503 Service Unavailable',
      })
      expect(mockActivities.getMediaInfoActivity).not.toHaveBeenCalled()
    })

    it('leaves the asset to the guarded activity when it was trashed meanwhile', async () => {
      mockActivities.markAssetTranscodeFailedActivity.mockResolvedValue(false)

      await expect(transcodePdfWorkflow(task)).resolves.toBeUndefined()

      expect(mockActivities.updateAssetStatusActivity).not.toHaveBeenCalledWith({
        assetId: 'asset-bad-pdf',
        status: AssetStatus.processed,
      })
      expect(mockActivities.updateTaskStatusActivity).toHaveBeenLastCalledWith(
        expect.objectContaining({ taskId: 'task-bad-pdf', status: 'failed' }),
      )
    })
  })
})
