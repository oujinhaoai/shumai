import { describe, it, expect, vi, beforeEach } from 'vitest'
import { transcodeMedia } from './transcode'
import { WorkflowTask, WorkflowTaskStatus, WorkflowTaskType } from '@shumai/db'
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

describe('transcodeMedia Fallback Dispatcher', () => {
  const mockActivities = {
    updateTaskStatusActivity: Object.assign(vi.fn(), {
      _activityName: 'updateTaskStatusActivity',
    }),
    updateAssetStatusActivity: Object.assign(vi.fn(), {
      _activityName: 'updateAssetStatusActivity',
    }),
    getAssetActivity: Object.assign(vi.fn(), { _activityName: 'getAssetActivity' }),
    getTranscodeWorkerQueueActivity: Object.assign(vi.fn(), {
      _activityName: 'getTranscodeWorkerQueueActivity',
    }),
    renderPdfPagesActivity: Object.assign(vi.fn(), {
      _activityName: 'renderPdfPagesActivity',
    }),
    downloadMediaToTmpActivity: Object.assign(vi.fn(), {
      _activityName: 'downloadMediaToTmpActivity',
    }),
    generateTextProxyActivity: Object.assign(vi.fn(), {
      _activityName: 'generateTextProxyActivity',
    }),
    generatePdfProxyActivity: Object.assign(vi.fn(), {
      _activityName: 'generatePdfProxyActivity',
    }),
    getMediaInfoActivity: Object.assign(vi.fn(), { _activityName: 'getMediaInfoActivity' }),
    updateAssetMediaActivity: Object.assign(vi.fn(), {
      _activityName: 'updateAssetMediaActivity',
    }),
    createEmbeddingTaskIfEnabledActivity: Object.assign(vi.fn(), {
      _activityName: 'createEmbeddingTaskIfEnabledActivity',
    }),
    createAutofillTaskIfEnabledActivity: Object.assign(vi.fn(), {
      _activityName: 'createAutofillTaskIfEnabledActivity',
    }),
    cleanupTmpDirActivity: Object.assign(vi.fn(), { _activityName: 'cleanupTmpDirActivity' }),
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
  })

  it('should dispatch to pdfPages workflow when payload.pdfPages is present', async () => {
    const task: WorkflowTask = {
      id: 'task-pdf-pages',
      assetId: 'asset-pdf',
      type: WorkflowTaskType.transcode,
      status: WorkflowTaskStatus.pending,
      payload: {
        projectId: 'proj-1',
        pdfPages: {
          start: 1,
          end: 2,
        },
      },
      output: null,
      sessionId: null,
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
      id: 'asset-pdf',
      storageKey: { key: 'doc.pdf' },
      mediaType: 'application/pdf',
    })

    mockActivities.renderPdfPagesActivity.mockResolvedValue([])

    await transcodeMedia(task)

    expect(mockActivities.renderPdfPagesActivity).toHaveBeenCalled()
  })

  it('should dispatch transcode_text tasks to the text workflow', async () => {
    const task: WorkflowTask = {
      id: 'task-text',
      assetId: 'asset-md',
      type: WorkflowTaskType.transcode_text,
      status: WorkflowTaskStatus.pending,
      payload: { projectId: 'proj-1', transcode: {} },
      output: null,
      sessionId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      heartbeat: null,
      teamId: 'team-1',
      projectId: 'proj-1',
      uid: 'task-uid-text',
      model: null,
      inputTokens: 0,
      outputTokens: 0,
    }

    mockActivities.getAssetActivity.mockResolvedValue({
      id: 'asset-md',
      storageKey: { key: 'files/asset-md/notes.md' },
      mediaType: 'text/markdown',
    })
    mockActivities.downloadMediaToTmpActivity.mockResolvedValue({
      filePath: '/tmp/t/notes.md',
      tmpDir: '/tmp/t',
    })
    mockActivities.generateTextProxyActivity.mockResolvedValue({
      textProxyKey: 'files/asset-md/proxy.txt',
      textFilePath: '/tmp/t/proxy.txt',
      encoding: 'utf-8',
      lineCount: 1,
      truncated: false,
    })
    mockActivities.getMediaInfoActivity.mockResolvedValue({ proxyType: 'text' })

    await transcodeMedia(task)

    expect(mockActivities.generateTextProxyActivity).toHaveBeenCalled()
    expect(mockActivities.generatePdfProxyActivity).not.toHaveBeenCalled()
  })

  it('should handle failures: fail the task, record the failure on the asset and finish', async () => {
    const task: WorkflowTask = {
      id: 'task-fail',
      assetId: 'asset-1',
      type: WorkflowTaskType.transcode,
      status: WorkflowTaskStatus.pending,
      sessionId: null,
      output: null,
      payload: {
        projectId: 'proj-1',
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

    mockActivities.getAssetActivity.mockRejectedValue(new Error('FFmpeg failed'))
    mockActivities.markAssetTranscodeFailedActivity.mockResolvedValue(true)

    await expect(transcodeMedia(task)).resolves.toBeUndefined()

    expect(mockActivities.markAssetTranscodeFailedActivity).toHaveBeenCalledWith({
      assetId: 'asset-1',
      taskType: 'transcode',
      message: 'FFmpeg failed',
    })
    expect(mockActivities.updateTaskStatusActivity).toHaveBeenCalledWith({
      taskId: 'task-fail',
      status: WorkflowTaskStatus.failed,
      output: { error: 'FFmpeg failed' },
    })
  })
})
