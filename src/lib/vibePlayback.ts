import { api } from './api'
import type { Quality, Track } from './types'
import type { PlayItem } from '../store/player'

export interface QueueDownloadResult {
  item: PlayItem | null
  /** پیامِ خطای سرور (مثلاً «نسخه‌ی قابل دانلودی پیدا نشد») — برای نمایش دلیلِ شکست */
  error?: string
}

/**
 * دانلود یک ترکِ پیشنهادیِ چت‌بات وایب و صبر تا آماده شدن. هم‌شکلِ
 * `downloadRadioTrack` در radio.ts، فقط خروجی‌اش هم PlayItemِ کامل می‌دهد
 * (چون مستقیم به صفِ پخش اضافه می‌شود) هم پیامِ خطا را نگه می‌دارد — بدون آن
 * UI فقط می‌دانست ترک شکست خورده، نه چرا.
 */
export function downloadForQueue(track: Track, quality: Quality): Promise<QueueDownloadResult> {
  return new Promise((resolve) => {
    api.download({ track, quality }, (p) => {
      if (p.status === 'ready') {
        resolve(
          p.streamUrl
            ? {
                item: {
                  id: `vibe-${track.id}-${Date.now()}`,
                  track,
                  streamUrl: p.streamUrl,
                  lyricsUrl: p.lyricsUrl,
                  gainDb: p.gainDb,
                },
              }
            : { item: null },
        )
      } else if (p.status === 'error' || p.status === 'canceled') {
        resolve({ item: null, error: p.error })
      }
    })
  })
}
