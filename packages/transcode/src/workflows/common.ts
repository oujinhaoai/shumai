import type { WorkflowTask, WorkflowTaskType } from '@shumai/db'
import { executeActivity, getActivities, TaskQueueTranscode } from '@shumai/workflow-core'
import { ActivityFailure, ApplicationFailure } from '@temporalio/workflow'

/**
 * The reason to report for a failed run. Under Temporal a failed activity reaches the
 * workflow as an `ActivityFailure` ("Activity task failed") carrying the real error as
 * its cause.
 */
export function getFailureMessage(err: unknown): string {
  let current = err
  while (current instanceof ActivityFailure && current.cause) {
    current = current.cause
  }
  return current instanceof Error ? current.message : String(current)
}

export async function getWorkerQueueAndStartTask(task: WorkflowTask): Promise<string> {
  const { getTranscodeWorkerQueueActivity, updateTaskStatusActivity } = getActivities()
  const workerQueue = await executeActivity(TaskQueueTranscode, getTranscodeWorkerQueueActivity)
  await executeActivity(workerQueue, updateTaskStatusActivity, {
    taskId: task.id,
    status: 'processing',
  })
  return workerQueue
}

export async function fetchAssetWithKey(workerQueue: string, assetId: string) {
  const { getAssetActivity } = getActivities()
  const asset = await executeActivity(workerQueue, getAssetActivity, assetId)
  const key = asset?.storageKey?.key
  if (!asset || !key || asset.status === 'pending_purge') {
    throw ApplicationFailure.create({
      message: 'Asset not found, has no key, or is being purged',
      nonRetryable: true,
    })
  }
  return { asset, key }
}

export async function completeTask(
  workerQueue: string,
  taskId: string,
  output?: Record<string, unknown>,
) {
  const { updateTaskStatusActivity } = getActivities()
  await executeActivity(workerQueue, updateTaskStatusActivity, {
    taskId,
    status: 'completed',
    ...(output ? { output } : {}),
  })
}

export async function failTask(workerQueue: string, taskId: string, err: unknown) {
  const { updateTaskStatusActivity } = getActivities()
  if (workerQueue) {
    await executeActivity(workerQueue, updateTaskStatusActivity, {
      taskId,
      status: 'failed',
      output: { error: getFailureMessage(err) },
    })
  }
}

/**
 * Ends a preview transcode (image, video/audio, PDF, text) that failed for good. The
 * asset, if still `processing`, becomes `processed` with the reason in
 * `media.transcodeError` so it no longer looks stuck; then the task is marked `failed`.
 *
 * The workflow then returns normally instead of rethrowing: activities have already used
 * their retries by now, and a workflow that throws a non-Temporal error would have its
 * workflow task retried by Temporal indefinitely. The failed task is never picked up again.
 * Without a worker queue no activity can run, so the error is rethrown for the executor
 * to record.
 */
export async function finishFailedTranscode(
  workerQueue: string,
  task: WorkflowTask,
  err: unknown,
  workflowTaskType: WorkflowTaskType,
) {
  if (!workerQueue) throw err

  const { markAssetTranscodeFailedActivity } = getActivities()
  try {
    await executeActivity(workerQueue, markAssetTranscodeFailedActivity, {
      assetId: task.assetId,
      taskType: task.type ?? workflowTaskType,
      message: getFailureMessage(err),
    })
  } finally {
    await failTask(workerQueue, task.id, err)
  }
}

export async function cleanupTmpDir(workerQueue: string, tmpDir: string | undefined) {
  if (tmpDir && workerQueue) {
    const { cleanupTmpDirActivity } = getActivities()
    try {
      await executeActivity(workerQueue, cleanupTmpDirActivity, { tmpDir })
    } catch (cleanupErr) {
      console.error('Failed to cleanup tmp dir:', cleanupErr)
    }
  }
}
