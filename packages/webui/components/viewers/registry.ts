import type { AssetInfo } from '@shumai/dtos'
import { FileTypeDefinition } from './types'
import { videoTypeDefinition } from './video'
import { imageTypeDefinition } from './image'
import { pdfTypeDefinition } from './pdf'
import { textTypeDefinition } from './text'
import { defaultTypeDefinition } from './default'

const registry: FileTypeDefinition[] = [
  pdfTypeDefinition,
  textTypeDefinition,
  videoTypeDefinition,
  imageTypeDefinition,
]

export function getViewerForFile(file: AssetInfo | null | undefined): FileTypeDefinition {
  if (!file) return defaultTypeDefinition
  // A failed transcode leaves no usable preview, whatever proxy type the file has.
  if (file.media?.transcodeError) return defaultTypeDefinition
  const match = registry.find((viewer) => viewer.match(file))
  return match || defaultTypeDefinition
}

export function getAllViewers(): FileTypeDefinition[] {
  return registry
}

/**
 * Whether the comment composer should hide its drawing tool for this file: audio
 * has nothing to draw on and raw text previews anchor comments to lines only.
 */
export function hidesAnnotationControl(
  file: Pick<AssetInfo, 'proxyType'> | null | undefined,
): boolean {
  return file?.proxyType === 'audio' || file?.proxyType === 'text'
}
