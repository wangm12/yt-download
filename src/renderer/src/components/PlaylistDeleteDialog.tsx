import { AlertTriangle, FileX, Trash2 } from 'lucide-react'

interface PlaylistDeleteDialogProps {
  playlistTitle: string
  videoCount: number
  onClose: () => void
  onRemoveListOnly: () => void
  onRemoveWithFiles: () => void
}

export function PlaylistDeleteDialog({
  playlistTitle,
  videoCount,
  onClose,
  onRemoveListOnly,
  onRemoveWithFiles
}: PlaylistDeleteDialogProps) {
  const handleListOnly = () => {
    onRemoveListOnly()
    onClose()
  }

  const handleWithFiles = () => {
    onRemoveWithFiles()
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div
        className="w-[360px] bg-background rounded-2xl shadow-2xl p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex flex-col items-center text-center mb-6">
          <div className="w-12 h-12 rounded-full bg-accent-amber/20 flex items-center justify-center mb-4">
            <AlertTriangle className="w-6 h-6 text-accent-amber" />
          </div>
          <h2 className="text-lg font-semibold text-foreground mb-2">Remove playlist</h2>
          <p className="text-sm text-muted-foreground leading-relaxed">
            <span className="text-foreground font-medium">{playlistTitle}</span>
            {' · '}
            {videoCount} video{videoCount !== 1 ? 's' : ''}
          </p>
          <p className="text-xs text-muted-foreground mt-3">
            Choose whether to keep downloaded files on disk or delete them as well.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={handleListOnly}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent-indigo text-background font-medium hover:bg-accent-indigo-dark transition-colors"
          >
            <FileX className="w-4 h-4" />
            Remove from list only
          </button>
          <button
            type="button"
            onClick={handleWithFiles}
            className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-accent-coral text-white font-medium hover:bg-accent-coral/90 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            Delete files and remove
          </button>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-lg bg-border text-foreground font-medium hover:bg-border/80 transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
