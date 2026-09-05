// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { integrateSpring, type SpringState } from './TabBar'

/** فنر را تا نشست جلو می‌برد و دنباله‌ی موقعیت‌ها را برمی‌گرداند */
function run(x0: number, target: number, dt = 1 / 120, maxSteps = 2000) {
  const s: SpringState = { x: x0, v: 0, target, origin: x0 }
  const xs: number[] = [s.x]
  for (let i = 0; i < maxSteps; i++) {
    if (integrateSpring(s, dt)) break
    xs.push(s.x)
  }
  return { s, xs }
}

describe('integrateSpring (Telegram tab-bar lens physics)', () => {
  it('settles exactly on target', () => {
    const { s } = run(0, 100)
    expect(s.x).toBe(100)
    expect(s.v).toBe(0)
  })

  it('overshoots at least once (underdamped, ~2 bounces like Telegram)', () => {
    const { xs } = run(0, 100)
    // فنرِ میرایی‌کم از مقصد رد می‌شود؛ این همان «bounce» تلگرام است
    expect(Math.max(...xs)).toBeGreaterThan(100)
  })

  it('settles in a sane time window (not a dead dash, not forever)', () => {
    // k=150 c=12 → نسبتِ میرایی ~۰٫۴۹؛ نشست باید زیرِ ~۱ثانیه باشد
    const { xs } = run(0, 100, 1 / 120)
    expect(xs.length).toBeLessThan(240) // 240 گام @120Hz = 2s
    expect(xs.length).toBeGreaterThan(20) // نه آنی: باید نوسان دیده شود
  })

  it('works in both directions (RTL tabs move either way)', () => {
    const left = run(100, 0)
    expect(left.s.x).toBe(0)
    const right = run(0, 100)
    expect(right.s.x).toBe(100)
  })

  it('already-at-target returns settled immediately', () => {
    const s: SpringState = { x: 50, v: 0, target: 50, origin: 50 }
    expect(integrateSpring(s, 1 / 60)).toBe(true)
    expect(s.x).toBe(50)
  })

  it('never blows up on a big dt spike (tab-switch time jump)', () => {
    // dt سقف‌دار است ولی انتگرال‌گیر هم باید پایدار بماند
    const s: SpringState = { x: 0, v: 0, target: 100, origin: 0 }
    for (let i = 0; i < 500; i++) integrateSpring(s, 1 / 30)
    expect(Number.isFinite(s.x)).toBe(true)
    expect(s.x).toBe(100)
  })
})
