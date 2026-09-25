import { FileTypeDefinition } from '../types'
import TextViewer from './text-viewer'

export const textTypeDefinition: FileTypeDefinition = {
  id: 'text',
  name: 'Text',
  match: (file) => file.proxyType === 'text',
  viewer: TextViewer,
  commentsConfig: {
    hasTimestamp: true,
    hasAnnotations: false,
    formatTimestamp: (second: number) => `L${Math.round(second)}`,
  },
}
