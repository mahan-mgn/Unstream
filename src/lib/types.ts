export type Source = 'apple' | 'deezer' | 'soundcloud' | 'spotify' | 'youtube'

export const SOURCE_LABEL: Record<Source, string> = {
  apple: 'Apple',
  deezer: 'Deezer',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  youtube: 'YouTube',
}

/** کیفیت‌های قابل انتخاب در هدر */
export type Quality = '128' | '192' | '320' | 'original'

/** برچسب «اورجینال» ترجمه می‌شود، بقیه فقط عددند */
export const QUALITIES: { id: Quality; kbps: number | null }[] = [
  { id: '128', kbps: 128 },
  { id: '192', kbps: 192 },
  { id: '320', kbps: 320 },
  { id: 'original', kbps: null },
]

export interface Track {
  id: string
  title: string
  artist: string
  album?: string
  albumId?: string
  durationMs: number
  artworkUrl: string | null
  source: Source
  sourceUrl: string
  /** پری‌ویوی ۳۰ ثانیه‌ای؛ در مود ماک null است */
  previewUrl: string | null
  explicit?: boolean
}

export interface Artist {
  id: string
  name: string
  artworkUrl: string | null
  source: Source
  sourceUrl: string
  subtitle: string
}

export interface Album {
  id: string
  title: string
  artist: string
  year: number
  artworkUrl: string | null
  trackCount: number
  source: Source
  sourceUrl: string
}

export interface Playlist {
  id: string
  title: string
  owner: string
  trackCount: number
  artworkUrl: string | null
  source: Source
  sourceUrl: string
}

export interface AlbumDetail extends Album {
  durationMs: number
  tracks: Track[]
}

export interface SearchResults {
  query: string
  tracks: Track[]
  artists: Artist[]
  albums: Album[]
  playlists: Playlist[]
}

/** چرخه‌ی عمر یک کار دانلود */
export type JobStatus =
  | 'queued'
  | 'searching'
  | 'downloading'
  | 'tagging'
  | 'ready'
  | 'error'
  | 'canceled'

export interface DownloadProgress {
  status: JobStatus
  /** ۰ تا ۱۰۰ — فقط در downloading معنادار است */
  percent: number
  /** پیام خطا در صورت status === 'error' */
  error?: string
  /** لینک فایل آماده در صورت status === 'ready' */
  fileUrl?: string
  /** فرمت نهایی فایل، مثلاً mp3 */
  format?: string
}

export interface DownloadRequest {
  track: Track
  quality: Quality
}

/**
 * قرارداد لایه‌ی داده. مود ماک و مود HTTP هر دو این را پیاده می‌کنند،
 * پس UI هیچ‌وقت نمی‌داند دیتا از کجا می‌آید.
 */
export interface MusicApi {
  search(query: string, signal?: AbortSignal): Promise<SearchResults>
  /** ورودی می‌تواند id داخلی یا لینک اپل‌موزیک/اسپاتیفای/دیزر باشد */
  getAlbum(idOrUrl: string, signal?: AbortSignal): Promise<AlbumDetail>
  /**
   * شروع دانلود. onProgress تا رسیدن به وضعیت نهایی صدا زده می‌شود.
   * تابع برگشتی، کار را کنسل می‌کند.
   */
  download(req: DownloadRequest, onProgress: (p: DownloadProgress) => void): () => void
  /**
   * ZIP را روی سرور می‌سازد و آدرس دانلودش را برمی‌گرداند.
   *
   * عمداً URL برمی‌گرداند نه Blob: پاسخی که content-disposition دارد را مرورگر
   * مستقیم به‌عنوان دانلود می‌قاپد و fetch هیچ بدنه‌ای نمی‌بیند.
   * null یعنی پشتیبانی نمی‌شود (مود دمو).
   */
  zip(trackIds: string[], name: string): Promise<string | null>
}
