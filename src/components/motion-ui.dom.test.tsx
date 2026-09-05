// @vitest-environment jsdom
//
// `Toaster` غیرمستقیم `i18n` را می‌آورد و آن در سطحِ ماژول به `document` دست
// می‌زند — همان قراردادی که `AnimatedList.dom.test.tsx` دنبال می‌کند.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useToasts } from '../store/toasts'
import { CheckDrawIcon } from './icons'
import Toaster from './Toaster'

/**
 * تستِ دودِ ریزه‌کاری‌های حرکتیِ جدید — همان مسیرِ `reactbits.test.tsx`:
 * رندرِ واقعی برای اطمینان از اینکه هیچ‌کدام بیرون از مرورگر نمی‌ترکند.
 *
 * توست‌ها با `createRoot` رندر می‌شوند نه `renderToStaticMarkup`: رندرِ سروری
 * از اسنپ‌شاتِ سرورِ zustand می‌خواند که همان حالتِ اولیه است و `setState`
 * قبلش را نمی‌بیند.
 */

let host: HTMLDivElement
let root: Root

beforeEach(() => {
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
  useToasts.setState({ toasts: [] })
  vi.unstubAllGlobals()
})

describe('CheckDrawIcon', () => {
  it('مسیرِ تیک را با کلاسِ انیمیشنِ کشیده‌شدن می‌سازد', () => {
    const html = renderToStaticMarkup(<CheckDrawIcon className="size-3.5" />)
    expect(html).toContain('check-draw')
    expect(html).toContain('<svg')
  })
})

describe('Toaster', () => {
  it('توستِ عادی با انیمیشنِ ورود و توستِ در حالِ رفتن با انیمیشنِ خروج است', () => {
    useToasts.setState({
      toasts: [
        { id: 1, text: 'ماندنی', tone: 'info' },
        { id: 2, text: 'رو به رفتن', tone: 'success', leaving: true },
      ],
    })

    act(() => root.render(<Toaster />))

    const html = host.innerHTML
    expect(html).toContain('toast-in')
    expect(html).toContain('toast-out')
    expect(html).toContain('ماندنی')
    expect(html).toContain('رو به رفتن')
  })
})
