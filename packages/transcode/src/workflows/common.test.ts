import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ActivityFailure, ApplicationFailure } from '@temporalio/workflow'
import { WorkflowTask, WorkflowTaskStatus, WorkflowTaskType } from '@shumai/db'
import * as workflowUtils from '@shumai/workflow-core'
import { finishFailedTranscode, getFailureMessage } from './common'

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

const unsupportedFormat = 'Failed to get media info: Input file contains unsupported image format'

function activityFailure(cause: Error) {
  return new ActivityFailure(
    'Activity task failed',
    'getMediaInfoActivity',
    '7',
    'NON_RETRYABLE_FAILURE',
    'transcode-worker',
    cause,
  )
}

describe('getFailureMessage', () => {
  it('uses the message of plain errors and non-errors', () => {
    expect(getFailureMessage(new Error('ffprobe exited with code 1'))).toBe(
      'ffprobe exited with code 1',
    )
    expect(getFailureMessage('boom')).toBe('boom')
  })

  it('reports the cause of an activity failure rather than "Activity task failed"', () => {
    const cause = ApplicationFailure.create({ message: unsupportedFormat, nonRetryable: true })
    expect(getFailureMessage(activityFailure(cause))).toBe(unsupportedFormat)
  })
})

describe('finishFailedTranscode', () => {
  const mockActivities = {
    updateTaskStatusActivity: Object.assign(vi.fn(), {
      _activityName: 'updateTaskStatusActivity',
    }),
    markAssetTranscodeFailedActivity: Object.assign(vi.fn(), {
      _activityName: 'markAssetTranscodeFailedActivity',
    }),
  }

  const task: WorkflowTask = {
    id: 'task-image',
    assetId: 'asset-image',
    type: WorkflowTaskType.transcode_image,
    status: WorkflowTaskStatus.processing,
    sessionId: null,
    output: null,
    payload: { projectId: 'proj-1', transcode: {} },
    createdAt: new Date(),
    updatedAt: new Date(),
    heartbeat: null,
    teamId: 'team-1',
    projectId: 'proj-1',
    uid: 'task-uid-image',
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
      (_queue: string, fn: any, ...args: any[]) => fn(...args),
    )
    mockActivities.markAssetTranscodeFailedActivity.mockResolvedValue(true)
    mockActivities.updateTaskStatusActivity.mockResolvedValue(undefined)
  })

  it('records the failure on the asset before marking the task failed', async () => {
    const cause = ApplicationFailure.create({ message: unsupportedFormat, nonRetryable: true })

    await finishFailedTranscode('worker-queue', task, activityFailure(cause), 'transcode_image')

    expect(mockActivities.markAssetTranscodeFailedActivity).toHaveBeenCalledWith({
      assetId: 'asset-image',
      taskType: 'transcode_image',
      message: unsupportedFormat,
    })
    expect(mockActivities.updateTaskStatusActivity).toHaveBeenCalledWith({
      taskId: 'task-image',
      status: 'failed',
      output: { error: unsupportedFormat },
    })
    expect(
      mockActivities.markAssetTranscodeFailedActivity.mock.invocationCallOrder[0],
    ).toBeLessThan(mockActivities.updateTaskStatusActivity.mock.invocationCallOrder[0])
  })

  it('falls back to the workflow task type for tasks stored without one', async () => {
    await finishFailedTranscode(
      'worker-queue',
      { ...task, type: null },
      new Error('boom'),
      'transcode_video',
    )

    expect(mockActivities.markAssetTranscodeFailedActivity).toHaveBeenCalledWith({
      assetId: 'asset-image',
      taskType: 'transcode_video',
      message: 'boom',
    })
  })

  it('rethrows when no worker queue was obtained, leaving the failure to the executor', async () => {
    const err = new Error('queue lookup failed')

    await expect(finishFailedTranscode('', task, err, 'transcode_image')).rejects.toBe(err)

    expect(mockActivities.markAssetTranscodeFailedActivity).not.toHaveBeenCalled()
    expect(mockActivities.updateTaskStatusActivity).not.toHaveBeenCalled()
  })

  it('still marks the task failed when recording the failure on the asset fails', async () => {
    mockActivities.markAssetTranscodeFailedActivity.mockRejectedValue(new Error('db unavailable'))

    await expect(
      finishFailedTranscode('worker-queue', task, new Error('boom'), 'transcode_image'),
    ).rejects.toThrow('db unavailable')

    expect(mockActivities.updateTaskStatusActivity).toHaveBeenCalledWith({
      taskId: 'task-image',
      status: 'failed',
      output: { error: 'boom' },
    })
  })
})
