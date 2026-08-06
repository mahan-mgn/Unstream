import type {
  AlbumDetail,
  DownloadProgress,
  DownloadRequest,
  MusicApi,
  SearchResults,
} from '../types'
import {
  ALBUMS,
  albumDetail,
  ARTISTS,
  artistDetail,
  PLAYLISTS,
  TOP_TRACKS,
} from './catalog'

const wait = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(t)
      reject(new DOMException('aborted', 'AbortError'))
    })
  })

/** عدد شبه‌تصادفی ولی پایدار برای یک کلید مشخص */
function seeded(key: string): number {
  let h = 2166136261
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1000) / 1000
}

export const mockApi: MusicApi = {
  async search(query, signal) {
    await wait(700 + seeded(query) * 600, signal)
    const results: SearchResults = {
      query,
      tracks: TOP_TRACKS,
      artists: ARTISTS,
      albums: ALBUMS,
      playlists: PLAYLISTS,
    }
    return results
  },

  async getAlbum(idOrUrl, signal) {
    await wait(600, signal)
    const album =
      ALBUMS.find((a) => a.id === idOrUrl) ??
      ALBUMS.find((a) => idOrUrl.includes(a.sourceUrl)) ??
      // لینک ناشناس: با اسلاگِ داخل لینک حدس بزن، وگرنه آلبوم اول
      ALBUMS.find((a) => idOrUrl.toLowerCase().includes(a.title.toLowerCase().slice(0, 6))) ??
      ALBUMS[0]
    return albumDetail(album) satisfies AlbumDetail
  },

  async getArtist(idOrUrl, signal) {
    await wait(500, signal)
    const artist =
      ARTISTS.find((a) => a.id === idOrUrl) ??
      ARTISTS.find((a) => idOrUrl.includes(a.sourceUrl)) ??
      ARTISTS[ARTISTS.length - 1]
    return artistDetail(artist)
  },

  async library() {
    // کتابخانه فایل واقعی روی دیسک سرور است؛ در مود دمو سروری در کار نیست
    return null
  },

  async removeFromLibrary() {},

  download({ track, quality }: DownloadRequest, onProgress) {
    let canceled = false
    let timer: ReturnType<typeof setTimeout>

    const emit = (p: DownloadProgress) => {
      if (!canceled) onProgress(p)
    }

    const step = (fn: () => void, ms: number) => {
      timer = setTimeout(() => {
        if (!canceled) fn()
      }, ms)
    }

    // یکی از هر ۸ ترک را عمداً خطا می‌دهیم تا مسیر «تلاش دوباره» هم دیده شود
    const roll = seeded(track.id + quality)
    const shouldFail = roll > 0.88

    emit({ status: 'queued', percent: 0 })

    step(() => {
      emit({ status: 'searching', percent: 0 })

      step(() => {
        if (shouldFail) {
          emit({
            status: 'error',
            percent: 0,
            error: 'نسخه‌ی قابل دانلودی برای این آهنگ پیدا نشد',
          })
          return
        }

        let percent = 0
        const tick = () => {
          if (canceled) return
          percent = Math.min(100, percent + 1.2 + roll * 2.2)
          if (percent < 100) {
            emit({ status: 'downloading', percent })
            step(tick, 200 + roll * 180)
          } else {
            emit({ status: 'downloading', percent: 100 })
            step(() => {
              emit({ status: 'tagging', percent: 100 })
              step(() => {
                // سرور واقعی فرمتِ به‌دست‌آمده را می‌دهد، نه کیفیت درخواستی
                const format =
                  quality === 'original'
                    ? 'm4a 256'
                    : /^\d+$/.test(quality)
                      ? `mp3 ${quality}`
                      : quality === 'flac'
                        ? 'flac 16/44'
                        : `${quality} 160`
                emit({
                  status: 'ready',
                  percent: 100,
                  format,
                  // در مود ماک فایل واقعی وجود ندارد
                  fileUrl: undefined,
                })
              }, 500)
            }, 300)
          }
        }
        tick()
      }, 900 + roll * 1400)
    }, 250)

    return () => {
      canceled = true
      clearTimeout(timer!)
    }
  },

  async zip() {
    // مود دمو فایل واقعی تولید نمی‌کند، پس ZIPی هم در کار نیست
    return null
  },
}
