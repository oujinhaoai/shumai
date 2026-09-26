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
  'Workflow E2E - transcodeVideoWorkflow (executor: %s)',
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

    it('should run transcodeMedia workflow for a video asset successfully', async () => {
      // 1. Seed Database
      const team = await prisma.team.create({
        data: { name: 'E2E Video Transcode Team' },
      })

      const project = await prisma.project.create({
        data: { name: 'E2E Video Transcode Project', teamId: team.id },
      })

      const storageKey = await prisma.storageKey.create({
        data: {
          key: 'projects/e2e/video-trans.mp4',
        },
      })

      const asset = await prisma.asset.create({
        data: {
          name: 'video-trans.mp4',
          type: 'file',
          status: 'uploaded',
          mediaType: 'video/mp4',
          projectId: project.id,
          storageKeyId: storageKey.id,
        },
      })

      // 2. Seed S3 Storage from Fixture
      const mp4Path = path.join(fixturesDir, 'small.mp4')
      const mp4Buffer = fs.readFileSync(mp4Path)
      await s3Service.putObject(
        'shumai-e2e-test-bucket-transcode',
        'projects/e2e/video-trans.mp4',
        mp4Buffer,
        mp4Buffer.length,
        'video/mp4',
      )

      // 3. Create Workflow Task
      const task = await prisma.workflowTask.create({
        data: {
          type: 'transcode_video',
          status: 'pending',
          assetId: asset.id,
          projectId: project.id,
          teamId: team.id,
          payload: {
            projectId: project.id,
            transcode: {
              videoStrategy: 'best_match',
              thumbnail: false,
              poster: true,
              sprite: true,
            },
          },
        },
      })

      // 4. Wait for workflow to complete
      console.log(
        `Submitted E2E Video Transcode Workflow Task. ID: ${task.id}. Awaiting completion...`,
      )
      const completedTask = await workflowService.executeWait(task, 45000)

      // 5. Verification
      expect(completedTask.status).toBe('completed')

      // Verify Asset status is updated to processed
      const updatedAsset = await prisma.asset.findUnique({
        where: { id: asset.id },
      })
      expect(updatedAsset?.status).toBe(AssetStatus.processed)

      // Verify media info contains videoTranscodes, poster, sprite, and duration details
      const mediaInfo = updatedAsset?.media as unknown as {
        proxyType: string
        duration: number
        videoTranscodes: { key: string }[]
        poster: unknown
        sprite: unknown
      }
      expect(mediaInfo).toBeDefined()
      expect(mediaInfo.proxyType).toBe('video')
      expect(mediaInfo.duration).toBeCloseTo(1.0, 1)
      expect(mediaInfo.videoTranscodes).toBeDefined()
      expect(mediaInfo.videoTranscodes.length).toBeGreaterThan(0)
      expect(mediaInfo.poster).toBeDefined()
      expect(mediaInfo.sprite).toBeDefined()
    }, 50000)

    it('should run transcodeMedia workflow for an audio asset successfully', async () => {
      // 1. Seed Database
      const team = await prisma.team.create({
        data: { name: 'E2E Audio Transcode Team' },
      })

      const project = await prisma.project.create({
        data: { name: 'E2E Audio Transcode Project', teamId: team.id },
      })

      const storageKey = await prisma.storageKey.create({
        data: {
          key: 'projects/e2e/audio-trans.wav',
        },
      })

      const asset = await prisma.asset.create({
        data: {
          name: 'audio-trans.wav',
          type: 'file',
          status: 'uploaded',
          mediaType: 'audio/wav',
          projectId: project.id,
          storageKeyId: storageKey.id,
        },
      })

      // 2. Seed S3 Storage from Fixture
      const wavPath = path.join(fixturesDir, 'small.wav')
      const wavBuffer = fs.readFileSync(wavPath)
      await s3Service.putObject(
        'shumai-e2e-test-bucket-transcode',
        'projects/e2e/audio-trans.wav',
        wavBuffer,
        wavBuffer.length,
        'audio/wav',
      )

      // 3. Create Workflow Task
      const task = await prisma.workflowTask.create({
        data: {
          type: 'transcode_video',
          status: 'pending',
          assetId: asset.id,
          projectId: project.id,
          teamId: team.id,
          payload: {
            projectId: project.id,
            transcode: {},
          },
        },
      })

      // 4. Wait for workflow to complete
      console.log(
        `Submitted E2E Audio Transcode Workflow Task. ID: ${task.id}. Awaiting completion...`,
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
        videoTranscodes: { key: string }[]
      }
      expect(mediaInfo).toBeDefined()
      expect(mediaInfo.proxyType).toBe('audio')
      expect(mediaInfo.videoTranscodes).toBeDefined()
      expect(mediaInfo.videoTranscodes.length).toBeGreaterThan(0)
      // Audio proxy key should end with -audio-proxy.mp4
      expect(mediaInfo.videoTranscodes[0].key).toContain('-audio-proxy.mp4')
    }, 50000)

    const bucket = 'shumai-e2e-test-bucket-transcode'
    // Not a video: ffprobe cannot read it, so the transcode fails for good.
    const garbage = Buffer.from('this is not a video stream '.repeat(64))

    async function seedVideo(
      name: string,
      content: Buffer,
      state: { status: AssetStatus; isDeleted: boolean } = {
        status: AssetStatus.uploaded,
        isDeleted: false,
      },
    ) {
      const team = await prisma.team.create({ data: { name: `E2E Video ${name}` } })
      const project = await prisma.project.create({
        data: { name: `E2E Video ${name}`, teamId: team.id },
      })
      const key = `projects/e2e-video/${mode}/${name}`
      const storageKey = await prisma.storageKey.create({ data: { key } })
      const asset = await prisma.asset.create({
        data: {
          name,
          type: 'file',
          mediaType: 'video/mp4',
          projectId: project.id,
          storageKeyId: storageKey.id,
          ...state,
        },
      })
      await s3Service.putObject(bucket, key, content, content.length, 'video/mp4')
      const createTask = () =>
        prisma.workflowTask.create({
          data: {
            type: 'transcode_video',
            status: 'pending',
            assetId: asset.id,
            projectId: project.id,
            teamId: team.id,
            payload: {
              projectId: project.id,
              transcode: { videoStrategy: 'best_match', poster: true, sprite: true },
            },
          },
        })
      return { asset, key, createTask }
    }

    it('should finish a failed video transcode instead of leaving the asset processing', async () => {
      const { asset, key, createTask } = await seedVideo('broken.mp4', garbage)
      const task = await createTask()

      await expect(workflowService.executeWait(task, 45000)).rejects.toThrow(
        'Failed to get media info',
      )

      await expectFailureRecorded({
        assetId: asset.id,
        taskId: task.id,
        taskType: 'transcode_video',
        message: /^Failed to get media info: /,
      })
      await expectNotRunAgain(mode, task)

      // A later successful transcode of the same asset drops the recorded failure.
      const mp4 = fs.readFileSync(path.join(fixturesDir, 'small.mp4'))
      await s3Service.putObject(bucket, key, mp4, mp4.length, 'video/mp4')
      const retry = await createTask()
      expect((await workflowService.executeWait(retry, 45000)).status).toBe('completed')

      const recovered = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
      expect(recovered.status).toBe(AssetStatus.processed)
      expect(recovered.media?.transcodeError).toBeUndefined()
      expect(recovered.media?.proxyType).toBe('video')
      expect(recovered.media?.videoTranscodes.length).toBeGreaterThan(0)
    }, 100000)

    it('should leave an asset moved to the trash while its transcode was queued in the trash', async () => {
      const { asset, createTask } = await seedVideo('trashed.mp4', garbage, {
        status: AssetStatus.trashed,
        isDeleted: true,
      })
      const task = await createTask()

      await expect(workflowService.executeWait(task, 45000)).rejects.toThrow(
        'Failed to get media info',
      )

      const after = await prisma.asset.findUniqueOrThrow({ where: { id: asset.id } })
      expect(after.status).toBe(AssetStatus.trashed)
      expect(after.isDeleted).toBe(true)
      expect(after.media).toBeNull()
      await expectNotRunAgain(mode, task)
    }, 60000)
  },
)
