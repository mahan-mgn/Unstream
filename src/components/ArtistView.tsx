import { useState } from 'react'
import { api } from '../lib/api'
import { digits, safeFilename } from '../lib/format'
import { useI18n } from '../lib/i18n'
import type { Album, ArtistDetail, Playlist, Track } from '../lib/types'
import { isActive, isDone, useDownloads } from '../store/downloads'
import { useSettings } from '../store/settings'
import { useToasts } from '../store/toasts'
import Artwork, { HeroBackdrop } from './Artwork'
import ClickSpark from './ClickSpark'
import EmptyState from './EmptyState'
import FollowButton from './FollowButton'
import TrackRow from './TrackRow'
import { AlbumCard, PlaylistRow } from './cards'
import { ArrowIcon, DownloadIcon, HeadphonesIcon, LinkIcon, Spinner, ZipIcon } from './icons'

interface Props {
  artist: ArtistDetail
  playingId: string | null
  onTogglePlay: (track: Track) => void
  onOpenAlbum: (album: Album) => void
  onOpenPlaylist: (playlist: Playlist) => void
  onBack: () => void
}

/** حداکثر چند آلبوم هم‌زمان از سرور بگیریم — تا روی ارائه‌دهنده هجوم نبریم */
const ALBUM_FETCH_CONCURRENCY = 4

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let next = 0
  async function worker() {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))
  return results
}

export default function ArtistView({
  artist,
  playingId,
  onTogglePlay,
  onOpenAlbum,
  onOpenPlaylist,
  onBack,
}: Props) {
  const [allTracks, setAllTracks] = useState<Track[] | null>(null)
  const [loadingAll, setLoadingAll] = useState(false)
  const [zipping, setZipping] = useState(false)
  const quality = useSettings((s) => s.quality)
  const { enqueueMany, jobs } = useDownloads()
  const { t, lang } = useI18n()
  const pushToast = useToasts((s) => s.push)

  const knownTracks = allTracks ?? artist.topTracks
  const knownIds = new Set(knownTracks.map((x) => x.id))
  const own = jobs.filter((j) => knownIds.has(j.track.id))
  const activeCount = own.filter((j) => isActive(j.status)).length
  const readyJobs = own.filter((j) => isDone(j.status))
  const hasMore = allTracks === null || readyJobs.length < allTracks.length
  // پلی‌لیست هم محتوا حساب می‌شود: صفحه‌ی یک کاربر تمامش همین است و بدون این،
  // پروفایلِ پر از پلی‌لیست «در دسترس نیست» نشان داده می‌شد
  const isUser = artist.kind === 'user'
  const hasAnything =
    artist.topTracks.length > 0 || artist.albums.length > 0 || artist.playlists.length > 0

  /**
   * ترک‌های کلِ دیسکوگرافی را می‌گیرد و با آهنگ‌های محبوب یکی می‌کند — یک‌بار
   * کش می‌شود.
   *
   * وقتی آلبومی در کار نیست — یعنی روی صفحه‌ی کاربر — سراغِ پلی‌لیست‌ها
   * می‌رود؛ وگرنه «دانلود همه» آنجا هیچ کاری نمی‌کرد. برای هنرمند اما
   * پلی‌لیست‌ها عمداً کنار می‌مانند: آن‌ها را پلتفرم دورش ساخته و پر از ترکِ
   * کسانِ دیگرند.
   */
  async function loadDiscography(): Promise<Track[]> {
    if (allTracks) return allTracks
    setLoadingAll(true)
    try {
      const sources: (Album | Playlist)[] = artist.albums.length
        ? artist.albums
        : artist.playlists
      const details = await mapLimit(sources, ALBUM_FETCH_CONCURRENCY, (item) =>
        api.getAlbum(item.sourceUrl || item.id).catch(() => null),
      )
      const merged = new Map<string, Track>()
      for (const track of artist.topTracks) merged.set(track.id, track)
      for (const detail of details) {
        if (!detail) continue
        for (const track of detail.tracks) merged.set(track.id, track)
      }
      const list = [...merged.values()]
      setAllTracks(list)
      return list
    } finally {
      setLoadingAll(false)
    }
  }

  async function downloadAll() {
    const tracks = await loadDiscography()
    if (!tracks.length) return
    enqueueMany(tracks, quality, { title: artist.name, artworkUrl: artist.artworkUrl })
  }

  async function downloadZip() {
    setZipping(true)
    try {
      const url = await api.zip(
        readyJobs.map((j) => ({ trackId: j.track.id, quality: j.quality })),
        safeFilename(artist.name),
      )
      if (!url) {
        pushToast(t.mockNoFile, 'info')
        return
      }
      location.href = url
    } catch {
      pushToast(t.toastZipFailed, 'error')
    } finally {
      setZipping(false)
    }
  }

  // همان الگوی AlbumView: کنترل‌ها یک‌بار ساخته، دو جا رندر — کنارِ عنوان روی
  // دسکتاپ، و یک ردیفِ مستقل زیرِ آن روی موبایل
  const actions = (
    <>
      {!isUser && <FollowButton artist={artist} />}

      {artist.sourceUrl && (
        <a
          href={artist.sourceUrl}
          target="_blank"
          rel="noreferrer"
          title={t.openSource}
          aria-label={t.openSource}
          className="grid size-10 place-items-center rounded-full border border-white/25 bg-black/45 text-white! backdrop-blur-md transition hover:border-white/50 hover:bg-black/60"
        >
          <LinkIcon className="size-4" />
        </a>
      )}

      {readyJobs.length > 0 && (
        <button
          onClick={downloadZip}
          disabled={zipping}
          title={t.zipTitle}
          className="inline-flex items-center gap-2 rounded-full border border-line px-4 py-2.5 text-sm text-fg transition hover:border-muted-2 disabled:opacity-45"
        >
          {zipping ? <Spinner className="size-4" /> : <ZipIcon className="size-4" />}
          {t.zip(readyJobs.length)}
        </button>
      )}

      {hasAnything && (activeCount > 0 || loadingAll || hasMore) && (
        // همان دکمه‌ی اصلیِ AlbumView، همان جرقه
        <ClickSpark className="flex-1 md:flex-none">
        <button
          onClick={downloadAll}
          disabled={loadingAll || activeCount > 0}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-accent px-4 py-2.5 text-sm font-semibold text-accent-fg transition enabled:hover:brightness-110 disabled:opacity-60"
        >
          {loadingAll ? (
            <>
              <Spinner className="size-4" />
              {t.loadingAlbums}
            </>
          ) : activeCount > 0 ? (
            <>
              <Spinner className="size-4" />
              {t.ofTotal(readyJobs.length, readyJobs.length + activeCount)}
            </>
          ) : (
            <>
              <DownloadIcon className="size-4" />
              {t.downloadAll}
            </>
          )}
        </button>
        </ClickSpark>
      )}
    </>
  )

  return (
    <div className="rise space-y-4">
      <button
        onClick={onBack}
        className="inline-flex items-center gap-1.5 py-1 text-xs text-muted transition hover:text-fg"
      >
        <ArrowIcon className="size-3.5 -scale-x-100 rtl:scale-x-100" />
        {t.backToResults}
      </button>

      <div className="overflow-hidden rounded-2xl border border-line-soft bg-panel/50">
        <div className="relative border-b border-line-soft p-4">
          <HeroBackdrop src={artist.artworkUrl} seed={artist.id} rounded="rounded-2xl" />
          {/* HeroBackdrop در هیروی آلبوم به پایینِ صفحه محو می‌شود؛ این کارت
              لبه‌ی گرد و border دارد، پس محوِ افقی به دو طرفِ تیره کافی است */}
          <span
            aria-hidden
            className="absolute inset-0"
            style={{
              background:
                'linear-gradient(to right, color-mix(in srgb, var(--bg) 40%, transparent), transparent 55%)',
            }}
          />
          <div className="relative flex items-center gap-3 sm:gap-4">
            <Artwork
              src={artist.artworkUrl}
              alt={artist.name}
              seed={artist.id}
              rounded="rounded-full"
              className="size-16 shrink-0 shadow-xl shadow-black/30 sm:size-20"
            />

            <div className="min-w-0 flex-1">
              <div className="mb-1 flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wide text-white drop-shadow-[0_1px_6px_rgb(0_0_0/0.9)]">
                  {isUser ? t.typeUser : t.artists}
                </span>
              </div>
              <h1 className="bidi truncate text-lg font-bold sm:text-xl">{artist.name}</h1>
              {/*
                زیرنویسِ خودِ سرور آخرین گزینه است: شمارشی که همین‌جا روی صفحه
                دیده می‌شود هم دقیق‌تر است هم به زبانِ انتخابیِ کاربر درمی‌آید
              */}
              <p className="mt-0.5 truncate text-xs text-muted">
                {artist.albums.length
                  ? t.albumCount(artist.albums.length)
                  : isUser && artist.playlists.length
                    ? t.playlistsCount(artist.playlists.length)
                    : digits(artist.subtitle, lang)}
              </p>
            </div>

            <div className="hidden shrink-0 items-center gap-2 md:flex">{actions}</div>
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-2 md:hidden">{actions}</div>
        </div>

        <div className="space-y-8 p-4">
          {!hasAnything && (
            <EmptyState
              bordered={false}
              icon={<HeadphonesIcon className="size-5" />}
              text={isUser ? t.userNotFound : t.artistNotFound}
            />
          )}

          {artist.topTracks.length > 0 && (
            <section className="space-y-3">
              {/*
                عنوانِ خنثی و نه «محبوب‌ها»: اپل و ساندکلاد لیستِ محبوب‌ها را
                می‌دهند، ولی دیزر و اسپاتیفای نمی‌دهند و سرور آن دو را از
                تازه‌ترین انتشارها پر می‌کند. «آهنگ‌ها» هر چهار حالت را راست می‌گوید.
              */}
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                {t.songs}
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

          {/*
            برای کاربر تمامِ صفحه همین است و برای هنرمند یک بخشِ اضافه — پس
            بعد از دیسکوگرافی می‌نشیند و روی صفحه‌ی کاربر، که آلبومی ندارد،
            خودش اولین چیزِ صفحه می‌شود.
          */}
          {artist.playlists.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                {t.playlists}
              </h2>
              <div className="space-y-0.5">
                {artist.playlists.map((playlist) => (
                  <PlaylistRow
                    key={playlist.id}
                    playlist={playlist}
                    onOpen={() => onOpenPlaylist(playlist)}
                  />
                ))}
              </div>
            </section>
          )}

          {artist.repostedTracks.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                {t.reposted}
              </h2>
              <div className="space-y-0.5">
                {artist.repostedTracks.map((track) => (
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

          {artist.likedTracks.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-2">
                {t.liked}
              </h2>
              <div className="space-y-0.5">
                {artist.likedTracks.map((track) => (
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
        </div>
      </div>
    </div>
  )
}
