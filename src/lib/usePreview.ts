import { useEffect, useRef, useState } from 'react'
import { claimAudio, registerAudio } from './audioFocus'
import type { Track } from './types'

const PREVIEW_MS = 30_000

/**
 * پخش پیش‌نمایش ۳۰ ثانیه‌ای.
 * اگر previewUrl واقعی باشد با <audio> پخش می‌شود؛
 * در مود ماک که لینکی وجود ندارد، فقط وضعیت «در حال پخش» شبیه‌سازی می‌شود.
 */
export function usePreview() {
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audio = useRef<HTMLAudioElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stop = () => {
    audio.current?.pause()
    audio.current = null
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setPlayingId(null)
  }

  useEffect(() => stop, [])

  // پخش‌کننده‌ی کتابخانه باید بتواند این را ساکت کند و برعکس
  useEffect(() => registerAudio('preview', stop), [])

  const toggle = (track: Track) => {
    if (playingId === track.id) {
      stop()
      return
    }
    stop()
    claimAudio('preview')
    setPlayingId(track.id)

    if (track.previewUrl) {
      const el = new Audio(track.previewUrl)
      el.play().catch(() => stop())
      el.onended = () => stop()
      audio.current = el
    }
    // `stop` و نه فقط `setPlayingId(null)`: این تایمر سقفِ ۳۰ ثانیه است و با
    // پاک‌کردنِ صرفِ وضعیت، خودِ `<audio>` همچنان صدا می‌داد — یعنی پیش‌نمایشی
    // بلندتر از این سقف، بی‌آنکه دکمه‌ای برای قطعش باشد ادامه پیدا می‌کرد
    timer.current = setTimeout(() => stop(), PREVIEW_MS)
  }

  return { playingId, toggle, stop }
}
