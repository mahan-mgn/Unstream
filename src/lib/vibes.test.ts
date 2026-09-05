import { describe, expect, it } from 'vitest'
import { VIBE_KEYS, splitVibeLabel, vibeCovers } from './vibes'

const pool = Array.from({ length: 20 }, (_, i) => `/api/art/${i}.jpg`)

describe('vibeCovers', () => {
  it('با کمتر از چهار کاور چیزی نمی‌دهد تا کاشی به گرادیان برگردد', () => {
    expect(vibeCovers(pool.slice(0, 3), 'sad')).toEqual([])
    expect(vibeCovers([], 'sad')).toEqual([])
    expect(vibeCovers(pool.slice(0, 4), 'sad')).toHaveLength(4)
  })

  it('چهار کاورِ یکتا از خودِ استخر می‌دهد', () => {
    const covers = vibeCovers(pool, 'happy')
    expect(covers).toHaveLength(4)
    expect(new Set(covers).size).toBe(4)
    covers.forEach((url) => expect(pool).toContain(url))
  })

  it('بین اجراها ثابت می‌ماند — رفرش نباید کاشی را عوض کند', () => {
    expect(vibeCovers(pool, 'calm')).toEqual(vibeCovers(pool, 'calm'))
  })

  it('هر حس‌وحال ترکیب خودش را می‌گیرد', () => {
    const sets = VIBE_KEYS.map((v) => vibeCovers(pool, v).join('|'))
    expect(new Set(sets).size).toBe(VIBE_KEYS.length)
  })

  it('اضافه‌شدن یک کاور تازه، انتخابِ بقیه را زیرورو نمی‌کند', () => {
    const before = vibeCovers(pool, 'focus')
    const after = vibeCovers(['/api/art/new.jpg', ...pool], 'focus')
    // حداکثر یکی از چهارتا می‌تواند جایش را به کاورِ تازه بدهد
    expect(after.filter((url) => before.includes(url)).length).toBeGreaterThanOrEqual(3)
  })
})

describe('splitVibeLabel', () => {
  it('ایموجی را از متن جدا می‌کند', () => {
    expect(splitVibeLabel('😢 غمگین')).toEqual({ emoji: '😢', text: 'غمگین' })
    expect(splitVibeLabel('🎯 Deep Focus')).toEqual({ emoji: '🎯', text: 'Deep Focus' })
  })

  it('برچسبِ بدون ایموجی را نصف نمی‌کند', () => {
    expect(splitVibeLabel('غمگین')).toEqual({ emoji: '♪', text: 'غمگین' })
  })
})
