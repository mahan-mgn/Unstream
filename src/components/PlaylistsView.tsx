import { useCallback, useEffect, useState } from 'react'
import { api } from '../lib/api'
import { duration as fmtDuration } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { buildRule, type EnergyChoice, type MoodChoice } from '../lib/playlists'
import type { LibraryItem, UserPlaylist, UserPlaylistDetail } from '../lib/types'
import { usePlayer, type PlayItem } from '../store/player'
import { useToasts } from '../store/toasts'
import Artwork from './Artwork'
import EmptyState from './EmptyState'
import { Mosaic } from './LibraryCollections'
import PlayButton from './PlayButton'
import {
  ArrowIcon,
  CheckIcon,
  HeartIcon,
  PlayIcon,
  PlaylistIcon,
  PlusIcon,
  SparkleIcon,
  Spinner,
  TrashIcon,
} from './icons'

const toPlayItem = (item: LibraryItem): PlayItem => ({
  id: item.jobId,
  track: item.track,
  streamUrl: item.streamUrl,
  lyricsUrl: item.lyricsUrl,
  gainDb: item.gainDb,
})

function CreateForm({ onCreated }: { onCreated: (playlist: UserPlaylist) => void }) {
  const { t } = useI18n()
  const pushToast = useToasts((s) => s.push)
  const [open, setOpen] = useState<'manual' | 'smart' | null>(null)
  const [name, setName] = useState('')
  const [mood, setMood] = useState<MoodChoice>('any')
  const [energy, setEnergy] = useState<EnergyChoice>('any')
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!name.trim() || !open) return
    setBusy(true)
    try {
      const created = await api.createPlaylist({
        name: name.trim(),
        kind: open,
        rule: open === 'smart' ? buildRule(mood, energy) : undefined,
      })
      if (!created) {
        pushToast(t.libraryUnavailable, 'info')
        return
      }
      onCreated(created)
      setName('')
      setOpen(null)
    } catch (err) {
      pushToast(err instanceof Error ? err.message : t.fetchError, 'error')
    } finally {
      setBusy(false)
    }
  }

  const chip = <T extends string>(value: T, current: T, set: (v: T) => void, label: string) => (
    <button
      key={value}
      onClick={() => set(value)}
      aria-pressed={value === current}
      className={`rounded-full border px-2.5 py-1 text-[11px] transition ${
        value === current
          ? 'border-accent bg-accent font-semibold text-accent-fg'
          : 'border-line text-muted hover:text-fg'
      }`}
    >
      {label}
    </button>
  )

  if (!open) {
    return (
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setOpen('manual')}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:text-fg"
        >
          <PlusIcon className="size-3.5" />
          {t.playlistNew}
        </button>
        <button
          onClick={() => setOpen('smart')}
          className="inline-flex items-center gap-1.5 rounded-full border border-line px-3 py-1.5 text-xs text-muted transition hover:text-fg"
        >
          <SparkleIcon className="size-3.5" />
          {t.playlistNewSmart}
        </button>
      </div>
    )
  }

  return (
    <div className="space-y-2 rounded-xl border border-line-soft bg-panel-2/40 p-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
        placeholder={t.playlistName}
        aria-label={t.playlistName}
        autoFocus
        className="w-full rounded-lg border border-line bg-panel px-3 py-1.5 text-xs outline-none placeholder:text-muted-2"
      />

      {open === 'smart' && (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 shrink-0 text-[11px] text-muted-2">{t.smartMood}</span>
            {chip('any', mood, setMood, t.smartAny)}
            {chip('happy', mood, setMood, t.smartHappy)}
            {chip('sad', mood, setMood, t.smartSad)}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="w-16 shrink-0 text-[11px] text-muted-2">{t.smartEnergy}</span>
            {chip('any', energy, setEnergy, t.smartAny)}
            {chip('calm', energy, setEnergy, t.smartCalm)}
            {chip('loud', energy, setEnergy, t.smartLoud)}
          </div>
          <p className="text-[11px] leading-snug text-muted-2">{t.smartHint}</p>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          onClick={() => setOpen(null)}
          className="rounded-full border border-line px-3 py-1.5 text-[11px] text-muted transition hover:text-fg"
        >
          {t.playlistCancel}
        </button>
        <button
          onClick={() => void submit()}
          disabled={!name.trim() || busy}
          className="inline-flex items-center gap-1.5 rounded-full bg-accent px-3 py-1.5 text-[11px] font-semibold text-accent-fg transition enabled:hover:brightness-110 disabled:opacity-50"
        >
          {busy ? <Spinner className="size-3" /> : <CheckIcon className="size-3" />}
          {t.playlistCreate}
        </button>
      </div>
    </div>
  )
}

function Detail({ id, onBack, onDeleted }: { id: string; onBack: () => void; onDeleted: () => void }) {
  const { t, lang } = useI18n()
  const pushToast = useToasts((s) => s.push)
  const [detail, setDetail] = useState<UserPlaylistDetail | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setDetail(await api.playlist(id))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  async function removeItem(jobId: string) {
    if (!detail) return
    await api.removeFromPlaylist(detail.id, jobId)
    setDetail({ ...detail, items: detail.items.filter((i) => i.jobId !== jobId) })
  }

  async function remove() {
    if (!detail) return
    await api.deletePlaylist(detail.id)
    pushToast(t.playlistDeleted(detail.name), 'info')
    onDeleted()
  }

  if (loading && !detail) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="size-5 text-muted-2" />
      </div>
    )
  }
  if (!detail) return <EmptyState icon={<PlaylistIcon className="size-5" />} text={t.fetchError} />

  const queue = detail.items.map(toPlayItem)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-1.5 text-xs text-muted transition hover:text-fg"
        >
          <ArrowIcon className="size-3.5 -scale-x-100 rtl:scale-x-100" />
          {t.playlistBack}
        </button>

        <div className="flex items-center gap-2">
          {queue.length > 0 && (
            <button
              onClick={() => usePlayer.getState().play(queue, 0)}
              className="inline-flex items-center gap-1 rounded-full border border-accent/40 bg-accent-dim px-2.5 py-1 text-[11px] font-semibold text-accent transition hover:brightness-110"
            >
              <PlayIcon className="size-3" />
              {t.playAll}
            </button>
          )}
          <button
            onClick={() => void remove()}
            aria-label={t.playlistDelete}
            title={t.playlistDelete}
            className="grid size-7 place-items-center rounded-md text-muted-2 transition hover:bg-panel-2 hover:text-danger"
          >
            <TrashIcon className="size-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Mosaic urls={detail.artworkUrls} seed={detail.id} />
        <div className="min-w-0">
          <h2 className="bidi truncate text-base font-bold">{detail.name}</h2>
          <p className="text-xs text-muted-2">
            {t.playlistCount(detail.trackCount)}
            {detail.kind === 'smart' ? ` · ${t.playlistSmartBadge}` : ''}
          </p>
        </div>
      </div>

      {detail.items.length === 0 ? (
        <EmptyState
          bordered={false}
          icon={<PlaylistIcon className="size-5" />}
          text={detail.kind === 'smart' ? t.playlistSmartNoTracks : t.playlistNoTracks}
        />
      ) : (
        <div className="space-y-0.5">
          {detail.items.map((item, i) => (
            <div
              key={item.jobId}
              className="group flex items-center gap-3 rounded-lg px-2 py-2 transition hover:bg-panel-2"
            >
              <PlayButton items={queue} index={i} className="shrink-0" />
              <Artwork
                src={item.track.artworkUrl}
                alt={item.track.album ?? item.track.title}
                seed={item.track.albumId ?? item.track.id}
                className="size-10 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <p className="bidi truncate text-sm">{item.track.title}</p>
                <p className="bidi truncate text-xs text-muted">
                  <bdi>{item.track.artist}</bdi>
                </p>
              </div>
              <span className="shrink-0 text-[11px] tabular-nums text-muted-2">
                {fmtDuration(item.track.durationMs, lang)}
              </span>
              {/* پلی‌لیستِ هوشمند عضوِ ذخیره‌شده ندارد؛ «حذف» آنجا یعنی تغییر
                  قانون، نه برداشتنِ یک ردیف */}
              {detail.kind === 'manual' && (
                <button
                  onClick={() => void removeItem(item.jobId)}
                  aria-label={t.playlistRemoveItem}
                  title={t.playlistRemoveItem}
                  className="hover-reveal grid size-8 shrink-0 place-items-center rounded-md text-muted-2 opacity-0 transition hover:bg-panel hover:text-danger group-hover:opacity-100 sm:size-7"
                >
                  <TrashIcon className="size-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * پلی‌لیست‌های خودِ کاربر — روی کتابخانه، نه روی کاتالوگ‌های بیرونی.
 *
 * دو نوع دارد و تفاوتشان یک جمله است: دستی فهرست نگه می‌دارد، هوشمند قانون.
 * قانونِ هوشمند روی همان والانس/انرژی‌ای کار می‌کند که سرور بعد از هر دانلود
 * از خودِ فایل درآورده — پس «شادهای پرانرژی» بدون هیچ برچسب‌گذاریِ دستی
 * ساخته می‌شود و با هر دانلودِ تازه خودش به‌روز می‌ماند.
 */
export default function PlaylistsView({ onOpenLiked }: { onOpenLiked: () => void }) {
  const { t } = useI18n()
  const [lists, setLists] = useState<UserPlaylist[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      setLists(await api.playlists())
    } catch {
      // null یعنی «خطا» — اگر [] می‌شد، حالتِ خطا هرگز دیده نمی‌شد و
      // سرورِ خاموش مثلِ «هنوز پلی‌لیستی نساخته‌ای» جا می‌زد
      setLists(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (openId) {
    return (
      <Detail
        id={openId}
        onBack={() => {
          setOpenId(null)
          void load()
        }}
        onDeleted={() => {
          setOpenId(null)
          void load()
        }}
      />
    )
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner className="size-5 text-muted-2" />
      </div>
    )
  }

  if (lists === null) {
    return <EmptyState icon={<PlaylistIcon className="size-5" />} text={t.libraryUnavailable} />
  }

  return (
    <div className="space-y-4">
      <CreateForm onCreated={(created) => setLists([created, ...(lists ?? [])])} />

      {/*
       * کاشی‌های شبکه‌ای مثل آلبوم‌ها، و «لایک‌ها» همیشه اولِ صف.
       *
       * لایک‌ها پلی‌لیستِ سرور نیست — یک ستون روی جدولِ job‌هاست و صفحه‌اش همان
       * فیلترِ «فقط لایک‌ها»ی تبِ آهنگ‌ها. پس به‌جای باز کردنِ چیزی که وجود
       * ندارد، همان‌جا می‌برد.
       */}
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
        <button
          onClick={onOpenLiked}
          aria-label={t.favoritesOnly}
          className="group w-full rounded-xl p-2 text-start transition hover:bg-panel-2 motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.98]"
        >
          <span className="relative grid aspect-square w-full place-items-center overflow-hidden rounded-lg bg-gradient-to-br from-accent-2/70 to-accent/25 shadow-lg shadow-black/25">
            <HeartIcon className="size-8 text-accent-fg" filled />
          </span>
          <p className="mt-2 truncate text-xs">{t.liked}</p>
          <p className="truncate text-[10px] text-muted-2">{t.favoritesOnly}</p>
        </button>

        {lists.map((playlist) => (
          <button
            key={playlist.id}
            onClick={() => setOpenId(playlist.id)}
            className="group w-full rounded-xl p-2 text-start transition hover:bg-panel-2 motion-safe:hover:-translate-y-0.5 motion-safe:active:scale-[0.98]"
          >
            <span className="relative block">
              <Mosaic
                urls={playlist.artworkUrls}
                seed={playlist.id}
                alt={playlist.name}
                className="aspect-square w-full shadow-lg shadow-black/25"
                rounded="rounded-lg"
              />
              {playlist.kind === 'smart' && (
                <span className="glass-chip absolute end-1.5 top-1.5 grid size-6 place-items-center rounded-full text-accent">
                  <SparkleIcon className="size-3.5" />
                </span>
              )}
            </span>
            <p className="bidi mt-2 truncate text-xs">{playlist.name}</p>
            <p className="truncate text-[10px] text-muted-2">
              {t.playlistCount(playlist.trackCount)}
            </p>
          </button>
        ))}
      </div>

      {lists.length === 0 && (
        <p className="text-[11px] text-muted-2">{t.playlistEmpty}</p>
      )}
    </div>
  )
}
