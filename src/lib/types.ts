export type Source = 'apple' | 'deezer' | 'soundcloud' | 'spotify' | 'youtube'

export const SOURCE_LABEL: Record<Source, string> = {
  apple: 'Apple',
  deezer: 'Deezer',
  soundcloud: 'SoundCloud',
  spotify: 'Spotify',
  youtube: 'YouTube',
}

/** کیفیت‌های قابل انتخاب در هدر */
export type Quality = '128' | '192' | '320' | 'm4a' | 'opus' | 'flac' | 'original'

/**
 * دو دسته‌اند و در UI هم جدا نشان داده می‌شوند: بیت‌ریت mp3 (فقط عدد) و کدک
 * (اسم خودش). «اورجینال» یعنی هیچ ترنسکدی — همان چیزی که منبع داده.
 */
export const MP3_QUALITIES: { id: Quality; kbps: number }[] = [
  { id: '128', kbps: 128 },
  { id: '192', kbps: 192 },
  { id: '320', kbps: 320 },
]

export const CODEC_QUALITIES: { id: Quality; label: string }[] = [
  { id: 'm4a', label: 'm4a' },
  { id: 'opus', label: 'opus' },
  { id: 'flac', label: 'flac' },
]

export const QUALITIES: Quality[] = [
  ...MP3_QUALITIES.map((q) => q.id),
  ...CODEC_QUALITIES.map((q) => q.id),
  'original',
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

/** صفحه‌ی هنرمند: چند ترک محبوب به‌علاوه‌ی دیسکوگرافی */
export interface ArtistDetail extends Artist {
  topTracks: Track[]
  albums: Album[]
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
  /** فایل سالم است ولی چیزی مشکوک بوده — مثلاً AcoustID ترک دیگری را شناخته */
  warning?: string
  /** فایل .lrc اگر متن هم‌زمان‌شده پیدا شده باشد */
  lyricsUrl?: string
}

export interface DownloadRequest {
  track: Track
  quality: Quality
}

/** یک فایل آماده روی دیسک سرور */
export interface LibraryItem {
  jobId: string
  track: Track
  quality: Quality
  format?: string
  bytes: number
  fileUrl: string
  lyricsUrl?: string
  /** ثانیه‌ی یونیکس */
  createdAt: number
}

export interface LibraryPage {
  items: LibraryItem[]
  total: number
  totalBytes: number
}

/**
 * قرارداد لایه‌ی داده. مود ماک و مود HTTP هر دو این را پیاده می‌کنند،
 * پس UI هیچ‌وقت نمی‌داند دیتا از کجا می‌آید.
 */
export interface MusicApi {
  search(query: string, signal?: AbortSignal): Promise<SearchResults>
  /** ورودی می‌تواند id داخلی یا لینک اپل‌موزیک/اسپاتیفای/دیزر باشد */
  getAlbum(idOrUrl: string, signal?: AbortSignal): Promise<AlbumDetail>
  /** ورودی id داخلی هنرمند یا لینک اپل‌موزیک/دیزر */
  getArtist(idOrUrl: string, signal?: AbortSignal): Promise<ArtistDetail>
  /**
   * کتابخانه‌ی محلی — فایل‌هایی که قبلاً دانلود شده‌اند و هنوز روی دیسک سرورند.
   * null یعنی این لایه کتابخانه ندارد (مود دمو).
   */
  library(query: string, signal?: AbortSignal): Promise<LibraryPage | null>
  /** حذف کامل یک مورد از کتابخانه: فایل و ردیفش */
  removeFromLibrary(jobId: string): Promise<void>
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
