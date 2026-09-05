import { useI18n } from '../lib/i18n'
import type { Track } from '../lib/types'
import { useSettings } from '../store/settings'
import { albumKey, trackKey, usable, useTelegram } from '../store/telegram'
import { CheckIcon, Spinner, TelegramIcon, WarnIcon } from './icons'

/**
 * دکمه‌ی «بفرست به تلگرام» — کنارِ هر آهنگ و هر آلبوم.
 *
 * کارِ سنگین سمتِ بات است (دانلود، تگ، آپلود)، پس این دکمه فقط ردیفی در صف
 * می‌گذارد و بعد پیگیری می‌کند. سه حالتِ دیدنی دارد و هر سه لازم‌اند: اسپینر
 * تا وقتی بات مشغول است، تیک وقتی رسید، و علامتِ خطا وقتی نرسید — «فرستاده
 * شد»ِ فوری دروغ بود، چون در آن لحظه هنوز هیچ فایلی وجود ندارد.
 */

type Target =
  | { kind: 'track'; track: Track }
  | { kind: 'album'; ref: string; title: string }

interface Props {
  target: Target
  /**
   * فقط روی کاور دیده شود، آن هم با هاور.
   *
   * پیش‌فرض همیشه-دیدنی است چون در ردیف‌ها و هدرها کنارِ دکمه‌های دیگر
   * می‌نشیند و پنهان‌بودنش شبیه «نیست» می‌شد، نه «هست ولی ظریف». فقط روی
   * کارتِ آلبوم پنهان می‌ماند، چون آنجا روی خودِ کاور می‌افتد و همسایه‌اش
   * (بجِ منبع) هم همین رفتار را دارد.
   */
  hoverOnly?: boolean
  className?: string
}

export default function SendToTelegram({ target, hoverOnly = false, className = '' }: Props) {
  const { t } = useI18n()
  const quality = useSettings((s) => s.quality)
  const ready = useTelegram(usable)
  const key = target.kind === 'track' ? trackKey(target.track.id) : albumKey(target.ref)
  const state = useTelegram((s) => s.sends[key])
  const why = useTelegram((s) => s.errors[key])

  // سروری که باتش بالا نیست نباید دکمه‌ی بی‌اثر نشان بدهد
  if (!ready) return null

  const busy = state === 'pending' || state === 'sending'
  const label =
    target.kind === 'track' ? t.telegramSendTrack(target.track.title) : t.telegramSendAlbum(target.title)

  // خودِ استور toast می‌زند — اینجا فقط درخواست. keep=false یعنی «فقط تلگرام»:
  // به کتابخانه اضافه نمی‌شود، بعد از آپلود فایل و ردیفش پاک می‌شوند.
  const send = () =>
    void useTelegram.getState().send(
      target.kind === 'track'
        ? { kind: 'track', track: target.track, quality, keep: false }
        : { kind: 'album', ref: target.ref, title: target.title, quality, keep: false },
    )

  return (
    <button
      onClick={send}
      disabled={busy}
      aria-label={label}
      // دلیلِ واقعیِ شکست، نه یک جمله‌ی عمومی — همان چیزی که سرور گفته
      title={state === 'error' ? (why ?? t.telegramFailed) : label}
      // همان زبانِ رنگیِ دکمه‌های همسایه (پخش، دانلود، متن): خاکستریِ آرام،
      // روشن با هاور، و رنگِ وضعیت فقط وقتی واقعاً وضعیتی هست
      className={`grid size-7 place-items-center rounded-md transition hover:bg-panel-2 disabled:cursor-default ${
        state === 'done' || busy
          ? 'text-accent'
          : state === 'error'
            ? 'text-danger'
            : 'text-muted hover:text-fg'
      } ${hoverOnly ? 'hover-reveal opacity-0 focus-visible:opacity-100 group-hover:opacity-100' : ''} ${className}`}
    >
      {busy ? (
        <Spinner className="size-4" />
      ) : state === 'done' ? (
        <CheckIcon className="size-4" />
      ) : state === 'error' ? (
        <WarnIcon className="size-4" />
      ) : (
        <TelegramIcon className="size-4" />
      )}
    </button>
  )
}
