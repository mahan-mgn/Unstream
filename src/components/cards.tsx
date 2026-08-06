import { digits } from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { Album, Artist } from '../lib/types'
import Artwork from './Artwork'
import SourceBadge from './SourceBadge'
import { PlayIcon } from './icons'

/**
 * کارت‌های مشترکِ نتایج جستجو و صفحه‌ی هنرمند.
 * جدا شدند چون هر دو صفحه دقیقاً همین دو کارت را می‌خواهند.
 */

export function ArtistCard({ artist, onOpen }: { artist: Artist; onOpen: () => void }) {
  return (
    <button
      onClick={onOpen}
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
    </button>
  )
}

export function AlbumCard({ album, onOpen }: { album: Album; onOpen: () => void }) {
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
