import { useI18n } from '../lib/i18n'
import { usePlayer, type PlayItem } from '../store/player'
import { PauseIcon, PlayIcon } from './icons'

/**
 * دکمه‌ی پخشِ یک ردیف.
 *
 * کل لیست را می‌گیرد نه فقط خودش را: کلیک روی ترک پنجم یعنی «از اینجا به بعد
 * را پخش کن»، وگرنه هر آهنگ که تمام می‌شد پخش می‌ایستاد.
 */
export default function PlayButton({
  items,
  index,
  className = '',
}: {
  items: PlayItem[]
  index: number
  className?: string
}) {
  const play = usePlayer((s) => s.play)
  const currentId = usePlayer((s) => s.queue[s.index]?.id ?? null)
  const playing = usePlayer((s) => s.playing)
  const { t } = useI18n()

  const item = items[index]
  const isCurrent = Boolean(item) && currentId === item.id
  const isPlaying = isCurrent && playing
  const label = isPlaying ? t.pause : t.playTrack(item?.track.title ?? '')

  return (
    <button
      onClick={() => play(items, index)}
      aria-label={label}
      title={label}
      className={`grid size-7 place-items-center rounded-md transition hover:bg-panel hover:text-fg ${
        isCurrent ? 'text-accent' : 'text-muted'
      } ${className}`}
    >
      {isPlaying ? <PauseIcon className="size-3.5" /> : <PlayIcon className="size-3.5" />}
    </button>
  )
}
