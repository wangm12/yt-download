import { useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  ListVideo,
  CircleCheckBig,
  Loader,
  Timer,
  Trash2,
  FolderOpen,
  RotateCcw,
  Pause,
  Play
} from 'lucide-react'
import type { Playlist } from '@/types'
import { useDownloadActions } from '@/contexts/DownloadActionsContext'
import { PlaylistDeleteDialog } from './PlaylistDeleteDialog'
import { ActionButton } from './ActionButton'
import { formatFileSize } from '@/utils/format'

const VISIBLE_ITEMS = 5

interface PlaylistGroupProps {
  playlist: Playlist
}

export function PlaylistGroup({ playlist }: PlaylistGroupProps) {
  const actions = useDownloadActions()
  const [expanded, setExpanded] = useState(true)
  const [showAll, setShowAll] = useState(false)
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false)

  const downloads = playlist.downloads ?? []
  const visibleDownloads = showAll ? downloads : downloads.slice(0, VISIBLE_ITEMS)
  const hasMore = downloads.length > VISIBLE_ITEMS && !showAll
  const moreCount = downloads.length - VISIBLE_ITEMS

  const progressPercent =
    playlist.total_count > 0 ? (playlist.completed_count / playlist.total_count) * 100 : 0

  const hasActiveItems = downloads.some((d) => d.status === 'downloading' || d.status === 'queued')
  const resumableItems = downloads.filter((d) =>
    ['paused', 'interrupted', 'cancelled', 'error'].includes(d.status)
  )
  const hasResumableItems = resumableItems.length > 0

  return (
    <>
      {deleteDialogOpen && (
        <PlaylistDeleteDialog
          playlistTitle={playlist.title}
          videoCount={downloads.length}
          onClose={() => setDeleteDialogOpen(false)}
          onRemoveListOnly={() => {
            downloads.forEach((d) => actions.remove(d.id))
          }}
          onRemoveWithFiles={() => {
            downloads.forEach((d) => actions.removeWithFiles(d.id))
          }}
        />
      )}
    <div className="border-b border-border overflow-hidden" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
      <div
        role="button"
        tabIndex={0}
        onClick={() => {
          const next = !expanded
          setExpanded(next)
          if (!next) setShowAll(false)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            const next = !expanded
            setExpanded(next)
            if (!next) setShowAll(false)
          }
        }}
        className="w-full flex items-center gap-3 px-4 py-3 bg-surface hover:bg-surface/80 transition-colors text-left cursor-pointer"
      >
        {expanded ? (
          <ChevronDown className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        ) : (
          <ChevronRight className="w-4 h-4 text-muted-foreground flex-shrink-0" />
        )}
        <div className="w-8 h-8 rounded flex items-center justify-center bg-accent-indigo/20 text-accent-indigo flex-shrink-0">
          <ListVideo className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">{playlist.title}</p>
          <p className="text-xs text-muted-foreground">
            {playlist.type} · {playlist.total_count} videos · {playlist.output_dir}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <div className="w-24 h-1.5 rounded-full bg-elevated overflow-hidden">
            <div
              className="h-full rounded-full bg-accent-indigo transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          <span className="text-xs text-muted-foreground whitespace-nowrap">
            {playlist.completed_count}/{playlist.total_count}
          </span>
          {hasResumableItems && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                resumableItems.forEach((d) => actions.retry(d.id))
              }}
              className="p-1 rounded text-muted-foreground hover:text-accent-green hover:bg-elevated transition-colors"
              title="Resume all"
            >
              <Play className="w-4 h-4" />
            </button>
          )}
          {hasActiveItems && (
            <button
              onClick={(e) => {
                e.stopPropagation()
                downloads
                  .filter((d) => d.status === 'downloading' || d.status === 'queued')
                  .forEach((d) => actions.pause(d.id))
              }}
              className="p-1 rounded text-muted-foreground hover:text-accent-amber hover:bg-elevated transition-colors"
              title="Pause all"
            >
              <Pause className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              setDeleteDialogOpen(true)
            }}
            className="p-1 rounded text-muted-foreground hover:text-accent-coral hover:bg-elevated transition-colors"
            title="Remove playlist"
            aria-label="Remove playlist"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="bg-background">
          {visibleDownloads.map((d, idx) => (
            <div
              key={d.id}
              className="h-11 flex items-center gap-3 pl-14 pr-4 border-t border-border/30 hover:bg-surface/30 transition-colors"
            >
              <span className="w-5 text-xs text-tertiary-foreground flex-shrink-0">
                {d.playlist_index ?? idx + 1}.
              </span>
              {d.status === 'complete' && <CircleCheckBig className="w-4 h-4 text-accent-green flex-shrink-0" />}
              {d.status === 'downloading' && <Loader className="w-4 h-4 text-accent-indigo animate-spin flex-shrink-0" />}
              {d.status === 'paused' && <Pause className="w-4 h-4 text-accent-amber flex-shrink-0" />}
              {(d.status === 'queued' || d.status === 'error' || d.status === 'interrupted' || d.status === 'cancelled') && (
                <Timer className="w-4 h-4 text-muted-foreground flex-shrink-0" />
              )}
              <p className="flex-1 text-sm text-foreground truncate min-w-0">{d.title}</p>
              <span className="text-xs text-muted-foreground flex-shrink-0">
                {d.status === 'complete' && d.file_size
                  ? formatFileSize(d.file_size)
                  : d.status === 'downloading'
                    ? `${Math.round(d.progress)}%`
                    : ''}
              </span>
              {d.status === 'downloading' && (
                <div className="flex gap-1 flex-shrink-0">
                  <ActionButton icon={Pause} variant="warning" title="Pause" size="sm" onClick={() => actions.pause(d.id)} />
                  <ActionButton icon={Trash2} variant="danger" title="Delete with files" size="sm" onClick={() => actions.removeWithFiles(d.id)} />
                </div>
              )}
              {d.status === 'paused' && (
                <div className="flex gap-1 flex-shrink-0">
                  <ActionButton icon={Play} variant="success" title="Resume" size="sm" onClick={() => actions.retry(d.id)} />
                  <ActionButton icon={Trash2} variant="danger" title="Delete with files" size="sm" onClick={() => actions.removeWithFiles(d.id)} />
                </div>
              )}
              {d.status === 'complete' && d.file_path && (
                <div className="flex gap-1 flex-shrink-0">
                  <ActionButton icon={FolderOpen} title="Open folder" size="sm" onClick={() => actions.openFolder(d.file_path!)} />
                  <ActionButton icon={Trash2} variant="danger" title="Remove" size="sm" onClick={() => actions.remove(d.id)} />
                </div>
              )}
              {(d.status === 'interrupted' || d.status === 'error' || d.status === 'cancelled') && (
                <div className="flex gap-1 flex-shrink-0">
                  <ActionButton icon={RotateCcw} variant="success" title="Retry" size="sm" onClick={() => actions.retry(d.id)} />
                  <ActionButton icon={Trash2} variant="danger" title="Remove" size="sm" onClick={() => actions.remove(d.id)} />
                </div>
              )}
            </div>
          ))}
          {hasMore && (
            <button
              onClick={() => setShowAll(true)}
              className="w-full h-11 flex items-center pl-14 pr-4 text-xs text-accent-indigo hover:bg-surface/30 transition-colors"
            >
              ... and {moreCount} more videos
            </button>
          )}
        </div>
      )}
    </div>
    </>
  )
}
