import { describe, expect, it, vi } from 'vitest'
import { pickShuffleIndex } from './shuffle'
import type { Track } from './types'

function track(id: string, mood?: { valence: number; energy: number }): Track {
  return {
    id,
    title: id,
    artist: 'Farhad Mehrad',
    durationMs: 180_000,
    artworkUrl: null,
    source: 'deezer',
    sourceUrl: `https://example.com/${id}`,
    previewUrl: null,
    ...mood,
  }
}

function queueOf(tracks: Track[]) {
  return tracks.map((t) => ({ track: t }))
}

describe('pickShuffleIndex', () => {
  it('never returns the current index', () => {
    const queue = queueOf([track('a'), track('b'), track('c')])
    for (let i = 0; i < 50; i++) {
      expect(pickShuffleIndex(queue, 1)).not.toBe(1)
    }
  })

  it('falls back to uniform randomness when the current track has no mood data', () => {
    const queue = queueOf([
      track('a'),
      track('b', { valence: 0.9, energy: 0.9 }),
      track('c', { valence: 0.1, energy: 0.1 }),
    ])
    const seen = new Set<number>()
    for (let i = 0; i < 200; i++) seen.add(pickShuffleIndex(queue, 0))
    // بدون دیتای مبدأ، هر دو باید دیده شوند — یکی سیستماتیک حذف نمی‌شود
    expect(seen).toEqual(new Set([1, 2]))
  })

  it('strongly favors the track with the closest mood', () => {
    const queue = queueOf([
      track('sad', { valence: 0.1, energy: 0.2 }),
      track('also-sad', { valence: 0.15, energy: 0.25 }),
      track('happy', { valence: 0.9, energy: 0.9 }),
    ])

    let closeWins = 0
    for (let i = 0; i < 500; i++) {
      if (pickShuffleIndex(queue, 0) === 1) closeWins++
    }
    // فاصله‌ی نزدیک باید غالب باشد؛ آستانه‌ی سست‌گیرانه برای جلوگیری از فِلیکی بودن تست
    expect(closeWins).toBeGreaterThan(400)
  })

  it('treats a candidate missing mood data as neutral, not excluded', () => {
    const queue = queueOf([
      track('current', { valence: 0.5, energy: 0.5 }),
      track('no-mood-data'),
    ])
    expect(pickShuffleIndex(queue, 0)).toBe(1)
  })

  it('stays on the current index when the queue has nowhere else to go', () => {
    // هر دو مسیرِ تابع از یک آرایه‌ی خالی می‌خواندند و `undefined` برمی‌گشت —
    // تایپش عدد می‌گوید، پس صدازننده بی‌خبر ایندکسِ صف می‌کردش
    expect(pickShuffleIndex(queueOf([track('only', { valence: 0.5, energy: 0.5 })]), 0)).toBe(0)
    expect(pickShuffleIndex(queueOf([track('only')]), 0)).toBe(0)
  })

  it('is deterministic given a fixed random source', () => {
    const queue = queueOf([
      track('current', { valence: 0.5, energy: 0.5 }),
      track('near', { valence: 0.55, energy: 0.55 }),
      track('far', { valence: 0.0, energy: 0.0 }),
    ])
    vi.spyOn(Math, 'random').mockReturnValue(0)
    expect(pickShuffleIndex(queue, 0)).toBe(1)
    vi.restoreAllMocks()
  })
})
