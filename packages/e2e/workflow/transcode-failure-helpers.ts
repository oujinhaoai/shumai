import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { expect } from 'vitest'
import { prisma, AssetStatus, WorkflowTaskStatus, type WorkflowTask } from '@shumai/db'
import { LocalExecutor, TemporalExecutor } from '@shumai/workflow-core'

/**
 * Renders a 64x48 test picture with ffmpeg, so no binary fixture has to be committed.
 * `exr` gives an OpenEXR image with 32-bit float channels, the kind of file that used to
 * stay in processing forever.
 */
export function generateImage(format: 'exr' | 'jpg' | 'webp' | 'gif' | 'tif'): Buffer {
  const codecArgs: Record<typeof format, string[]> = {
    exr: ['-pix_fmt', 'gbrpf32le', '-c:v', 'exr', '-format', 'float'],
    jpg: ['-pix_fmt', 'yuvj420p', '-c:v', 'mjpeg'],
    webp: ['-c:v', 'libwebp'],
    gif: ['-c:v', 'gif'],
    tif: ['-pix_fmt', 'rgb24', '-c:v', 'tiff'],
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-image-'))
  try {
    const output = path.join(dir, `sample.${format}`)
    execFileSync('ffmpeg', [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-f',
      'lavfi',
      '-i',
      'testsrc2=size=64x48:rate=1',
      '-frames:v',
      '1',
      ...codecArgs[format],
      output,
    ])
    return fs.readFileSync(output)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

/**
 * Checks what a transcode that failed for good leaves behind: the task is failed and the
 * asset is processed, with the reason in `media.transcodeError`.
 */
export async function expectFailureRecorded(params: {
  assetId: string
  taskId: string
  taskType: string
  message: RegExp
}) {
  const task = await prisma.workflowTask.findUniqueOrThrow({ where: { id: params.taskId } })
  expect(task.status).toBe(WorkflowTaskStatus.failed)
  expect((task.output as { error?: string } | null)?.error).toMatch(params.message)

  const asset = await prisma.asset.findUniqueOrThrow({ where: { id: params.assetId } })
  expect(asset.status).toBe(AssetStatus.processed)
  const transcodeError = asset.media?.transcodeError
  expect(transcodeError?.taskType).toBe(params.taskType)
  expect(transcodeError?.message).toMatch(params.message)
  expect(transcodeError?.message.length).toBeLessThanOrEqual(500)
  expect(new Date(transcodeError?.failedAt ?? '').toISOString()).toBe(transcodeError?.failedAt)
  return asset
}

interface WorkflowHistoryClient {
  workflow: {
    getHandle(workflowId: string): {
      describe(): Promise<{ status: { name: string } }>
      fetchHistory(): Promise<{
        events?: { workflowTaskFailedEventAttributes?: unknown }[] | null
      }>
    }
  }
}

/**
 * Checks that a failed transcode is not run again: the local executor's next poll does not
 * pick the task up, and under Temporal the workflow completed without a single failed
 * workflow task (Temporal retries those forever, re-running the workflow code).
 */
export async function expectNotRunAgain(mode: 'local' | 'temporal', task: WorkflowTask) {
  if (mode === 'local') {
    expect(await new LocalExecutor().tick()).toEqual([])
  } else {
    const executor = new TemporalExecutor(process.env.TEMPORAL_ADDRESS)
    try {
      // The executor keeps its client private; the test only reads the workflow's state.
      const client = await (
        executor as unknown as { getClient(): Promise<WorkflowHistoryClient> }
      ).getClient()
      const handle = client.workflow.getHandle(`${task.type}-${task.id}`)

      // The task is marked failed before the workflow cleans up its temporary files.
      let status = (await handle.describe()).status.name
      for (let i = 0; status === 'RUNNING' && i < 50; i++) {
        await new Promise((resolve) => setTimeout(resolve, 200))
        status = (await handle.describe()).status.name
      }
      expect(status).toBe('COMPLETED')

      const history = await handle.fetchHistory()
      expect(history.events?.some((event) => event.workflowTaskFailedEventAttributes)).toBe(false)
    } finally {
      executor.close()
    }
  }

  const after = await prisma.workflowTask.findUniqueOrThrow({ where: { id: task.id } })
  expect(after.status).toBe(WorkflowTaskStatus.failed)
}
