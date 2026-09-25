import { describe, it, expect, vi, beforeEach } from 'vitest'
import { transcodeTextWorkflow } from './transcode-text'
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

describe('transcodeTextWorkflow', () => {
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
    generateTextProxyActivity: Object.assign(vi.fn(), {
      _activityName: 'generateTextProxyActivity',
    }),
    cleanupTmpDirActivity: Object.assign(vi.fn(), { _activityName: 'cleanupTmpDirActivity' }),
    createEmbeddingTaskIfEnabledActivity: Object.assign(vi.fn(), {
      _activityName: 'createEmbeddingTaskIfEnabledActivity',
    }),
    createAutofillTaskIfEnabledActivity: Object.assign(vi.fn(), {
      _activityName: 'createAutofillTaskIfEnabledActivity',
    }),
  }

  const task: WorkflowTask = {
    id: 'task-text',
    assetId: 'asset-text',
    type: WorkflowTaskType.transcode_text,
    status: WorkflowTaskStatus.pending,
    sessionId: null,
    output: null,
    payload: {
      projectId: 'proj-1',
      transcode: {},
    },
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
    mockActivities.getAssetActivity.mockResolvedValue({
      id: 'asset-text',
      name: 'notes.md',
      storageKey: { key: 'files/asset-text/notes.md' },
      mediaType: 'text/markdown',
      status: 'processing',
    })
    mockActivities.downloadMediaToTmpActivity.mockResolvedValue({
      filePath: '/tmp/transcode-1/notes.md',
      tmpDir: '/tmp/transcode-1',
    })
    mockActivities.generateTextProxyActivity.mockResolvedValue({
      textProxyKey: 'files/asset-text/proxy.txt',
      textFilePath: '/tmp/transcode-1/proxy.txt',
      encoding: 'gb18030',
      lineCount: 42,
      truncated: false,
      format: 'markdown',
    })
    mockActivities.getMediaInfoActivity.mockResolvedValue({
      proxyType: 'text',
      duration: 0,
      filesize: 0,
      frames: 0,
      metadata: null,
      videoTranscodes: [],
      imageTranscodes: [],
    })
  })

  it('should store a text proxy instead of a PDF and mark the asset processed', async () => {
    await transcodeTextWorkflow(task)

    expect(mockActivities.updateAssetStatusActivity).toHaveBeenNthCalledWith(1, {
      assetId: 'asset-text',
      status: AssetStatus.processing,
    })
    expect(mockActivities.generateTextProxyActivity).toHaveBeenCalledWith({
      assetId: 'asset-text',
      assetKey: 'files/asset-text/notes.md',
      filePath: '/tmp/transcode-1/notes.md',
      mediaType: 'text/markdown',
      filename: 'notes.md',
    })
    expect(mockActivities.getMediaInfoActivity).toHaveBeenCalledWith({
      filePath: '/tmp/transcode-1/proxy.txt',
      assetId: 'asset-text',
      proxyType: 'text',
      mediaType: 'text/markdown',
    })
    expect(mockActivities.updateAssetMediaActivity).toHaveBeenCalledWith({
      assetId: 'asset-text',
      mediaInfo: expect.objectContaining({
        proxyType: 'text',
        original: { key: 'files/asset-text/notes.md', filesizeInBytes: 0, codec: '' },
        textTranscode: {
          key: 'files/asset-text/proxy.txt',
          encoding: 'gb18030',
          lineCount: 42,
          truncated: false,
          format: 'markdown',
        },
      }),
    })
    expect(mockActivities.updateAssetStatusActivity).toHaveBeenLastCalledWith({
      assetId: 'asset-text',
      status: AssetStatus.processed,
    })

    expect(mockActivities.generatePdfProxyActivity).not.toHaveBeenCalled()
    expect(mockActivities.generateSpriteActivity).not.toHaveBeenCalled()

    expect(mockActivities.createAutofillTaskIfEnabledActivity).toHaveBeenCalledWith({
      assetId: 'asset-text',
      teamId: 'team-1',
      projectId: 'proj-1',
    })
    expect(mockActivities.updateTaskStatusActivity).toHaveBeenLastCalledWith({
      taskId: 'task-text',
      status: 'completed',
    })
    expect(mockActivities.cleanupTmpDirActivity).toHaveBeenCalledWith({
      tmpDir: '/tmp/transcode-1',
    })
  })

  it('should fail the task and clean up when the text proxy cannot be generated', async () => {
    mockActivities.generateTextProxyActivity.mockRejectedValue(new Error('decode failed'))

    await expect(transcodeTextWorkflow(task)).rejects.toThrow('decode failed')

    expect(mockActivities.updateTaskStatusActivity).toHaveBeenLastCalledWith({
      taskId: 'task-text',
      status: 'failed',
      output: { error: 'decode failed' },
    })
    expect(mockActivities.updateAssetMediaActivity).not.toHaveBeenCalled()
    expect(mockActivities.createAutofillTaskIfEnabledActivity).not.toHaveBeenCalled()
    expect(mockActivities.cleanupTmpDirActivity).toHaveBeenCalledWith({
      tmpDir: '/tmp/transcode-1',
    })
  })
})
