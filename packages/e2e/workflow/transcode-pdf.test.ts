import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { prisma, AssetStatus } from '@shumai/db'
import { setupTestDbHooks } from '@shumai/db/test'
import { workflowService, TaskQueueTranscode } from '@shumai/workflow-core'
import { initTranscodeWorkflows } from '@shumai/transcode'
import { s3Service } from '@shumai/core/src/s3/s3'
import { fileURLToPath } from 'url'
import * as path from 'path'
import * as fs from 'fs'
import { expectFailureRecorded, expectNotRunAgain } from './transcode-failure-helpers'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const transcodeWorkflowsPath = path.resolve(currentDir, '../../../apps/transcode/src/workflows.ts')
const fixturesDir = path.resolve(currentDir, '../fixtures')

describe.each(['local', 'temporal'] as const)(
  'Workflow E2E - transcodePdfWorkflow (executor: %s)',
  (mode) => {
    setupTestDbHooks()

    let transcodeWorkerPromise: Promise<void> | null = null

    beforeAll(async () => {
      process.env.S3_BUCKET = 'shumai-e2e-test-bucket-transcode'

      workflowService.setExecutorType(mode)
      initTranscodeWorkflows()

      if (mode === 'temporal') {
        console.log('Starting background worker for transcode Temporal E2E tests...')
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
        console.log('Cleaning up local E2E storage files...')
        await s3Service.deletePrefix('shumai-e2e-test-bucket-transcode', '')
      } catch (err) {
        console.error('Failed to clean up E2E storage folder:', err)
      }
    })

    it('should run transcodeMedia workflow for a PDF asset successfully', async () => {
      // 1. Seed Database
      const team = await prisma.team.create({
        data: { name: 'E2E PDF Transcode Team' },
      })

      const project = await prisma.project.create({
        data: { name: 'E2E PDF Transcode Project', teamId: team.id },
      })

      const storageKey = await prisma.storageKey.create({
        data: {
          key: 'projects/e2e/test.pdf',
        },
      })

      const asset = await prisma.asset.create({
        data: {
          name: 'test.pdf',
          type: 'file',
          status: 'uploaded',
          mediaType: 'application/pdf',
          projectId: project.id,
          storageKeyId: storageKey.id,
        },
      })

      // 2. Seed S3 Storage from fixture test.pdf
      const pdfPath = path.join(fixturesDir, 'test.pdf')
      const pdfBuffer = fs.readFileSync(pdfPath)
      await s3Service.putObject(
        'shumai-e2e-test-bucket-transcode',
        'projects/e2e/test.pdf',
        pdfBuffer,
        pdfBuffer.length,
        'application/pdf',
      )

      // 3. Create Workflow Task
      const task = await prisma.workflowTask.create({
        data: {
          type: 'transcode_pdf',
          status: 'pending',
          assetId: asset.id,
          projectId: project.id,
          teamId: team.id,
          payload: {
            projectId: project.id,
            transcode: {
              poster: true,
              sprite: true,
            },
          },
        },
      })

      // 4. Wait for workflow to complete
      console.log(
        `Submitted E2E PDF Transcode Workflow Task. ID: ${task.id}. Awaiting completion...`,
      )
      const completedTask = await workflowService.executeWait(task, 45000)

      // 5. Verification
      expect(completedTask.status).toBe('completed')

      // Verify Asset status is updated to processed
      const updatedAsset = await prisma.asset.findUnique({
        where: { id: asset.id },
      })
      expect(updatedAsset?.status).toBe(AssetStatus.processed)

      // Verify media info contains pdf details, poster, sprite, and pageCount
      const mediaInfo = updatedAsset?.media as unknown as {
        proxyType: string
        poster: { key: string }
        sprite: { key: string }
        frames?: number
        pageCount?: number
        metadata?: { totalFrames?: number; pageCount?: number }
      }
      expect(mediaInfo).toBeDefined()
      expect(mediaInfo.proxyType).toBe('pdf')
      expect(mediaInfo.poster).toBeDefined()
      expect(mediaInfo.poster.key).toContain('poster.webp')
      expect(mediaInfo.sprite).toBeDefined()
      expect(mediaInfo.sprite.key).toContain('sprite.webp')
      expect(mediaInfo.frames ?? mediaInfo.metadata?.totalFrames).toBeGreaterThan(0)
    }, 50000)

    it('should run transcodeMedia workflow for a TXT asset with CJK text to generate PDF proxy successfully', async () => {
      // 1. Seed Database
      const team = await prisma.team.create({
        data: { name: 'E2E CJK TXT Transcode Team' },
      })

      const project = await prisma.project.create({
        data: { name: 'E2E CJK TXT Transcode Project', teamId: team.id },
      })

      const storageKey = await prisma.storageKey.create({
        data: {
          key: 'projects/e2e/cjk-test.txt',
        },
      })

      const asset = await prisma.asset.create({
        data: {
          name: 'cjk-test.txt',
          type: 'file',
          status: 'uploaded',
          mediaType: 'text/plain',
          projectId: project.id,
          storageKeyId: storageKey.id,
        },
      })

      // 2. Seed S3 Storage with CJK text
      const cjkText =
        'Hello World\n你好世界 (Chinese)\nこんにちは世界 (Japanese)\n안녕하세요世界 (Korean)\nLine 5 of random text.'
      const txtBuffer = Buffer.from(cjkText, 'utf-8')
      await s3Service.putObject(
        'shumai-e2e-test-bucket-transcode',
        'projects/e2e/cjk-test.txt',
        txtBuffer,
        txtBuffer.length,
        'text/plain',
      )

      // 3. Create Workflow Task
      const task = await prisma.workflowTask.create({
        data: {
          type: 'transcode_pdf',
          status: 'pending',
          assetId: asset.id,
          projectId: project.id,
          teamId: team.id,
          payload: {
            projectId: project.id,
            transcode: {
              poster: true,
              sprite: true,
            },
          },
        },
      })

      // 4. Wait for workflow to complete
      console.log(
        `Submitted E2E CJK TXT Transcode Workflow Task. ID: ${task.id}. Awaiting completion...`,
      )
      const completedTask = await workflowService.executeWait(task, 45000)

      // 5. Verification
      expect(completedTask.status).toBe('completed')

      const updatedAsset = await prisma.asset.findUnique({
        where: { id: asset.id },
      })
      expect(updatedAsset?.status).toBe(AssetStatus.processed)

      const mediaInfo = updatedAsset?.media as unknown as {
        proxyType?: string
        pdfTranscode?: { key: string }
        poster?: { key: string }
        sprite?: { key: string }
        frames?: number
      }
      expect(mediaInfo).toBeDefined()
      expect(mediaInfo.proxyType).toBe('pdf')
      expect(mediaInfo.pdfTranscode?.key).toBe('projects/e2e/proxy.pdf')
      expect(mediaInfo.poster?.key).toContain('poster.webp')
      expect(mediaInfo.sprite?.key).toContain('sprite.webp')
      expect(mediaInfo.frames).toBeGreaterThan(0)
    }, 50000)

    it('should process markdown (.md) transcode PDF task correctly', async () => {
      // 1. Create Team, Project, Asset & StorageKey
      const team = await prisma.team.create({
        data: { name: 'E2E MD Transcode Team' },
      })

      const project = await prisma.project.create({
        data: { name: 'E2E MD Transcode Project', teamId: team.id },
      })

      const storageKey = await prisma.storageKey.create({
        data: {
          key: 'projects/e2e/doc.md',
          status: 'active',
        },
      })

      const asset = await prisma.asset.create({
        data: {
          name: 'doc.md',
          type: 'file',
          status: 'uploaded',
          mediaType: 'text/markdown',
          projectId: project.id,
          storageKeyId: storageKey.id,
        },
      })

      // 2. Seed S3 Storage with Markdown text
      const mdText = '# Heading\n\nThis is a **markdown** document to be rendered to PDF proxy.'
      const mdBuffer = Buffer.from(mdText, 'utf-8')
      await s3Service.putObject(
        'shumai-e2e-test-bucket-transcode',
        'projects/e2e/doc.md',
        mdBuffer,
        mdBuffer.length,
        'text/markdown',
      )

      // 3. Create Workflow Task
      const task = await prisma.workflowTask.create({
        data: {
          type: 'transcode_pdf',
          status: 'pending',
          assetId: asset.id,
          projectId: project.id,
          teamId: team.id,
          payload: {
            projectId: project.id,
            transcode: {
              poster: true,
              sprite: true,
            },
          },
        },
      })

      // 4. Wait for workflow to complete
      console.log(
        `Submitted E2E MD Transcode Workflow Task. ID: ${task.id}. Awaiting completion...`,
      )
      const completedTask = await workflowService.executeWait(task, 45000)

      // 5. Verification
      expect(completedTask.status).toBe('completed')

      const updatedAsset = await prisma.asset.findUnique({
        where: { id: asset.id },
      })
      expect(updatedAsset?.status).toBe(AssetStatus.processed)

      const mediaInfo = updatedAsset?.media as unknown as {
        proxyType?: string
        pdfTranscode?: { key: string }
        poster?: { key: string }
        sprite?: { key: string }
        frames?: number
      }
      expect(mediaInfo).toBeDefined()
      expect(mediaInfo.proxyType).toBe('pdf')
      expect(mediaInfo.pdfTranscode?.key).toBe('projects/e2e/proxy.pdf')
      expect(mediaInfo.poster?.key).toContain('poster.webp')
      expect(mediaInfo.sprite?.key).toContain('sprite.webp')
      expect(mediaInfo.frames).toBeGreaterThan(0)
    }, 50000)

    const bucket = 'shumai-e2e-test-bucket-transcode'

    /** A PDF asset whose upload never reached storage, so downloading it fails for good. */
    async function seedMissingPdf(
      name: string,
      state: { status: AssetStatus; isDeleted: boolean } = {
        status: AssetStatus.uploaded,
        isDeleted: false,
      },
    ) {
      const team = await prisma.team.create({ data: { name: `E2E PDF ${name}` } })
      const project = await prisma.project.create({
        data: { name: `E2E PDF ${name}`, teamId: team.id },
      })
      const key = `projects/e2e-pdf-failure/${mode}/${name}`
      const storageKey = await prisma.storageKey.create({ data: { key } })
      const asset = await prisma.asset.create({
        data: {
          name,
          type: 'file',
          mediaType: 'application/pdf',
          projectId: project.id,
          storageKeyId: storageKey.id,
          ...state,
        },
      })
      const createTask = () =>
        prisma.workflowTask.create({
          data: {
            type: 'transcode_pdf',
            status: 'pending',
            assetId: asset.id,
            projectId: project.id,
            teamId: team.id,
            payload: { projectId: project.id, transcode: { sprite: true, poster: true } },
          },
        })
      return { asset, key, createTask }
    }

    it('should finish a failed PDF transcode instead of leaving the asset processing', async () => {
      const { asset, key, createTask } = await seedMissingPdf('missing.pdf')
      const task = await createTask()

      await expect(workflowService.executeWait(task, 45000)).rejects.toThrow(
        'Failed to download media to tmp',
      )

      await expectFailureRecorded({
        assetId: asset.id,
        taskId: task.id,
        taskType: 'transcode_pdf',
        message: /^Failed to download media to tmp: /,
      })
      await expectNotRunAgain(mode, task)

      // Once the file is there, a later successful transcode drops the recorded failure.
      const pdf = fs.readFileSync(path.join(fixturesDir, 'test.pdf'))
      await s3Service.putObject(bucket, key, pdf, pdf.length, 'application/pdf')
      const retry = await createTask()
      expect((await workflowService.executeWait(retry, 45000)).status).toBe('completed')

      const recovered = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
      expect(recovered.status).toBe(AssetStatus.processed)
      expect(recovered.media?.transcodeError).toBeUndefined()
      expect(recovered.media?.proxyType).toBe('pdf')
      expect(recovered.media?.pdfTranscode?.key).toBeTruthy()
    }, 100000)

    it('should leave an asset moved to the trash while its transcode was queued in the trash', async () => {
      const { asset, createTask } = await seedMissingPdf('trashed.pdf', {
        status: AssetStatus.trashed,
        isDeleted: true,
      })
      const task = await createTask()

      await expect(workflowService.executeWait(task, 45000)).rejects.toThrow(
        'Failed to download media to tmp',
      )

      const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
      expect(after.status).toBe(AssetStatus.trashed)
      expect(after.isDeleted).toBe(true)
      expect(after.media).toBeNull()
      await expectNotRunAgain(mode, task)
    }, 60000)
  },
)
