// @vitest-environment jsdom
//
// دودِ رندرِ نمای کارائوکه — همان قراردادِ `motion-ui.dom.test.tsx`.
// `LyricsPanel` غیرمستقیم `i18n` را می‌آورد که در سطحِ ماژول به `document`
// دست می‌زند، پس jsdom لازم است.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LyricLine } from '../lib/lrc'
import LyricsPanel from './LyricsPanel'

/*
 * خطِ فعال از ساعتِ *واقعیِ* صوت خوانده می‌شود نه از پراپِ position — پس
 * تست باید همان ساعت را کنترل کند، وگرنه در jsdom همیشه صفر است و خطِ اول
 * فعال می‌ماند.
 */
const clock = { now: 10 }
vi.mock('../lib/audioEngine', () => ({
  engine: { currentTime: () => clock.now },
}))

const lines: LyricLine[] = [
  { time: 0, text: 'خط اول فارسی' },
  { time: 10, text: 'Second line' },
  { time: 20, text: 'Third' },
]

const wordLines: LyricLine[] = [
  { time: 0, text: 'plain line' },
  {
    time: 10,
    text: 'Go now',
    words: [
      { time: 10, text: 'Go ' },
      { time: 10.5, text: 'now' },
    ],
  },
  { time: 20, text: 'Third' },
]

let host: HTMLDivElement
let root: Root
const scrollIntoView = vi.fn()
const scrollTo = vi.fn()

beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
  // jsdom هیچ‌کدام را ندارد؛ افکتِ اسکرولِ خطِ فعال رویش می‌شکند
  scrollIntoView.mockClear()
  scrollTo.mockClear()
  Element.prototype.scrollIntoView = scrollIntoView
  Element.prototype.scrollTo = scrollTo
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
})

function render() {
  act(() => {
    root.render(
      <LyricsPanel lines={lines} position={10} trackEnd={60} onSeek={() => {}} />,
    )
  })
}

describe('LyricsPanel', () => {
  it('renders the active line with the karaoke class and a progress var', () => {
    render()
    const active = host.querySelector('.karaoke-active')
    expect(active?.textContent).toBe('Second line')
    expect((active as HTMLElement).style.getPropertyValue('--p')).not.toBe('')
  })

  it('sets dir per line so the fill runs with the reading direction', () => {
    render()
    const ps = [...host.querySelectorAll('p')]
    const fa = ps.find((p) => p.textContent === 'خط اول فارسی')
    const en = ps.find((p) => p.textContent === 'Second line')
    expect(fa?.getAttribute('dir')).toBe('rtl')
    expect(en?.getAttribute('dir')).toBe('ltr')
  })

  it('marks the active line for assistive tech', () => {
    render()
    const active = host.querySelector('[aria-current="true"]')
    expect(active?.textContent).toBe('Second line')
  })

  /*
   * بازگشتِ باگی که کلِ شیت را جابه‌جا می‌کرد: `scrollIntoView` همه‌ی
   * جدرهای اسکرول‌پذیر را تکان می‌دهد، پس هدر/کنترل‌ها روی متن می‌افتادند.
   */
  it('scrolls only its own pane, never the ancestors', () => {
    render()
    expect(scrollIntoView).not.toHaveBeenCalled()
    expect(scrollTo).toHaveBeenCalled()
  })

  it('seeks to the tapped line', () => {
    const onSeek = vi.fn()
    act(() => {
      root.render(<LyricsPanel lines={lines} position={10} trackEnd={60} onSeek={onSeek} />)
    })
    const third = [...host.querySelectorAll('p')].find((p) => p.textContent === 'Third')!
    act(() => {
      third.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
    expect(onSeek).toHaveBeenCalledWith(20)
  })

  it('renders every line — no windowing cuts the lyrics into sections', () => {
    // خطِ فعال وسط است؛ پنجره‌ی قدیمی فقط ۷ خط نشان می‌داد — حالا همه باید باشند
    const many: LyricLine[] = Array.from({ length: 15 }, (_, i) => ({
      time: i * 5,
      text: `line ${i}`,
    }))
    clock.now = 37 // خطِ هفتم فعال
    act(() => {
      root.render(<LyricsPanel lines={many} position={37} trackEnd={80} onSeek={() => {}} />)
    })
    expect(host.querySelectorAll('p').length).toBe(15)
    expect(host.querySelector('.karaoke-active')?.textContent).toBe('line 7')
    clock.now = 10
  })

  describe('word-level timings (enhanced LRC)', () => {
    it('renders the active wordy line as spans; neighbours stay plain text', () => {
      act(() => {
        root.render(<LyricsPanel lines={wordLines} position={10} trackEnd={60} onSeek={() => {}} />)
      })
      expect(host.querySelectorAll('[data-word]').length).toBe(2)
      expect(host.querySelector('.karaoke-active')?.textContent).toBe('Go now')
      const plain = [...host.querySelectorAll('p')].find((p) => p.textContent === 'plain line')!
      expect(plain.querySelector('[data-word]')).toBeNull()
    })

    it('fills spans up to the current word and leaves the rest empty', () => {
      clock.now = 10.6 // کلمه‌ی دوم فعال است
      act(() => {
        root.render(
          <LyricsPanel lines={wordLines} position={10} trackEnd={60} onSeek={() => {}} />,
        )
      })
      const spans = host.querySelectorAll<HTMLElement>('[data-word]')
      // rAF در jsdom نمی‌چرخد — منظم‌سازیِ اولیه همان است که در دسترس است:
      // هر دو span با --wp شروع می‌شوند و حلقه‌ی واقعی در مرورگر پرش می‌کند
      expect(spans[0].textContent).toBe('Go ')
      expect(spans[1].textContent).toBe('now')
      expect(spans[0].className).toBe('karaoke-word')
      clock.now = 10
    })
  })
})
