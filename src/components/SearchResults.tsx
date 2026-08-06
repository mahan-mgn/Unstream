import { useState } from 'react'
import { digits } from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { Album, Artist, Playlist, SearchResults as Results, Track } from '../lib/types'
import Artwork from './Artwork'
import SourceBadge from './SourceBadge'
import TrackRow from './TrackRow'
import { ChevronIcon, PlayIcon } from './icons'

interface Props {
  results: Results
  playingId: string | null
  onTogglePlay: (track: Track) => void
  onOpenAlbum: (album: Album) => void
}

type TabId = 'all' | 'songs' | 'artists' | 'albums' | 'playlists'

const PREVIEW_COUNT = 5

function Section({
  title,
  count,
  expanded,
  onToggle,
  children,
}: {
  title: string
  count: number
  expanded: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  const { t } = useI18n()
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">{title}</h2>
        {count > PREVIEW_COUNT && (
          <button
            onClick={onToggle}
            className="inline-flex items-center gap-1 text-xs text-accent transition hover:brightness-125"
          >
            {expanded ? t.collapse : t.showAll(count)}
            <ChevronIcon className={`size-3.5 transition ${expanded ? 'rotate-90' : ''}`} />
          </button>
        )}
      </div>
      {children}
    </section>
  )
}

function ArtistCard({ artist }: { artist: Artist }) {
  return (
    <a
      href={artist.sourceUrl}
      target="_blank"
      rel="noreferrer"
      className="group flex flex-col items-center gap-2 rounded-xl p-2 text-center transition hover:bg-panel-2"
    >
      <Artwork
        src={artist.artworkUrl}
        alt={artist.name}
        seed={artist.id}
        rounded="rounded-full"
        className="aspect-square w-full transition group-hover:scale-[1.03]"
      />
      <div className="w-full">
        <p className="bidi-center truncate text-xs">{artist.name}</p>
        <p className="truncate text-[10px] text-muted-2">{artist.subtitle}</p>
      </div>
    </a>
  )
}

function AlbumCard({ album, onOpen }: { album: Album; onOpen: () => void }) {
  const { lang } = useI18n()
  return (
    <button onClick={onOpen} className="group rounded-xl p-2 text-start transition hover:bg-panel-2">
      <div className="relative">
        <Artwork
          src={album.artworkUrl}
          alt={album.title}
          seed={album.id}
          className="aspect-square w-full"
        />
        <span className="absolute inset-0 grid place-items-center rounded-lg bg-black/45 opacity-0 transition group-hover:opacity-100">
          <span className="grid size-9 place-items-center rounded-full bg-accent text-accent-fg">
            <PlayIcon className="size-4" />
          </span>
        </span>
        <span className="absolute end-1.5 top-1.5 opacity-0 transition group-hover:opacity-100">
          <SourceBadge source={album.source} />
        </span>
      </div>
      <p className="bidi mt-2 truncate text-xs">{album.title}</p>
      <p className="truncate text-[10px] text-muted-2">
        <bdi>{album.artist}</bdi>
        {album.year ? ` · ${digits(album.year, lang)}` : ''}
      </p>
    </button>
  )
}

function PlaylistRow({ playlist }: { playlist: Playlist }) {
  const { t } = useI18n()
  return (
    <a
      href={playlist.sourceUrl}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-panel-2"
    >
      <Artwork
        src={playlist.artworkUrl}
        alt={playlist.title}
        seed={playlist.id}
        className="size-10 shrink-0"
      />
      <div className="min-w-0 flex-1">
        <p className="bidi truncate text-sm">{playlist.title}</p>
        <p className="truncate text-xs text-muted">
          {t.trackCount(playlist.trackCount)} · <bdi>{playlist.owner}</bdi>
        </p>
      </div>
      <SourceBadge source={playlist.source} />
    </a>
  )
}

export default function SearchResults({ results, playingId, onTogglePlay, onOpenAlbum }: Props) {
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [tab, setTab] = useState<TabId>('all')
  const { t, lang } = useI18n()

  const toggle = (k: string) => setExpanded((e) => ({ ...e, [k]: !e[k] }))
  const cut = <T,>(arr: T[], key: string) => (expanded[key] ? arr : arr.slice(0, PREVIEW_COUNT))

  const counts = {
    songs: results.tracks.length,
    artists: results.artists.length,
    albums: results.albums.length,
    playlists: results.playlists.length,
  }
  const total = counts.songs + counts.artists + counts.albums + counts.playlists

  if (total === 0) {
    return (
      <div className="rise rounded-2xl border border-line-soft bg-panel/50 p-10 text-center">
        <p className="text-sm text-muted">{t.noResults(results.query)}</p>
      </div>
    )
  }

  const tabs = (
    [
      { id: 'all', label: t.all, count: total },
      { id: 'songs', label: t.songs, count: counts.songs },
      { id: 'artists', label: t.artists, count: counts.artists },
      { id: 'albums', label: t.albums, count: counts.albums },
      { id: 'playlists', label: t.playlists, count: counts.playlists },
    ] satisfies { id: TabId; label: string; count: number }[]
  ).filter((x) => x.count > 0)

  const shows = (id: TabId) => tab === 'all' || tab === id

  return (
    <div className="rise overflow-hidden rounded-2xl border border-line-soft bg-panel/50">
      <div className="flex items-center justify-between gap-3 border-b border-line-soft px-4 py-3">
        <p className="truncate text-sm">
          {t.resultsFor('')}
          <span className="font-semibold text-accent">{results.query}</span>
        </p>
        <span className="shrink-0 text-[11px] text-muted-2">{t.foundSoFar(total)}</span>
      </div>

      <div className="flex flex-wrap gap-1.5 border-b border-line-soft px-4 py-2.5">
        {tabs.map((x) => (
          <button
            key={x.id}
            onClick={() => setTab(x.id)}
            className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs transition ${
              tab === x.id
                ? 'bg-accent font-semibold text-accent-fg'
                : 'bg-panel-2 text-muted hover:text-fg'
            }`}
          >
            {x.label}
            <span className={tab === x.id ? 'opacity-70' : 'text-muted-2'}>
              {digits(x.count, lang)}
            </span>
          </button>
        ))}
      </div>

      <div className="space-y-8 p-4">
        {shows('songs') && counts.songs > 0 && (
          <Section
            title={t.songs}
            count={counts.songs}
            expanded={!!expanded.tracks || tab === 'songs'}
            onToggle={() => toggle('tracks')}
          >
            <div className="space-y-0.5">
              {(tab === 'songs' ? results.tracks : cut(results.tracks, 'tracks')).map((x) => (
                <TrackRow
                  key={x.id}
                  track={x}
                  playingId={playingId}
                  onTogglePlay={onTogglePlay}
                  showSource
                />
              ))}
            </div>
          </Section>
        )}

        {shows('artists') && counts.artists > 0 && (
          <Section
            title={t.artists}
            count={counts.artists}
            expanded={!!expanded.artists || tab === 'artists'}
            onToggle={() => toggle('artists')}
          >
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
              {(tab === 'artists' ? results.artists : cut(results.artists, 'artists')).map((x) => (
                <ArtistCard key={x.id} artist={x} />
              ))}
            </div>
          </Section>
        )}

        {shows('albums') && counts.albums > 0 && (
          <Section
            title={t.albums}
            count={counts.albums}
            expanded={!!expanded.albums || tab === 'albums'}
            onToggle={() => toggle('albums')}
          >
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 md:grid-cols-4">
              {(tab === 'albums' ? results.albums : cut(results.albums, 'albums')).map((x) => (
                <AlbumCard key={x.id} album={x} onOpen={() => onOpenAlbum(x)} />
              ))}
            </div>
          </Section>
        )}

        {shows('playlists') && counts.playlists > 0 && (
          <Section
            title={t.playlists}
            count={counts.playlists}
            expanded={!!expanded.playlists || tab === 'playlists'}
            onToggle={() => toggle('playlists')}
          >
            <div className="space-y-0.5">
              {(tab === 'playlists' ? results.playlists : cut(results.playlists, 'playlists')).map(
                (x) => (
                  <PlaylistRow key={x.id} playlist={x} />
                ),
              )}
            </div>
          </Section>
        )}
      </div>
    </div>
  )
}
