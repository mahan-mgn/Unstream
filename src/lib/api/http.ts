import type {
  AlbumDetail,
  ArtistDetail,
  DownloadProgress,
  LibraryPage,
  MusicApi,
  SearchResults,
} from '../types'

const BASE = '/api'

async function json<T>(path: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(BASE + path, { signal })
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  return (await res.json()) as T
}

function abortJob(jobId: string): Promise<unknown> {
  return fetch(`${BASE}/downloads/${jobId}`, { method: 'DELETE' }).catch(() => null)
}

/**
 * ZIP روی jobId های سرور کار می‌کند، ولی UI فقط trackId می‌شناسد.
 * این نگاشت را همین‌جا نگه می‌داریم تا از store بیرون بماند.
 */
const jobIdByTrack = new Map<string, string>()

/**
 * پیاده‌سازی واقعی روی بک‌اند FastAPI.
 * پروگرس از طریق SSE می‌آید: POST /downloads → {jobId} سپس GET /downloads/{jobId}/events
 */
export const httpApi: MusicApi = {
  search(query, signal) {
    return json<SearchResults>(`/search?q=${encodeURIComponent(query)}`, signal)
  },

  getAlbum(idOrUrl, signal) {
    return json<AlbumDetail>(`/album?ref=${encodeURIComponent(idOrUrl)}`, signal)
  },

  getArtist(idOrUrl, signal) {
    return json<ArtistDetail>(`/artist?ref=${encodeURIComponent(idOrUrl)}`, signal)
  },

  library(query, signal) {
    return json<LibraryPage>(`/library?q=${encodeURIComponent(query)}&limit=200`, signal)
  },

  async removeFromLibrary(jobId) {
    const res = await fetch(`${BASE}/library/${jobId}`, { method: 'DELETE' })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
  },

  download({ track, quality }, onProgress) {
    const ctrl = new AbortController()
    let events: EventSource | null = null
    let id: string | null = null

    onProgress({ status: 'queued', percent: 0 })

    fetch(`${BASE}/downloads`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // متادیتا را همراه می‌فرستیم تا سرور برای تگ‌گذاری دوباره lookup نزند
      body: JSON.stringify({
        trackId: track.id,
        sourceUrl: track.sourceUrl,
        quality,
        title: track.title,
        artist: track.artist,
        album: track.album,
        durationMs: track.durationMs,
        artworkUrl: track.artworkUrl,
      }),
      signal: ctrl.signal,
    })
      .then((r) => {
        if (!r.ok) throw new Error(`${r.status}`)
        return r.json() as Promise<{ jobId: string; reused: boolean }>
      })
      .then(({ jobId }) => {
        id = jobId
        jobIdByTrack.set(track.id, jobId)
        // لغو قبل از رسیدن jobId: حالا که id داریم، به سرور هم خبر بده
        if (ctrl.signal.aborted) {
          void abortJob(jobId)
          return
        }
        events = new EventSource(`${BASE}/downloads/${jobId}/events`)
        events.onmessage = (e) => {
          const p = JSON.parse(e.data) as DownloadProgress
          onProgress(p)
          if (p.status === 'ready' || p.status === 'error' || p.status === 'canceled') {
            events?.close()
          }
        }
        events.onerror = () => {
          events?.close()
          onProgress({ status: 'error', percent: 0, error: 'ارتباط با سرور قطع شد' })
        }
      })
      .catch((err: unknown) => {
        if (ctrl.signal.aborted) return
        onProgress({
          status: 'error',
          percent: 0,
          error: err instanceof Error ? err.message : 'خطای ناشناخته',
        })
      })

    return () => {
      ctrl.abort()
      events?.close()
      // بستن EventSource کار را روی سرور متوقف نمی‌کند — باید صریح لغو شود
      if (id) void abortJob(id)
    }
  },

  async zip(trackIds, name) {
    const jobIds = trackIds
      .map((id) => jobIdByTrack.get(id))
      .filter((id): id is string => Boolean(id))
    if (!jobIds.length) return null

    const res = await fetch(`${BASE}/downloads/zip`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobIds, name }),
    })
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`)
    const { url } = (await res.json()) as { url: string }
    return url
  },
}
