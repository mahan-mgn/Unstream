import { create } from 'zustand'
import { fa } from './format'

export type Lang = 'fa' | 'en'

/**
 * دیکشنری. مقدارها یا رشته‌اند یا تابعی که پارامتر می‌گیرد.
 * کلیدها عمداً تخت‌اند تا جستجو در کد ساده بماند.
 */
const DICT = {
  fa: {
    brand: 'آنستریم',
    quality: 'کیفیت',
    qualityOriginal: 'اورجینال',
    qualityMp3: 'ام‌پی‌تری',
    qualityCodec: 'کدک',
    qualityMenu: 'انتخاب کیفیت',
    themeLight: 'لایت',
    themeDark: 'دارک',

    heroLine1: 'دانلود موزیک،',
    heroLine2: 'آلبوم و پلی‌لیست',
    heroBody:
      'لینک اسپاتیفای، دیزر، اپل‌موزیک، یوتیوب یا ساندکلاد رو بچسبون — یا همه‌ی کاتالوگ‌ها رو یک‌جا جستجو کن. آنستریم فایل صوتی رو پیدا می‌کند و هر MP3 را برایت تگ می‌زند. بدون حساب کاربری، بدون کلید.',
    searchPlaceholder: 'اسم آهنگ، آلبوم یا هنرمند — یا لینک اسپاتیفای/دیزر/یوتیوب/ساندکلاد',
    search: 'جستجو',
    open: 'بازکن',
    searching: 'در حال جستجو…',
    searchHint: 'برای جستجو {kbd} رو بزن، یا هر جای صفحه لینک رو پیست کن.',

    resultsFor: (q: string) => `نتایج برای ${q}`,
    foundSoFar: (n: number) => `${fa(n)} نتیجه`,
    all: 'همه',
    songs: 'آهنگ‌ها',
    artists: 'هنرمندان',
    albums: 'آلبوم‌ها',
    playlists: 'پلی‌لیست‌ها',
    showAll: (n: number) => `نمایش همه‌ی ${fa(n)}`,
    collapse: 'بستن',
    noResults: (q: string) => `برای «${q}» چیزی پیدا نشد. املا رو چک کن یا مستقیم لینک رو پیست کن.`,

    backToResults: 'برگشت به نتایج',
    typeAlbum: 'آلبوم',
    typeSong: 'آهنگ',
    typePlaylist: 'پلی‌لیست',
    trackCount: (n: number) => `${fa(n)} آهنگ`,
    minutes: (n: number) => `${fa(n)} دقیقه`,
    hoursMinutes: (h: number, m: number) =>
      m ? `${fa(h)} ساعت و ${fa(m)} دقیقه` : `${fa(h)} ساعت`,
    selectAll: 'انتخاب همه',
    clearSelection: 'برداشتن انتخاب',
    tickHint: (n: number) => `${fa(n)} آهنگ — هرکدوم رو تیک بزنی فقط همون‌ها دانلود میشن`,
    downloadAll: 'دانلود همه',
    downloadN: (n: number) => `دانلود ${fa(n)} تا`,
    openSource: 'باز کردن منبع',
    zip: (n: number) => `ZIP (${fa(n)})`,
    zipTitle: 'دانلود همه در یک فایل ZIP',
    starting: 'شروع…',
    ofTotal: (done: number, total: number) => `${fa(done)}/${fa(total)}`,

    downloads: 'دانلودها',
    inProgress: (n: number) => `${fa(n)} در جریان`,
    finished: (n: number) => `${fa(n)} تمام‌شده`,
    clearDone: 'پاک‌سازی',
    collapsePanel: 'جمع کردن',
    expandPanel: 'نمایش صف دانلود',
    downloadedOf: (done: number, total: number) => `${fa(done)} از ${fa(total)} دانلود شد`,
    timeLeft: (t: string) => `${t} باقی‌مانده`,
    secondsShort: (s: number) => `~${fa(s)} ثانیه`,
    minutesShort: (m: number) => `~${fa(m)} دقیقه`,

    stQueued: 'در صف',
    stSearching: 'در حال جستجو…',
    stDownloading: (p: string) => `در حال دانلود ${p}`,
    stTagging: 'در حال تگ‌گذاری…',
    stReady: 'آماده',
    stError: 'خطا',
    stCanceled: 'لغو شد',
    retry: 'تلاش دوباره',
    cancel: 'لغو',
    remove: 'حذف از لیست',
    save: 'ذخیره روی دیسک',
    mockNoFile: 'در مود دمو فایل واقعی وجود ندارد',

    preview: 'پیش‌نمایش',
    stopPreview: 'توقف پیش‌نمایش',
    downloadTrack: (t: string) => `دانلود ${t}`,
    selectTrack: (t: string) => `انتخاب ${t}`,
    cancelDownload: 'لغو دانلود',
    close: 'بستن',

    toastQueued: (t: string) => `رفت تو صف «${t}»`,
    toastReady: (t: string) => `آهنگ «${t}» آماده‌ی ذخیره‌ست`,
    toastFailed: (t: string) => `«${t}» دانلود نشد`,
    toastAlready: (t: string) => `«${t}» از قبل تو صفه`,
    toastZipFailed: 'ساخت فایل ZIP ناموفق بود',
    fetchError: 'خطا در دریافت اطلاعات',

    library: 'کتابخانه',
    libraryEmpty: 'هنوز چیزی دانلود نکرده‌ای. هرچه بگیری اینجا می‌ماند.',
    libraryUnavailable: 'کتابخانه فقط با بک‌اند واقعی کار می‌کند — در مود دمو فایلی روی دیسک نیست.',
    librarySearch: 'جستجو در کتابخانه',
    librarySummary: (n: number, size: string) => `${fa(n)} فایل — ${size}`,
    libraryNoMatch: 'چیزی با این عبارت در کتابخانه نبود.',
    libraryRemove: 'حذف از کتابخانه',
    libraryRemoved: (t: string) => `«${t}» از کتابخانه پاک شد`,
    libraryRemoveFailed: 'حذف انجام نشد',
    reused: (t: string) => `«${t}» از قبل دانلود شده بود — از کتابخانه برداشته شد`,
    lyrics: 'متن هم‌زمان‌شده',
    savedAt: (d: string) => `${d}`,

    topTracks: 'آهنگ‌های محبوب',
    discography: 'دیسکوگرافی',
    albumCount: (n: number) => `${fa(n)} آلبوم`,
    backToArtist: 'برگشت به هنرمند',
    artistNotFound: 'صفحه‌ی این هنرمند در دسترس نیست',

    demoMode: 'مود دمو — داده‌ها ماک هستند',
    builtBy: 'ساخته‌شده توسط',
    and: 'و',
    langSwitch: 'English',
  },

  en: {
    brand: 'Unstream',
    quality: 'Quality',
    qualityOriginal: 'Original',
    qualityMp3: 'MP3',
    qualityCodec: 'Codec',
    qualityMenu: 'Pick a quality',
    themeLight: 'Light',
    themeDark: 'Dark',

    heroLine1: 'Your music library,',
    heroLine2: 'as files.',
    heroBody:
      'Paste a Spotify, Deezer, Apple Music, YouTube or SoundCloud link — or search every catalog at once. Unstream finds the audio and tags every mp3 for you. No accounts, no keys.',
    searchPlaceholder: 'Search songs, albums, artists — or paste a Spotify / Deezer / YouTube / SoundCloud link',
    search: 'Search',
    open: 'Open',
    searching: 'Searching…',
    searchHint: 'Press {kbd} to search, or just paste a link anywhere on the page.',

    resultsFor: (q: string) => `Results for ${q}`,
    foundSoFar: (n: number) => `${n} found so far`,
    all: 'All',
    songs: 'Songs',
    artists: 'Artists',
    albums: 'Albums',
    playlists: 'Playlists',
    showAll: (n: number) => `Show all ${n}`,
    collapse: 'Collapse',
    noResults: (q: string) => `Nothing found for “${q}”. Check the spelling, or paste a link instead.`,

    backToResults: 'Back to results',
    typeAlbum: 'Album',
    typeSong: 'Song',
    typePlaylist: 'Playlist',
    trackCount: (n: number) => `${n} track${n === 1 ? '' : 's'}`,
    minutes: (n: number) => `${n} min`,
    hoursMinutes: (h: number, m: number) => (m ? `${h} hr ${m} min` : `${h} hr`),
    selectAll: 'Select all',
    clearSelection: 'Clear selection',
    tickHint: (n: number) => `${n} tracks — tick any to download just those`,
    downloadAll: 'Download all',
    downloadN: (n: number) => `Download ${n}`,
    openSource: 'Open source page',
    zip: (n: number) => `ZIP (${n})`,
    zipTitle: 'Download everything as one ZIP',
    starting: 'Starting…',
    ofTotal: (done: number, total: number) => `${done}/${total}`,

    downloads: 'Downloads',
    inProgress: (n: number) => `${n} in progress`,
    finished: (n: number) => `${n} finished`,
    clearDone: 'Clear',
    collapsePanel: 'Collapse',
    expandPanel: 'Show downloads',
    downloadedOf: (done: number, total: number) => `${done} of ${total} downloaded`,
    timeLeft: (t: string) => `${t} left`,
    secondsShort: (s: number) => `~${s}s`,
    minutesShort: (m: number) => `~${m} min`,

    stQueued: 'Queued',
    stSearching: 'Searching…',
    stDownloading: (p: string) => `Downloading ${p}`,
    stTagging: 'Tagging…',
    stReady: 'Ready',
    stError: 'Failed',
    stCanceled: 'Canceled',
    retry: 'Retry',
    cancel: 'Cancel',
    remove: 'Remove',
    save: 'Save to disk',
    mockNoFile: 'No real file in demo mode',

    preview: 'Preview',
    stopPreview: 'Stop preview',
    downloadTrack: (t: string) => `Download ${t}`,
    selectTrack: (t: string) => `Select ${t}`,
    cancelDownload: 'Cancel download',
    close: 'Close',

    toastQueued: (t: string) => `Queued “${t}”`,
    toastReady: (t: string) => `“${t}” is ready to save`,
    toastFailed: (t: string) => `“${t}” failed to download`,
    toastAlready: (t: string) => `“${t}” is already queued`,
    toastZipFailed: 'Could not build the ZIP',
    fetchError: 'Could not load that',

    library: 'Library',
    libraryEmpty: 'Nothing downloaded yet. Whatever you grab stays here.',
    libraryUnavailable: 'The library needs the real backend — demo mode has no files on disk.',
    librarySearch: 'Search the library',
    librarySummary: (n: number, size: string) => `${n} files — ${size}`,
    libraryNoMatch: 'Nothing in the library matches that.',
    libraryRemove: 'Remove from library',
    libraryRemoved: (t: string) => `Removed “${t}” from the library`,
    libraryRemoveFailed: 'Could not remove that',
    reused: (t: string) => `“${t}” was already downloaded — taken from the library`,
    lyrics: 'Synced lyrics',
    savedAt: (d: string) => `${d}`,

    topTracks: 'Top tracks',
    discography: 'Discography',
    albumCount: (n: number) => `${n} album${n === 1 ? '' : 's'}`,
    backToArtist: 'Back to artist',
    artistNotFound: 'That artist page is not available',

    demoMode: 'Demo mode — mock data',
    builtBy: 'Built by',
    and: 'and',
    langSwitch: 'فارسی',
  },
} as const

export type Dict = (typeof DICT)['fa']

interface I18nState {
  lang: Lang
  t: Dict
  setLang: (lang: Lang) => void
}

function applyLang(lang: Lang) {
  const root = document.documentElement
  root.lang = lang
  root.dir = lang === 'fa' ? 'rtl' : 'ltr'
  localStorage.setItem('lang', lang)
}

const initial = (localStorage.getItem('lang') as Lang | null) ?? 'fa'
applyLang(initial)

export const useI18n = create<I18nState>((set) => ({
  lang: initial,
  t: DICT[initial] as Dict,
  setLang: (lang) => {
    applyLang(lang)
    set({ lang, t: DICT[lang] as Dict })
  },
}))

/** ارقام فقط در فارسی فارسی می‌شوند */
export function num(value: number | string, lang: Lang): string {
  return lang === 'fa' ? fa(value) : String(value)
}
