// @vitest-environment jsdom
import { StrictMode, act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import AnimatedList from './AnimatedList'

/**
 * تستِ همان باگی که لیستِ کتابخانه و نتایجِ جستجو را خالی نشان می‌داد.
 *
 * `AnimatedList` ردیف‌ها را با `opacity: 0` پنهان می‌کند و سپردنشان به
 * `IntersectionObserver` تنها راهِ برگشتنشان است. اگر ناظر دوباره ساخته شود و
 * ردیف‌های منتظر به ناظرِ تازه سپرده نشوند، لیست برای همیشه نامرئی می‌ماند —
 * و `StrictMode` در حالتِ توسعه دقیقاً همین کار را می‌کند.
 *
 * پس تست در `StrictMode` رندر می‌کند (یعنی همان دو بار سوار و یک بار
 * برچیده‌شدن) و بعد ادعا می‌کند: هر ردیف باید دستِ ناظرِ *زنده* باشد، و با
 * رسیدنِ کاربر به آن دوباره دیده شود.
 */

/** ناظرِ قلابی؛ jsdom خودش `IntersectionObserver` ندارد */
class FakeIO {
  static live: FakeIO[] = []
  observed = new Set<Element>()
  dead = false

  constructor(private cb: IntersectionObserverCallback) {
    FakeIO.live.push(this)
  }

  observe(el: Element) {
    this.observed.add(el)
  }
  unobserve(el: Element) {
    this.observed.delete(el)
  }
  disconnect() {
    this.observed.clear()
    this.dead = true
  }
  takeRecords() {
    return []
  }

  /** «کاربر رسید به این ردیف‌ها» */
  fire() {
    const entries = [...this.observed].map(
      (target) => ({ target, isIntersecting: true }) as IntersectionObserverEntry,
    )
    this.cb(entries, this as unknown as IntersectionObserver)
  }

  static current() {
    const alive = FakeIO.live.filter((x) => !x.dead)
    return alive[alive.length - 1]
  }
}

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  FakeIO.live = []
  vi.stubGlobal('IntersectionObserver', FakeIO)
  // jsdom این را ندارد؛ «حرکتِ کمتر» خاموش تا انیمیشن واقعاً اجرا شود
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

const rows = (n: number) =>
  Array.from({ length: n }, (_, i) => (
    <div key={i} data-testid="row">
      ردیف {i}
    </div>
  ))

const render = (node: React.ReactNode) => act(() => root.render(<StrictMode>{node}</StrictMode>))

const items = () => [...host.querySelectorAll('[data-testid="row"]')] as HTMLElement[]

describe('AnimatedList در StrictMode', () => {
  it('ردیف‌های پنهان را به ناظرِ زنده می‌سپارد', () => {
    render(<AnimatedList>{rows(3)}</AnimatedList>)

    const live = FakeIO.current()
    expect(live).toBeDefined()
    expect(live.dead).toBe(false)
    // همین‌جا بود که می‌شکست: ردیف‌ها دستِ ناظرِ برچیده‌شده مانده بودند
    expect(live.observed.size).toBe(3)
    expect(items().every((el) => el.dataset.anim === 'pending')).toBe(true)
  })

  it('با رسیدنِ کاربر، ردیف‌ها دوباره دیده می‌شوند', async () => {
    render(
      <AnimatedList duration={0.01} stagger={0}>
        {rows(3)}
      </AnimatedList>,
    )

    expect(items().every((el) => el.style.opacity === '0')).toBe(true)

    await act(async () => {
      FakeIO.current().fire()
      await new Promise((r) => setTimeout(r, 120))
    })

    // `clearProps` استایلِ درون‌خطی را برمی‌دارد؛ هر چیزی جز صفر یعنی دیده می‌شود
    expect(items().every((el) => el.style.opacity !== '0')).toBe(true)
    expect(items().every((el) => el.dataset.anim === 'shown')).toBe(true)
  })

  it('تایمرِ امانی ردیفِ گیرکرده در دید را نجات می‌دهد', async () => {
    vi.useFakeTimers()
    try {
      render(<AnimatedList>{rows(2)}</AnimatedList>)
      // ناظر هیچ‌وقت فایر نمی‌شود — سناریوی «ردیف‌های شبح»
      // jsdom چیدمان ندارد؛ getBoundingClientRect صفر برمی‌گرداند، پس
      // ردیف‌ها با شرطِ «درِ دید» هم‌خوان‌اند (top=0 < vh و bottom=0 > -vh)

      await act(async () => {
        vi.advanceTimersByTime(2600)
      })

      expect(items().every((el) => el.dataset.anim === 'shown')).toBe(true)
      // gsap بدونِ چیدمان واقعی opacity را ست کرده ولی tween ناتمام می‌ماند؛
      // مهم این است که دیگر صفرِ کاملِ «پنهان» نیستند و علامتشان عوض شده
      expect(items().every((el) => Number(el.style.opacity) > 0 || el.style.opacity === '')).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ردیف‌های تازه نوبتِ خودشان را می‌گیرند و قبلی‌ها دوباره پنهان نمی‌شوند', async () => {
    render(
      <AnimatedList duration={0.01} stagger={0}>
        {rows(2)}
      </AnimatedList>,
    )
    await act(async () => {
      FakeIO.current().fire()
      await new Promise((r) => setTimeout(r, 120))
    })

    render(
      <AnimatedList duration={0.01} stagger={0}>
        {rows(4)}
      </AnimatedList>,
    )

    const all = items()
    expect(all).toHaveLength(4)
    expect(all.slice(0, 2).every((el) => el.dataset.anim === 'shown')).toBe(true)
    expect(all.slice(2).every((el) => el.style.opacity === '0')).toBe(true)
    expect(FakeIO.current().observed.size).toBe(2)
  })
})
