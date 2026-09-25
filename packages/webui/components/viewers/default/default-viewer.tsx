import { client } from '@/ui/api/client'
import { m } from '@/ui/paraglide/messages.js'
import { Download } from 'lucide-react'
import React, { useImperativeHandle } from 'react'
import { FileViewerProps, MediaController } from '../types'

export const DefaultViewer = React.forwardRef<MediaController, FileViewerProps>(
  ({ file, shareId, children, allowDownload = true }, ref) => {
    // Implement no-op media controller
    useImperativeHandle(ref, () => ({
      play: () => {},
      pause: () => {},
      seekTo: () => {},
    }))

    const handleDownload = async () => {
      const key = file.media?.original?.key
      if (!key || !file.id) return
      try {
        const res = shareId
          ? await client.api.shares[':shareId'].files[':fileId']['download-url'].$post({
              param: { shareId, fileId: file.id },
              json: { key },
            })
          : await client.api.files['download-url'].$post({
              json: { key, assetId: file.id },
            })
        if (!res.ok) return
        const { url } = await res.json()
        const link = document.createElement('a')
        link.href = url
        link.download = ''
        document.body.appendChild(link)
        link.click()
        document.body.removeChild(link)
      } catch {
        // silently fail
      }
    }

    return (
      <div className="flex flex-col flex-1 h-full overflow-hidden bg-muted relative">
        <div className="flex-1 flex flex-col-reverse md:flex-row min-h-0 relative">
          {children}
          <div className="flex-1 flex items-center justify-center">
            <p className="text-muted-foreground">{m.preview_unavailable()}</p>
          </div>
        </div>
        <div className="relative px-4 py-3 bg-card border-t border-border z-10 flex items-center justify-end gap-2 transition-colors duration-200">
          {allowDownload && (
            <button
              onClick={handleDownload}
              disabled={!file.media?.original?.key}
              className="flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded bg-muted hover:bg-foreground/20 text-foreground transition-colors border border-transparent disabled:opacity-50 animate-in fade-in zoom-in-95 duration-200"
              title={m.download_original_file()}
            >
              <Download size={14} />
              {m.download()}
            </button>
          )}
        </div>
      </div>
    )
  },
)

export default DefaultViewer
