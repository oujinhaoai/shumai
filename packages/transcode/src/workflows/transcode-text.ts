import type { WorkflowTask } from '@shumai/db'
import '@shumai/db/src/prisma-json-types'
import { executeActivity, getActivities } from '@shumai/workflow-core'
import {
  getWorkerQueueAndStartTask,
  fetchAssetWithKey,
  completeTask,
  failTask,
  cleanupTmpDir,
} from './common'

/**
 * Prepares a Markdown, plain-text, code or config upload for the raw text preview:
 * stores a UTF-8 text proxy instead of converting the file to PDF. Binary uploads
 * (NUL characters) end up processed without a proxy.
 */
export async function transcodeTextWorkflow(task: WorkflowTask): Promise<void> {
  let tmpDir: string | undefined
  let workerQueue = ''

  try {
    workerQueue = await getWorkerQueueAndStartTask(task)

    const {
      updateAssetStatusActivity,
      getMediaInfoActivity,
      updateAssetMediaActivity,
      downloadMediaToTmpActivity,
      generateTextProxyActivity,
      createEmbeddingTaskIfEnabledActivity,
      createAutofillTaskIfEnabledActivity,
    } = getActivities()

    await executeActivity(workerQueue, updateAssetStatusActivity, {
      assetId: task.assetId,
      status: 'processing',
    })

    const { asset, key } = await fetchAssetWithKey(workerQueue, task.assetId)

    const download = await executeActivity(workerQueue, downloadMediaToTmpActivity, {
      assetKey: key,
    })
    tmpDir = download.tmpDir

    const textProxy = await executeActivity(workerQueue, generateTextProxyActivity, {
      assetId: asset.id,
      assetKey: key,
      filePath: download.filePath,
      mediaType: asset.mediaType || '',
      filename: asset.name || '',
    })

    if ('binary' in textProxy) {
      // Binary data has no text preview: finish like any file without a preview
      // rather than failing, which would leave the asset stuck in processing.
      await executeActivity(workerQueue, updateAssetStatusActivity, {
        assetId: asset.id,
        status: 'processed',
      })
      await completeTask(workerQueue, task.id, { skipped: 'binary' })
      return
    }

    const mediaInfo = await executeActivity(workerQueue, getMediaInfoActivity, {
      filePath: textProxy.textFilePath,
      assetId: asset.id,
      proxyType: 'text',
      mediaType: asset.mediaType || '',
    })

    mediaInfo.original = {
      key,
      filesizeInBytes: 0,
      codec: '',
    }
    mediaInfo.textTranscode = {
      key: textProxy.textProxyKey,
      encoding: textProxy.encoding,
      lineCount: textProxy.lineCount,
      truncated: textProxy.truncated,
      format: textProxy.format,
    }

    await executeActivity(workerQueue, updateAssetMediaActivity, {
      assetId: asset.id,
      mediaInfo,
    })

    await executeActivity(workerQueue, updateAssetStatusActivity, {
      assetId: asset.id,
      status: 'processed',
    })

    await executeActivity(workerQueue, createEmbeddingTaskIfEnabledActivity, {
      assetId: asset.id,
      teamId: task.teamId,
      projectId: task.projectId,
    })

    await executeActivity(workerQueue, createAutofillTaskIfEnabledActivity, {
      assetId: asset.id,
      teamId: task.teamId,
      projectId: task.projectId,
    })

    await completeTask(workerQueue, task.id)
  } catch (err) {
    console.error(`transcodeTextWorkflow failed for task ${task.id}:`, err)
    await failTask(workerQueue, task.id, err)
    throw err
  } finally {
    await cleanupTmpDir(workerQueue, tmpDir)
  }
}
