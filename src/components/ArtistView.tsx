import { useI18n } from '../lib/i18n'
import type { Album, ArtistDetail, Track } from '../lib/types'
import Artwork from './Artwork'
import SourceBadge from './SourceBadge'
import TrackRow from './TrackRow'
import { AlbumCard } from './cards'
import { ArrowIcon, LinkIcon } from './icons'

interface Props {
  artist: ArtistDetail
  playingId: string | null
  onTogglePlay: (track: Track) => void
  onOpenAlbum: (album: Album) => void
  onBack: () => void
}

export default function ArtistView({
  artist,
  playingId,
  onTogglePlay,
  onOpenAlbum,
  onBack,
}: Props) {
  const { t } = useI18n()

  return (
    <div className="rise space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-fg"
      >
        <ArrowIcon className="size-3.5 -scale-x-100 rtl:scale-x-100" />
        {t.backToResults}
      </button>

      <div className="overflow-hidden rounded-2xl border border-line-soft bg-panel/50">
        <div className="flex items-center gap-4 border-b border-line-soft p-4">
          <Artwork
            src={artist.artworkUrl}
            alt={artist.name}
            seed={artist.id}
            rounded="rounded-full"
            className="size-20 shrink-0"
          />

          <div className="min-w-0 flex-1">
            <div className="mb-1 flex items-center gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wide text-muted-2">
                {t.artists}
              </span>
              <SourceBadge source={artist.source} />
            </div>
            <h1 className="bidi truncate text-xl font-bold">{artist.name}</h1>
            <p className="mt-0.5 truncate text-xs text-muted">
              {artist.albums.length ? t.albumCount(artist.albums.length) : artist.subtitle}
            </p>
          </div>

          {artist.sourceUrl && (
            <a
              href={artist.sourceUrl}
              target="_blank"
              rel="noreferrer"
              title={t.openSource}
              aria-label={t.openSource}
              className="grid size-10 shrink-0 place-items-center rounded-full border border-line text-muted transition hover:border-muted-2 hover:text-fg"
            >
              <LinkIcon className="size-4" />
            </a>
          )}
        </div>

        <div className="space-y-8 p-4">
          {artist.topTracks.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                {t.topTracks}
              </h2>
              <div className="space-y-0.5">
                {artist.topTracks.map((track) => (
                  <TrackRow
                    key={track.id}
                    track={track}
                    playingId={playingId}
                    onTogglePlay={onTogglePlay}
                    showSource
                  />
                ))}
              </div>
            </section>
          )}

          {artist.albums.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                {t.discography}
              </h2>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
                {artist.albums.map((album) => (
                  <AlbumCard key={album.id} album={album} onOpen={() => onOpenAlbum(album)} />
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
