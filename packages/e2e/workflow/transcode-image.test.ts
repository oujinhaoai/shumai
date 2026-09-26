import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { prisma, AssetStatus } from '@shumai/db'
import { setupTestDbHooks } from '@shumai/db/test'
import { workflowService, TaskQueueTranscode } from '@shumai/workflow-core'
import { initTranscodeWorkflows } from '@shumai/transcode'
import { s3Service } from '@shumai/core/src/s3/s3'
import { fileURLToPath } from 'url'
import * as path from 'path'
import * as fs from 'fs'
import {
  expectFailureRecorded,
  expectNotRunAgain,
  generateImage,
} from './transcode-failure-helpers'

const currentDir = path.dirname(fileURLToPath(import.meta.url))
const transcodeWorkflowsPath = path.resolve(currentDir, '../../../apps/transcode/src/workflows.ts')
const fixturesDir = path.resolve(currentDir, '../fixtures')

describe.each(['local', 'temporal'] as const)(
  'Workflow E2E - transcodeImageWorkflow (executor: %s)',
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

    it('should run transcodeMedia workflow for an image asset successfully', async () => {
      // 1. Seed Database
      const team = await prisma.team.create({
        data: { name: 'E2E Image Transcode Team' },
      })

      const project = await prisma.project.create({
        data: { name: 'E2E Image Transcode Project', teamId: team.id },
      })

      const storageKey = await prisma.storageKey.create({
        data: {
          key: 'projects/e2e/image-trans.png',
        },
      })

      const asset = await prisma.asset.create({
        data: {
          name: 'image-trans.png',
          type: 'file',
          status: 'uploaded',
          mediaType: 'image/png',
          projectId: project.id,
          storageKeyId: storageKey.id,
        },
      })

      // 2. Seed S3 Storage from Fixture
      const pngPath = path.join(fixturesDir, 'small.png')
      const pngBuffer = fs.readFileSync(pngPath)
      await s3Service.putObject(
        'shumai-e2e-test-bucket-transcode',
        'projects/e2e/image-trans.png',
        pngBuffer,
        pngBuffer.length,
        'image/png',
      )

      // 3. Create Workflow Task
      const task = await prisma.workflowTask.create({
        data: {
          type: 'transcode_image',
          status: 'pending',
          assetId: asset.id,
          projectId: project.id,
          teamId: team.id,
          payload: {
            projectId: project.id,
            transcode: {
              thumbnail: true,
            },
          },
        },
      })

      // 4. Wait for workflow to complete
      console.log(
        `Submitted E2E Image Transcode Workflow Task. ID: ${task.id}. Awaiting completion...`,
      )
      const completedTask = await workflowService.executeWait(task, 45000)

      // 5. Verification
      expect(completedTask.status).toBe('completed')

      const updatedAsset = await prisma.asset.findUnique({
        where: { id: asset.id },
      })
      expect(updatedAsset?.status).toBe(AssetStatus.processed)

      const mediaInfo = updatedAsset?.media as unknown as {
        proxyType: string
        imageTranscodes: unknown[]
        thumbnail: unknown
      }
      expect(mediaInfo).toBeDefined()
      expect(mediaInfo.proxyType).toBe('image')
      expect(mediaInfo.imageTranscodes).toBeDefined()
      expect(mediaInfo.imageTranscodes.length).toBeGreaterThan(0)
      expect(mediaInfo.thumbnail).toBeDefined()
    }, 50000)

    it('should run transcodeMedia workflow for a PSD image asset successfully', async () => {
      // 1. Seed Database
      const team = await prisma.team.create({
        data: { name: 'E2E PSD Transcode Team' },
      })

      const project = await prisma.project.create({
        data: { name: 'E2E PSD Transcode Project', teamId: team.id },
      })

      const storageKey = await prisma.storageKey.create({
        data: {
          key: 'projects/e2e/test.psd',
        },
      })

      const asset = await prisma.asset.create({
        data: {
          name: 'test.psd',
          type: 'file',
          status: 'uploaded',
          mediaType: 'image/vnd.adobe.photoshop',
          projectId: project.id,
          storageKeyId: storageKey.id,
        },
      })

      // 2. Seed S3 Storage from fixture test.psd
      const psdPath = path.join(fixturesDir, 'test.psd')
      const psdBuffer = fs.readFileSync(psdPath)
      await s3Service.putObject(
        'shumai-e2e-test-bucket-transcode',
        'projects/e2e/test.psd',
        psdBuffer,
        psdBuffer.length,
        'image/vnd.adobe.photoshop',
      )

      // 3. Create Workflow Task
      const task = await prisma.workflowTask.create({
        data: {
          type: 'transcode_image',
          status: 'pending',
          assetId: asset.id,
          projectId: project.id,
          teamId: team.id,
          payload: {
            projectId: project.id,
            transcode: {
              thumbnail: true,
            },
          },
        },
      })

      // 4. Wait for workflow to complete
      console.log(
        `Submitted E2E PSD Image Transcode Workflow Task. ID: ${task.id}. Awaiting completion...`,
      )
      const completedTask = await workflowService.executeWait(task, 45000)

      // 5. Verification
      expect(completedTask.status).toBe('completed')

      const updatedAsset = await prisma.asset.findUnique({
        where: { id: asset.id },
      })
      expect(updatedAsset?.status).toBe(AssetStatus.processed)

      const mediaInfo = updatedAsset?.media as unknown as {
        proxyType: string
        imageTranscodes: unknown[]
        thumbnail: unknown
      }
      expect(mediaInfo).toBeDefined()
      expect(mediaInfo.proxyType).toBe('image')
      expect(mediaInfo.imageTranscodes).toBeDefined()
      expect(mediaInfo.imageTranscodes.length).toBeGreaterThan(0)
      expect(mediaInfo.thumbnail).toBeDefined()
    }, 50000)

    const bucket = 'shumai-e2e-test-bucket-transcode'

    async function seedImage(
      name: string,
      mediaType: string,
      content: Buffer,
      state: { status: AssetStatus; isDeleted: boolean } = {
        status: AssetStatus.uploaded,
        isDeleted: false,
      },
    ) {
      const team = await prisma.team.create({ data: { name: `E2E Image ${name}` } })
      const project = await prisma.project.create({
        data: { name: `E2E Image ${name}`, teamId: team.id },
      })
      const key = `projects/e2e-image/${mode}/${name}`
      const storageKey = await prisma.storageKey.create({ data: { key } })
      const asset = await prisma.asset.create({
        data: {
          name,
          type: 'file',
          mediaType,
          projectId: project.id,
          storageKeyId: storageKey.id,
          ...state,
        },
      })
      await s3Service.putObject(bucket, key, content, content.length, mediaType)
      const createTask = () =>
        prisma.workflowTask.create({
          data: {
            type: 'transcode_image',
            status: 'pending',
            assetId: asset.id,
            projectId: project.id,
            teamId: team.id,
            payload: { projectId: project.id, transcode: { thumbnail: true } },
          },
        })
      return { asset, key, createTask }
    }

    it('should finish a failed transcode of a 32-bit float EXR instead of leaving it processing', async () => {
      const { asset, key, createTask } = await seedImage(
        'render.exr',
        'image/aces',
        generateImage('exr'),
      )
      const task = await createTask()

      await expect(workflowService.executeWait(task, 45000)).rejects.toThrow(
        'Input file contains unsupported image format',
      )

      await expectFailureRecorded({
        assetId: asset.id,
        taskId: task.id,
        taskType: 'transcode_image',
        message: /^Failed to get media info: Input file contains unsupported image format/,
      })
      await expectNotRunAgain(mode, task)

      // A later successful transcode of the same asset drops the recorded failure.
      const png = fs.readFileSync(path.join(fixturesDir, 'small.png'))
      await s3Service.putObject(bucket, key, png, png.length, 'image/png')
      const retry = await createTask()
      expect((await workflowService.executeWait(retry, 45000)).status).toBe('completed')

      const recovered = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
      expect(recovered.status).toBe(AssetStatus.processed)
      expect(recovered.media?.transcodeError).toBeUndefined()
      expect(recovered.media?.proxyType).toBe('image')
      expect(recovered.media?.imageTranscodes.length).toBeGreaterThan(0)
    }, 100000)

    it('should leave an asset moved to the trash while its transcode was queued in the trash', async () => {
      const { asset, createTask } = await seedImage(
        'trashed.exr',
        'image/aces',
        generateImage('exr'),
        { status: AssetStatus.trashed, isDeleted: true },
      )
      const task = await createTask()

      await expect(workflowService.executeWait(task, 45000)).rejects.toThrow(
        'Input file contains unsupported image format',
      )

      const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
      expect(after.status).toBe(AssetStatus.trashed)
      expect(after.isDeleted).toBe(true)
      expect(after.media).toBeNull()
      await expectNotRunAgain(mode, task)
    }, 60000)

    it.each([
      ['jpg', 'image/jpeg'],
      ['webp', 'image/webp'],
      ['gif', 'image/gif'],
      ['tif', 'image/tiff'],
    ] as const)(
      'should still create an image proxy for a .%s file',
      async (format, mediaType) => {
        const { asset, createTask } = await seedImage(
          `sample.${format}`,
          mediaType,
          generateImage(format),
        )
        const task = await createTask()

        expect((await workflowService.executeWait(task, 45000)).status).toBe('completed')

        const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
        expect(after.status).toBe(AssetStatus.processed)
        expect(after.media?.proxyType).toBe('image')
        expect(after.media?.imageTranscodes[0]).toMatchObject({ width: 64, height: 48 })
        expect(after.media?.thumbnail?.key).toBeTruthy()
        expect(after.media?.transcodeError).toBeUndefined()
      },
      50000,
    )
  },
)
