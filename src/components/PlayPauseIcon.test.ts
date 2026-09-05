import { describe, expect, it } from 'vitest'

/**
 * قاعدۀ مورف: مرورگر فقط وقتی می‌تواند بین دو `d` درون‌یابی کند که تعدادِ
 * نقاطِ هر دو حالت یکی باشد. اگر کسی یک راس به مثلث یا میله اضافه کند، آیکن
 * بی‌صدا از حالتِ انیمیشن می‌افتد (پرشِ ناگهانی) — این تست همان را می‌گیرد.
 *
 * مسیرها از خودِ PlayPauseIcon کپی نشده‌اند؛ ماژول را import می‌کنیم تا اگر
 * ثابت‌ها عوض شدند، تست هم همان‌ها را ببیند.
 */
import { MORPH_PATHS } from './PlayPauseIcon'

/** تعدادِ «دستورِ نقطه» در یک مسیر SVG (M/L/Z نه، فقط مختصات) */
function pointCount(d: string): number {
  return (d.match(/L/g) || []).length + (d.match(/M/g) || []).length
}

describe('PlayPauseIcon morph paths', () => {
  it.each(['left', 'right'] as const)('%s half has equal points in play and pause', (half) => {
    const { play, pause } = MORPH_PATHS[half]
    expect(pointCount(play)).toBe(pointCount(pause))
  })

  it('uses four points per half so the triangle splits cleanly', () => {
    expect(pointCount(MORPH_PATHS.left.play)).toBe(4)
    expect(pointCount(MORPH_PATHS.right.play)).toBe(4)
  })
})
