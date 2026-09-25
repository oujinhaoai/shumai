import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { prisma, AssetStatus } from '@shumai/db'
import { setupTestDbHooks } from '@shumai/db/test'
import { workflowService, TaskQueueTranscode } from '@shumai/workflow-core'
import { initTranscodeWorkflows } from '@shumai/transcode'
import { s3Service } from '@shumai/core/src/s3/s3'
import { fileURLToPath } from 'url'
import * as path from 'path'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const transcodeWorkflowsPath = path.resolve(currentDir, '../../../apps/transcode/src/workflows.ts')
const bucket = 'shumai-e2e-test-bucket-transcode-text'

describe.each(['local', 'temporal'] as const)(
  'Workflow E2E - transcodeTextWorkflow (executor: %s)',
  (mode) => {
    setupTestDbHooks()

    let transcodeWorkerPromise: Promise<void> | null = null

    beforeAll(async () => {
      process.env.S3_BUCKET = bucket

      workflowService.setExecutorType(mode)
      initTranscodeWorkflows()

      if (mode === 'temporal') {
        console.log('Starting background worker for transcode text Temporal E2E tests...')
        transcodeWorkerPromise = workflowService.startWorkers(TaskQueueTranscode, {
          workflowsPath: transcodeWorkflowsPath,
        })
        await new Promise((resolve) => setTimeout(resolve, 2000))
      } else {
        console.log('Starting local workflow service polling...')
        workflowService.start()
      }
    })

    afterAll(async () => {
      if (mode === 'temporal') {
        console.log('Shutting down Temporal workers...')
        await workflowService.shutdownWorkers()
        await Promise.all([transcodeWorkerPromise].filter(Boolean))
      }
      workflowService.close()
      vi.restoreAllMocks()
      try {
        await s3Service.deletePrefix(bucket, '')
      } catch (err) {
        console.error('Failed to clean up E2E storage folder:', err)
      }
    })

    async function seedTextAsset(name: string, mediaType: string, content: Uint8Array) {
      const team = await prisma.team.create({ data: { name: `E2E Text Team ${name}` } })
      const project = await prisma.project.create({
        data: { name: `E2E Text Project ${name}`, teamId: team.id },
      })
      const key = `projects/e2e-text/${mode}/${name}`
      const storageKey = await prisma.storageKey.create({ data: { key } })
      const asset = await prisma.asset.create({
        data: {
          name,
          type: 'file',
          status: 'uploaded',
          mediaType,
          projectId: project.id,
          storageKeyId: storageKey.id,
        },
      })
      await s3Service.putObject(bucket, key, content, content.length, mediaType)

      const task = await prisma.workflowTask.create({
        data: {
          type: 'transcode_text',
          status: 'pending',
          assetId: asset.id,
          projectId: project.id,
          teamId: team.id,
          payload: { projectId: project.id, transcode: {} },
        },
      })
      return { asset, key, task }
    }

    it('should store a UTF-8 text proxy for a Markdown asset instead of a PDF', async () => {
      const markdown = '# Release notes\r\n\r\n- 修复预览问题\r\n- Second item\r\n'
      const { asset, key, task } = await seedTextAsset(
        'notes.md',
        'text/markdown',
        Buffer.from(markdown, 'utf-8'),
      )

      const completedTask = await workflowService.executeWait(task, 45000)
      expect(completedTask.status).toBe('completed')

      const updatedAsset = await prisma.asset.findUnique({ where: { id: asset.id } })
      expect(updatedAsset?.status).toBe(AssetStatus.processed)

      const media = updatedAsset?.media as PrismaJson.MediaInfo | null
      expect(media?.proxyType).toBe('text')
      expect(media?.pdfTranscode).toBeUndefined()
      expect(media?.sprite).toBeUndefined()
      expect(media?.original?.key).toBe(key)
      expect(media?.textTranscode).toEqual({
        key: `projects/e2e-text/${mode}/proxy.txt`,
        encoding: 'utf-8',
        lineCount: 4,
        truncated: false,
        format: 'markdown',
      })

      const proxy = await s3Service.getObject(bucket, media!.textTranscode!.key!)
      expect(proxy.buffer.toString('utf-8')).toBe(
        '# Release notes\n\n- 修复预览问题\n- Second item\n',
      )

      const proxyTypeValue = await prisma.assetMetadataValue.findUnique({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        where: { assetId_fieldKey: { assetId: asset.id, fieldKey: 'proxy_type' } },
      })
      expect(proxyTypeValue?.stringValue).toBe('text')
    }, 50000)

    it('should convert a GBK encoded text file to a UTF-8 proxy', async () => {
      // "第一行\n第二行" encoded as GBK
      const gbk = new Uint8Array([
        0xb5, 0xda, 0xd2, 0xbb, 0xd0, 0xd0, 0x0a, 0xb5, 0xda, 0xb6, 0xfe, 0xd0, 0xd0,
      ])
      const { asset, task } = await seedTextAsset('gbk.txt', 'text/plain', gbk)

      const completedTask = await workflowService.executeWait(task, 45000)
      expect(completedTask.status).toBe('completed')

      const updatedAsset = await prisma.asset.findUnique({ where: { id: asset.id } })
      const media = updatedAsset?.media as PrismaJson.MediaInfo | null
      expect(media?.proxyType).toBe('text')
      expect(media?.textTranscode?.encoding).toBe('gb18030')
      expect(media?.textTranscode?.lineCount).toBe(2)
      expect(media?.textTranscode?.format).toBe('plain')

      const proxy = await s3Service.getObject(bucket, media!.textTranscode!.key!)
      expect(proxy.buffer.toString('utf-8')).toBe('第一行\n第二行')
    }, 50000)
  },
)
