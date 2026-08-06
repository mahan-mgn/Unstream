import { useEffect, useRef, useState } from 'react'
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

  const toggle = (track: Track) => {
    if (playingId === track.id) {
      stop()
      return
    }
    stop()
    setPlayingId(track.id)

    if (track.previewUrl) {
      const el = new Audio(track.previewUrl)
      el.play().catch(() => setPlayingId(null))
      el.onended = () => setPlayingId(null)
      audio.current = el
    }
    timer.current = setTimeout(() => setPlayingId(null), PREVIEW_MS)
  }

  return { playingId, toggle, stop }
}
