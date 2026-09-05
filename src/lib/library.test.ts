import { describe, expect, it } from 'vitest'
import {
  filterItems,
  groupByAlbum,
  groupByArtist,
  libraryStats,
  sortGroups,
  sortItems,
} from './library'
import type { LibraryItem, Track } from './types'

function track(over: Partial<Track> = {}): Track {
  return {
    id: over.id ?? 't1',
    title: 'Title',
    artist: 'Artist',
    durationMs: 180_000,
    artworkUrl: null,
    source: 'deezer',
    sourceUrl: '',
    previewUrl: null,
    ...over,
  }
}

function item(
  over: Omit<Partial<LibraryItem>, 'track'> & { track?: Partial<Track> } = {},
): LibraryItem {
  const { track: trackOver, ...rest } = over
  return {
    jobId: rest.jobId ?? 'j1',
    track: track(trackOver),
    quality: '320',
    bytes: 1_000,
    fileUrl: '',
    streamUrl: '',
    createdAt: 100,
    ...rest,
  }
}

describe('جستجوی درونِ کتابخانه', () => {
  const items = [
    item({ jobId: 'a', track: { id: 'a', title: 'Painkiller', artist: 'Judas Priest' } }),
    item({ jobId: 'b', track: { id: 'b', title: 'Firestone', artist: 'VLX', album: 'Singles' } }),
  ]

  it('عنوان، هنرمند و آلبوم هر سه جستجو می‌شوند', () => {
    expect(filterItems(items, 'judas')).toHaveLength(1)
    expect(filterItems(items, 'singles')).toHaveLength(1)
    expect(filterItems(items, 'PAINKILLER')).toHaveLength(1)
  })

  it('عبارتِ خالی همه‌چیز را برمی‌گرداند — نه هیچ‌چیز', () => {
    expect(filterItems(items, '   ')).toHaveLength(2)
  })
})

describe('ترتیبِ ردیف‌ها', () => {
  const items = [
    item({ jobId: 'a', createdAt: 10, bytes: 300, track: { id: 'a', title: 'Beta', durationMs: 1_000 } }),
    item({ jobId: 'b', createdAt: 30, bytes: 100, track: { id: 'b', title: 'Alpha', durationMs: 3_000 } }),
    item({ jobId: 'c', createdAt: 20, bytes: 200, track: { id: 'c', title: 'Gamma', durationMs: 2_000 } }),
  ]

  it('«تازه‌ترین» نزولی است', () => {
    expect(sortItems(items, 'recent').map((x) => x.jobId)).toEqual(['b', 'c', 'a'])
  })

  it('حجم و مدت از بزرگ به کوچک — کاربر دنبالِ بزرگ‌ترین‌هاست', () => {
    expect(sortItems(items, 'size').map((x) => x.jobId)).toEqual(['a', 'c', 'b'])
    expect(sortItems(items, 'duration').map((x) => x.jobId)).toEqual(['b', 'c', 'a'])
  })

  it('عنوان الفبایی است و ورودی را دست‌نخورده می‌گذارد', () => {
    expect(sortItems(items, 'title').map((x) => x.track.title)).toEqual(['Alpha', 'Beta', 'Gamma'])
    expect(items.map((x) => x.jobId)).toEqual(['a', 'b', 'c'])
  })

  it('«بیشترین پخش» نزولی است و تساوی با تازه‌ترین دانلود شکسته می‌شود', () => {
    const played = [
      item({ jobId: 'a', createdAt: 10, playCount: 5 }),
      item({ jobId: 'b', createdAt: 30, playCount: 2 }),
      item({ jobId: 'c', createdAt: 20, playCount: 5 }),
      item({ jobId: 'd', createdAt: 40 }),
    ]
    expect(sortItems(played, 'plays').map((x) => x.jobId)).toEqual(['c', 'a', 'b', 'd'])
  })
})

describe('گروه‌بندیِ آلبوم‌ها', () => {
  it('ردیف‌های یک آلبوم زیرِ یک کاشی جمع می‌شوند', () => {
    const groups = groupByAlbum([
      item({ jobId: 'a', bytes: 100, track: { id: 'a', title: 'One', album: 'Rust In Peace' } }),
      item({ jobId: 'b', bytes: 200, track: { id: 'b', title: 'Two', album: 'Rust In Peace' } }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].items).toHaveLength(2)
    expect(groups[0].bytes).toBe(300)
  })

  it('آلبومِ هم‌نام از دو هنرمند یکی نمی‌شود', () => {
    const groups = groupByAlbum([
      item({ jobId: 'a', track: { id: 'a', album: 'Greatest Hits', artist: 'A' } }),
      item({ jobId: 'b', track: { id: 'b', album: 'Greatest Hits', artist: 'B' } }),
    ])
    expect(groups).toHaveLength(2)
  })

  it('ترکِ بدونِ آلبوم گم نمی‌شود — با نامِ خودش می‌آید', () => {
    const groups = groupByAlbum([item({ track: { title: 'Limestone', album: undefined } })])
    expect(groups[0].title).toBe('Limestone')
  })

  it('ترکِ فیچردار از آلبومِ خودش جدا نمی‌شود', () => {
    const groups = groupByAlbum([
      item({ jobId: 'a', track: { id: 'a', album: 'GRAY WEEK', artist: 'NoTsH', albumArtist: 'NoTsH' } }),
      item({
        jobId: 'b',
        track: { id: 'b', album: 'GRAY WEEK', artist: 'NoTsH, Rowly', albumArtist: 'NoTsH' },
      }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].items).toHaveLength(2)
    // کارت باید نامِ هنرمندِ آلبوم را بدهد، نه هنرمندِ اولین ترک با مهمان‌هایش
    expect(groups[0].artist).toBe('NoTsH')
  })

  it('درونِ آلبوم به ترتیبِ دیسک و شماره‌ی ترک چیده می‌شود', () => {
    const groups = groupByAlbum([
      item({ jobId: 'c', track: { id: 'c', album: 'X', trackNumber: 1, discNumber: 2 } }),
      item({ jobId: 'a', track: { id: 'a', album: 'X', trackNumber: 3 } }),
      item({ jobId: 'b', track: { id: 'b', album: 'X', trackNumber: 1 } }),
    ])
    expect(groups[0].items.map((x) => x.jobId)).toEqual(['b', 'a', 'c'])
  })

  it('آلبومِ بی‌شماره به ترتیبِ دانلود می‌آید، نه وارونه', () => {
    // ردیف‌های قدیمی شماره ندارند؛ «دانلودِ همه» آن‌ها را به‌ترتیبِ آلبوم صف کرده
    const groups = groupByAlbum([
      item({ jobId: 'third', createdAt: 30, track: { id: 'c', album: 'X' } }),
      item({ jobId: 'first', createdAt: 10, track: { id: 'a', album: 'X' } }),
      item({ jobId: 'second', createdAt: 20, track: { id: 'b', album: 'X' } }),
    ])
    expect(groups[0].items.map((x) => x.jobId)).toEqual(['first', 'second', 'third'])
  })

  it('ترکِ بی‌شماره ته صف می‌ماند، نه اول', () => {
    const groups = groupByAlbum([
      item({ jobId: 'unknown', track: { id: 'u', album: 'X' } }),
      item({ jobId: 'first', track: { id: 'f', album: 'X', trackNumber: 1 } }),
    ])
    expect(groups[0].items.map((x) => x.jobId)).toEqual(['first', 'unknown'])
  })

  it('albumId اگر باشد بر نامِ آلبوم مقدم است', () => {
    const groups = groupByAlbum([
      item({ jobId: 'a', track: { id: 'a', albumId: 'x', album: 'Deluxe Edition' } }),
      item({ jobId: 'b', track: { id: 'b', albumId: 'x', album: 'Deluxe Edition ' } }),
    ])
    expect(groups).toHaveLength(1)
  })

  it('کاورِ تکراری در موزاییک دو بار نمی‌آید و از چهارتا بیشتر نمی‌شود', () => {
    const groups = groupByAlbum([
      item({ jobId: 'a', track: { id: 'a', album: 'X', artworkUrl: 'u1' } }),
      item({ jobId: 'b', track: { id: 'b', album: 'X', artworkUrl: 'u1' } }),
      item({ jobId: 'c', track: { id: 'c', album: 'X', artworkUrl: 'u2' } }),
    ])
    expect(groups[0].artworkUrls).toEqual(['u1', 'u2'])
  })
})

describe('گروه‌بندیِ هنرمندان', () => {
  it('تفاوتِ کوچک/بزرگیِ حروف هنرمند را دو نفر نمی‌کند', () => {
    const groups = groupByArtist([
      item({ jobId: 'a', track: { id: 'a', artist: 'Ananta' } }),
      item({ jobId: 'b', track: { id: 'b', artist: 'ananta' } }),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].title).toBe('Ananta')
  })

  it('تعدادِ آلبوم‌های هر هنرمند شمرده می‌شود', () => {
    const groups = groupByArtist([
      item({ jobId: 'a', track: { id: 'a', artist: 'A', album: 'One' } }),
      item({ jobId: 'b', track: { id: 'b', artist: 'A', album: 'One' } }),
      item({ jobId: 'c', track: { id: 'c', artist: 'A', album: 'Two' } }),
    ])
    expect(groups[0].albumCount).toBe(2)
  })
})

describe('ترتیبِ گروه‌ها', () => {
  it('«تازه‌ترین» گروهی را جلو می‌اندازد که تازه‌ترین ترک را دارد', () => {
    const groups = sortGroups(
      groupByAlbum([
        item({ jobId: 'a', createdAt: 10, track: { id: 'a', album: 'Old' } }),
        item({ jobId: 'b', createdAt: 90, track: { id: 'b', album: 'New' } }),
      ]),
      'recent',
    )
    expect(groups.map((g) => g.title)).toEqual(['New', 'Old'])
  })

  it('«بیشترین پخش» جمعِ پخش‌های ترک‌های گروه است', () => {
    const groups = sortGroups(
      groupByAlbum([
        item({ jobId: 'a', track: { id: 'a', album: 'Few' }, playCount: 1 }),
        item({ jobId: 'b', track: { id: 'b', album: 'Many' }, playCount: 4 }),
        item({ jobId: 'c', track: { id: 'c', album: 'Many' }, playCount: 3 }),
      ]),
      'plays',
    )
    expect(groups.map((g) => g.title)).toEqual(['Many', 'Few'])
    expect(groups[0].playCount).toBe(7)
  })
})

describe('آمارِ کتابخانه', () => {
  it('ترک، آلبوم، هنرمند و حجم را با هم می‌شمارد', () => {
    const stats = libraryStats([
      item({ jobId: 'a', bytes: 100, track: { id: 'a', artist: 'A', album: 'X', durationMs: 1_000 } }),
      item({ jobId: 'b', bytes: 200, track: { id: 'b', artist: 'A', album: 'Y', durationMs: 2_000 } }),
      item({ jobId: 'c', bytes: 300, track: { id: 'c', artist: 'B', album: 'Y', durationMs: 3_000 } }),
    ])
    expect(stats).toEqual({ tracks: 3, albums: 3, artists: 2, bytes: 600, durationMs: 6_000 })
  })

  it('کتابخانه‌ی خالی صفرِ تمیز می‌دهد', () => {
    expect(libraryStats([])).toEqual({ tracks: 0, albums: 0, artists: 0, bytes: 0, durationMs: 0 })
  })
})
