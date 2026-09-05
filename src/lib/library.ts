import type { LibraryItem } from './types'

/**
 * منطقِ چیدنِ کتابخانه — فیلتر، مرتب‌سازی و گروه‌بندی.
 *
 * از کامپوننت جدا ماند چون هیچ‌کدامشان به React ربطی ندارند و همین‌جا
 * تست‌پذیرند: «آلبوم‌ها» و «هنرمندان» چیزی نیستند که سرور بدهد، از روی
 * همان ردیف‌های تختِ کتابخانه ساخته می‌شوند.
 */

export type LibrarySort = 'recent' | 'title' | 'artist' | 'size' | 'duration' | 'plays'

export const LIBRARY_SORTS: LibrarySort[] = ['recent', 'title', 'artist', 'size', 'duration', 'plays']

/**
 * مقایسه‌ی متنی با آگاهی از زبان — `<` روی رشته یعنی ترتیبِ کدِ یونیکد، که
 * فارسی را بعدِ همه‌ی لاتین‌ها می‌چیند و «الف» و «آ» را دو حرفِ بی‌ربط می‌بیند.
 */
const collator = new Intl.Collator(['fa', 'en'], { sensitivity: 'base', numeric: true })

const searchText = (item: LibraryItem): string =>
  `${item.track.title} ${item.track.artist} ${item.track.album ?? ''}`.toLowerCase()

export function matches(item: LibraryItem, query: string): boolean {
  const q = query.trim().toLowerCase()
  return !q || searchText(item).includes(q)
}

export function filterItems(items: LibraryItem[], query: string): LibraryItem[] {
  const q = query.trim().toLowerCase()
  return q ? items.filter((item) => searchText(item).includes(q)) : items
}

/**
 * ترتیبِ ردیف‌ها.
 *
 * «تازه‌ترین» نزولی است و بقیه صعودی — چون «حجم» و «مدت» را کاربر برای پیدا
 * کردنِ بزرگ‌ترین‌ها می‌زند، نه کوچک‌ترین‌ها.
 */
export function sortItems(items: LibraryItem[], sort: LibrarySort): LibraryItem[] {
  const sorted = [...items]
  switch (sort) {
    case 'title':
      sorted.sort((a, b) => collator.compare(a.track.title, b.track.title))
      break
    case 'artist':
      sorted.sort(
        (a, b) =>
          collator.compare(a.track.artist, b.track.artist) ||
          collator.compare(a.track.title, b.track.title),
      )
      break
    case 'size':
      sorted.sort((a, b) => b.bytes - a.bytes)
      break
    case 'duration':
      sorted.sort((a, b) => b.track.durationMs - a.track.durationMs)
      break
    case 'plays':
      // بیشترین پخش اول؛ تساوی با تازه‌ترین دانلود شکسته می‌شود تا ترتیب
      // پایدار و قابل‌پیش‌بینی بماند
      sorted.sort((a, b) => (b.playCount ?? 0) - (a.playCount ?? 0) || b.createdAt - a.createdAt)
      break
    default:
      sorted.sort((a, b) => b.createdAt - a.createdAt)
  }
  return sorted
}

/** یک آلبوم یا هنرمند، ساخته‌شده از ردیف‌های کتابخانه */
export interface LibraryGroup {
  key: string
  title: string
  /** برای آلبوم نامِ هنرمند است؛ برای خودِ هنرمند خالی می‌ماند */
  artist: string
  /** بذرِ رنگِ کاورِ جایگزین وقتی تصویری نیست */
  seed: string
  /** حداکثر چهار کاورِ متمایز — کاشیِ موزاییکی از همین ساخته می‌شود */
  artworkUrls: string[]
  items: LibraryItem[]
  bytes: number
  durationMs: number
  /** تازه‌ترین دانلودِ درونِ گروه — مرتب‌سازیِ «تازه‌ترین» روی همین می‌نشیند */
  createdAt: number
  /** جمع پخش‌های ترک‌های گروه — مرتب‌سازیِ «بیشترین پخش» روی همین است */
  playCount: number
  /** فقط برای گروهِ هنرمند معنا دارد */
  albumCount: number
}

function makeGroup(key: string, title: string, artist: string, items: LibraryItem[]): LibraryGroup {
  const artworkUrls = [
    ...new Set(items.map((x) => x.track.artworkUrl).filter((url): url is string => Boolean(url))),
  ].slice(0, 4)

  return {
    key,
    title,
    artist,
    seed: key,
    artworkUrls,
    items,
    bytes: items.reduce((sum, x) => sum + x.bytes, 0),
    durationMs: items.reduce((sum, x) => sum + x.track.durationMs, 0),
    createdAt: items.reduce((max, x) => Math.max(max, x.createdAt), 0),
    playCount: items.reduce((sum, x) => sum + (x.playCount ?? 0), 0),
    albumCount: new Set(items.map((x) => x.track.album ?? x.track.title)).size,
  }
}

/** هنرمندی که آلبوم به نامِ اوست — نه مهمان‌هایی که فقط در یک ترک‌اند */
const albumArtistOf = (track: LibraryItem['track']): string => track.albumArtist || track.artist

/** ترکِ بی‌شماره ته صف می‌ماند — عددِ متناهی، چون `Infinity - Infinity` NaN است */
const UNNUMBERED = Number.MAX_SAFE_INTEGER

/**
 * ترتیبِ درونِ آلبوم: دیسک، بعد شماره‌ی ترک، بعد قدیمی‌ترین دانلود.
 *
 * ترتیبِ انتخابیِ کاربر («تازه‌ترین»، «حجم») برای فهرستِ آلبوم‌ها معنا دارد ولی
 * برای داخلِ یک آلبوم نه — آنجا فقط یک ترتیبِ درست هست: همانی که در خودِ
 * پلتفرم دیده می‌شود.
 *
 * تکیه‌گاهِ آخر عمدی است: ردیف‌هایی که قبل از شماره‌دار شدنِ ترک‌ها دانلود
 * شده‌اند شماره ندارند، و «دانلودِ همه»ی یک آلبوم آن‌ها را به‌ترتیبِ خودِ آلبوم
 * صف کرده — پس زمانِ دانلود، ترتیبِ آلبوم را تقریب می‌زند. بدون آن، مرتب‌سازیِ
 * پیش‌فرضِ کتابخانه («تازه‌ترین») آلبوم را وارونه نشان می‌داد.
 */
const byTrackNumber = (a: LibraryItem, b: LibraryItem): number =>
  (a.track.discNumber ?? 1) - (b.track.discNumber ?? 1) ||
  (a.track.trackNumber ?? UNNUMBERED) - (b.track.trackNumber ?? UNNUMBERED) ||
  a.createdAt - b.createdAt

/**
 * تک‌آهنگ هم یک آلبوم است — دقیقاً همان‌طور که اسپاتیفای نشانش می‌دهد. بدون
 * این، هرچه بدونِ متادیتای آلبوم دانلود شده بود از تبِ آلبوم‌ها غیبش می‌زد.
 *
 * کلید با هنرمندِ آلبوم ساخته می‌شود نه هنرمندِ ترک: آلبومی که چند ترکش مهمان
 * دارد وگرنه به چند کارتِ هم‌نامِ تک‌ترکه می‌شکست — همان چیزی که در پلیرهای
 * بیرونی هم می‌دیدیم.
 */
export function groupByAlbum(items: LibraryItem[]): LibraryGroup[] {
  const buckets = new Map<string, LibraryItem[]>()
  for (const item of items) {
    const { track } = item
    const name = track.album?.trim() || track.title
    const key = track.albumId ?? `${albumArtistOf(track).toLowerCase()}::${name.toLowerCase()}`
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }

  return [...buckets].map(([key, bucket]) => {
    const ordered = [...bucket].sort(byTrackNumber)
    const head = ordered[0].track
    return makeGroup(key, head.album?.trim() || head.title, albumArtistOf(head), ordered)
  })
}

/**
 * کلیدِ ادغامِ هنرمند — همان قاعده‌ی `_artist_key` در `server/app/db.py`:
 * جداکننده‌های همکاری («, » « & » « x » « / ») نرمال، بی‌توجه به حروف و
 * ترتیبِ اعضا. بدونِ این، «A, B» و «A & B» (دو نگارشِ یک همکاری از دو
 * کاتالوگ) در تبِ هنرمندانِ کتابخانه دو ردیف می‌شوند.
 */
const ARTIST_SEP = /\s*[,;&/]\s*|\s+x\s+|\s+×\s+/
const artistKey = (name: string): string =>
  [...name.toLowerCase().split(ARTIST_SEP)]
    .map((p) => p.trim())
    .filter(Boolean)
    .sort()
    .join(', ')

export function groupByArtist(items: LibraryItem[]): LibraryGroup[] {
  const buckets = new Map<string, LibraryItem[]>()
  for (const item of items) {
    // نامِ هنرمند تنها چیزی است که داریم؛ شناسه‌ی ترک به هنرمند اشاره نمی‌کند
    // و همان هنرمند از دو کاتالوگ دو شناسه دارد
    const key = artistKey(item.track.artist)
    const bucket = buckets.get(key)
    if (bucket) bucket.push(item)
    else buckets.set(key, [item])
  }

  return [...buckets].map(([key, bucket]) => makeGroup(key, bucket[0].track.artist, '', bucket))
}

export function sortGroups(groups: LibraryGroup[], sort: LibrarySort): LibraryGroup[] {
  const sorted = [...groups]
  switch (sort) {
    case 'title':
      sorted.sort((a, b) => collator.compare(a.title, b.title))
      break
    case 'artist':
      sorted.sort(
        (a, b) =>
          collator.compare(a.artist || a.title, b.artist || b.title) ||
          collator.compare(a.title, b.title),
      )
      break
    case 'size':
      sorted.sort((a, b) => b.bytes - a.bytes)
      break
    case 'duration':
      sorted.sort((a, b) => b.durationMs - a.durationMs)
      break
    case 'plays':
      sorted.sort((a, b) => b.playCount - a.playCount || b.createdAt - a.createdAt)
      break
    default:
      sorted.sort((a, b) => b.createdAt - a.createdAt)
  }
  return sorted
}

export interface LibraryStats {
  tracks: number
  albums: number
  artists: number
  bytes: number
  durationMs: number
}

export function libraryStats(items: LibraryItem[]): LibraryStats {
  return {
    tracks: items.length,
    albums: groupByAlbum(items).length,
    artists: groupByArtist(items).length,
    bytes: items.reduce((sum, x) => sum + x.bytes, 0),
    durationMs: items.reduce((sum, x) => sum + x.track.durationMs, 0),
  }
}
