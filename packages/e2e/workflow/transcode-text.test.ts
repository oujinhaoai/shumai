import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { prisma, AssetStatus, AssetType, WorkflowTaskType } from '@shumai/db'
import { setupTestDbHooks } from '@shumai/db/test'
import { workflowService, TaskQueueTranscode } from '@shumai/workflow-core'
import { initTranscodeWorkflows } from '@shumai/transcode'
import { s3Service } from '@shumai/core/src/s3/s3'
import { uploadService } from '@shumai/core/src/upload/upload'
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

    /**
     * Uploads a file the way the web app does: the asset is created as uploading,
     * the bytes land in storage, and confirming the upload dispatches its preview.
     */
    async function uploadWithTextPreviewMode(
      textPreviewMode: 'pdf' | 'raw',
      name: string,
      clientMediaType: string,
      content: Uint8Array,
    ) {
      const user = await prisma.user.create({
        data: { name: `E2E ${name}`, email: `e2e-text-${mode}-${name}@example.com` },
      })
      const team = await prisma.team.create({
        data: {
          name: `E2E Upload Team ${name}`,
          settings: { transcode: { videoStrategy: 'best_match', textPreviewMode } },
        },
      })
      const project = await prisma.project.create({
        data: { name: `E2E Upload Project ${name}`, teamId: team.id },
      })
      const folder = await prisma.asset.create({
        data: {
          name: 'uploads',
          type: AssetType.folder,
          status: AssetStatus.uploaded,
          projectId: project.id,
        },
      })
      const uploadTask = await prisma.task.create({
        data: { creatorId: user.id, total: 1, uploaded: 0, type: 'upload' },
      })
      const key = `projects/e2e-text-upload/${mode}/${textPreviewMode}/${name}/${name}`
      const storageKey = await prisma.storageKey.create({ data: { key } })
      const asset = await prisma.asset.create({
        data: {
          name,
          type: AssetType.file,
          status: AssetStatus.uploading,
          mediaType: clientMediaType,
          sizeByte: content.length,
          projectId: project.id,
          parentId: folder.id,
          taskId: uploadTask.id,
          storageKeyId: storageKey.id,
        },
      })
      await s3Service.putObject(bucket, key, content, content.length, 'application/octet-stream')

      await uploadService.confirmFileUpload(user.id, uploadTask.id, { fileId: asset.id })

      const tasks = await prisma.workflowTask.findMany({ where: { assetId: asset.id } })
      return { asset, key, tasks }
    }

    async function expectRawTextPreview(assetId: string, key: string, expectedText: string) {
      const updatedAsset = await prisma.asset.findUnique({ where: { id: assetId } })
      expect(updatedAsset?.status).toBe(AssetStatus.processed)

      const media = updatedAsset?.media as PrismaJson.MediaInfo | null
      expect(media?.proxyType).toBe('text')
      expect(media?.pdfTranscode).toBeUndefined()
      expect(media?.original?.key).toBe(key)
      expect(media?.textTranscode).toEqual({
        key: `${key.slice(0, key.lastIndexOf('/'))}/proxy.txt`,
        encoding: 'utf-8',
        lineCount: expectedText.split('\n').length - 1,
        truncated: false,
        format: 'plain',
      })

      const proxy = await s3Service.getObject(bucket, media!.textTranscode!.key!)
      expect(proxy.buffer.toString('utf-8')).toBe(expectedText)
      return proxy.buffer.toString('utf-8')
    }

    it('should preview a newly uploaded .json file as its original, unformatted text', async () => {
      // Compact and oddly indented on purpose: the preview must not pretty-print it.
      const json =
        '{"name":"shumai","tags":["a","b"],\r\n    "nested":{"z":1,"a":[1,2]},\r\n  "ok":true}\r\n'
      const { asset, key, tasks } = await uploadWithTextPreviewMode(
        'raw',
        'settings.json',
        'application/octet-stream',
        Buffer.from(json, 'utf-8'),
      )

      expect(tasks.map((t) => t.type)).toEqual([WorkflowTaskType.transcode_text])
      const completedTask = await workflowService.executeWait(tasks[0], 45000)
      expect(completedTask.status).toBe('completed')

      const updatedAsset = await prisma.asset.findUnique({ where: { id: asset.id } })
      expect(updatedAsset?.mediaType).toBe('application/json;charset=utf-8')
      const text = await expectRawTextPreview(
        asset.id,
        key,
        '{"name":"shumai","tags":["a","b"],\n    "nested":{"z":1,"a":[1,2]},\n  "ok":true}\n',
      )
      expect(text.split('\n')[1]).toBe('    "nested":{"z":1,"a":[1,2]},')

      const proxyTypeValue = await prisma.assetMetadataValue.findUnique({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        where: { assetId_fieldKey: { assetId: asset.id, fieldKey: 'proxy_type' } },
      })
      expect(proxyTypeValue?.stringValue).toBe('text')
    }, 50000)

    it('should preview a newly uploaded .py file with its original lines and indentation', async () => {
      const python =
        '#!/usr/bin/env python3\r\n# 标题样式的注释，不是 Markdown\r\ndef main():\r\n\tprint("hello")  \r\n\r\nif __name__ == "__main__":\r\n    main()\r\n'
      const { asset, key, tasks } = await uploadWithTextPreviewMode(
        'raw',
        'tool.py',
        '',
        Buffer.from(python, 'utf-8'),
      )

      expect(tasks.map((t) => t.type)).toEqual([WorkflowTaskType.transcode_text])
      const completedTask = await workflowService.executeWait(tasks[0], 45000)
      expect(completedTask.status).toBe('completed')

      const text = await expectRawTextPreview(asset.id, key, python.replace(/\r\n/g, '\n'))
      expect(text.split('\n').slice(0, 7)).toEqual([
        '#!/usr/bin/env python3',
        '# 标题样式的注释，不是 Markdown',
        'def main():',
        '\tprint("hello")  ',
        '',
        'if __name__ == "__main__":',
        '    main()',
      ])
    }, 50000)

    it('should mark a whitelisted file containing NUL bytes processed without a text proxy', async () => {
      const bytes = new Uint8Array([
        0x6f, 0x6b, 0x0a, 0x00, 0x01, 0x02, 0xff, 0x0a, 0x65, 0x6e, 0x64,
      ])
      const { asset, key, tasks } = await uploadWithTextPreviewMode(
        'raw',
        'crash.log',
        'text/plain;charset=utf-8',
        bytes,
      )

      expect(tasks.map((t) => t.type)).toEqual([WorkflowTaskType.transcode_text])
      const completedTask = await workflowService.executeWait(tasks[0], 45000)
      expect(completedTask.status).toBe('completed')
      expect(completedTask.output).toEqual({ skipped: 'binary' })

      const updatedAsset = await prisma.asset.findUnique({ where: { id: asset.id } })
      expect(updatedAsset?.status).toBe(AssetStatus.processed)
      expect(updatedAsset?.media).toBeNull()

      const proxyKey = `${key.slice(0, key.lastIndexOf('/'))}/proxy.txt`
      await expect(s3Service.headObject(bucket, proxyKey)).rejects.toThrow('NoSuchKey')
    }, 50000)

    it('should leave code files without a preview when the team converts text files to PDF', async () => {
      const { asset, tasks } = await uploadWithTextPreviewMode(
        'pdf',
        'deploy.sh',
        'text/plain;charset=utf-8',
        Buffer.from('#!/bin/sh\necho deploy\n', 'utf-8'),
      )

      expect(tasks).toEqual([])
      const updatedAsset = await prisma.asset.findUnique({ where: { id: asset.id } })
      expect(updatedAsset?.status).toBe(AssetStatus.processed)
      expect(updatedAsset?.media).toBeNull()
    }, 50000)
  },
)
