// @vitest-environment jsdom
//
// «روی این گوشی» تنها راهِ ورودِ کاربر به حالتِ مستقل است و تنها جایی که اپ
// خودش را به `127.0.0.1` می‌چسباند. اگر این صفحه بیفتد، کاربر هیچ‌وقت وارد اپ
// نمی‌شود — پس رندرشدنش باید تست شود، نه فقط تابعِ آدرس‌سازی.
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import ServerSetup from './ServerSetup'
import { localBase } from '../lib/server'

/**
 * `location.reload` در jsdom واقعاً صفحه را می‌بَرَد، پس نشانه‌گذاریِ «ذخیره
 * شد» همین است: آدرس ذخیره‌شده + یک reload که *اجرا نشود*.
 */
let reload = vi.fn()

let host: HTMLDivElement
let root: Root

beforeEach(() => {
  // کلیکِ «روی این گوشی» یک await دارد؛ بدون این پرچم React ۱۹ هر به‌روزرسانیِ
  // بیرون از act() را با هشدارِ «not configured to support act» علامت می‌زند
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  reload = vi.fn()
  // jsdom روی reload واقعی می‌ترکد (Not implemented) و خطا را می‌بلعد؛ با
  // stub کردنش هم صدا می‌کُشیم هم می‌شود دید صدا زده شد یا نه
  Object.defineProperty(window, 'location', {
    value: { ...window.location, reload, href: 'https://localhost/' },
    writable: true,
  })
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/**
 * `vi.stubGlobal` خودِ آبجکتِ global را برمی‌گرداند، نه اسپای را — پس اسپای را
 * جدا می‌گیریم و همان را assert می‌کنیم.
 */
function fetchStub(ok: boolean) {
  const spy = vi.fn().mockResolvedValue({ ok } as Response)
  vi.stubGlobal('fetch', spy)
  return spy
}

function localButton(): HTMLButtonElement {
  const btn = [...host.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').includes('روی این گوشی'),
  )
  if (!btn) throw new Error('دکمه‌ی «روی این گوشی» پیدا نشد')
  return btn as HTMLButtonElement
}

describe('ServerSetup — حالتِ محلی', () => {
  it('گزینه‌ی «روی این گوشی» را نشان می‌دهد', () => {
    act(() => root.render(<ServerSetup />))
    expect(localButton()).toBeTruthy()
  })

  it('سرورِ زنده را روی loopback ذخیره می‌کند و ری‌لود می‌کند', async () => {
    const fetch = fetchStub(true)
    act(() => root.render(<ServerSetup />))

    await act(async () => {
      localButton().click()
    })

    expect(fetch).toHaveBeenCalledWith(
      `${localBase()}/api/health`,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
    expect(localStorage.getItem('server:base')).toBe(localBase())
    expect(reload).toHaveBeenCalled()
  })

  // این مهم‌ترین رفتار است: اگر Termux روشن نباشد، اپ نباید آدرس را ذخیره کند
  // و کاربر را پشتِ یک صفحه‌ی خالی بگذارد. باید همان‌جا بماند و بگوید چه‌کار کند.
  it('سرورِ خاموش را ذخیره نمی‌کند و راهنما نشان می‌دهد', async () => {
    fetchStub(false)
    act(() => root.render(<ServerSetup />))

    await act(async () => {
      localButton().click()
    })

    expect(localStorage.getItem('server:base')).toBeNull()
    expect(reload).not.toHaveBeenCalled()
    expect(host.textContent).toContain('phone-server.sh status')
  })

  it('راهنمایِ قدم‌به‌قدم با کلیک باز می‌شود', async () => {
    fetchStub(true)
    act(() => root.render(<ServerSetup />))

    const how = [...host.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('چطور'),
    )
    expect(how).toBeTruthy()
    expect(host.querySelector('pre')).toBeNull()

    await act(async () => {
      how!.click()
    })
    expect(host.querySelector('pre')).toBeTruthy()
    expect(host.textContent).toContain('termux-setup-storage')
  })

  it('مسیرِ راه‌دور هم دست‌نخورده کار می‌کند', async () => {
    fetchStub(true)
    act(() => root.render(<ServerSetup />))

    const input = host.querySelector('input')!
    await act(async () => {
      // تغییرِ کنترل‌شده‌ی React از طریقِ خودِ اینپوت انجام می‌شود، نه با
      // مقداردهیِ مستقیمِ value
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
      setter.call(input, '192.168.0.183:8080')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })

    const save = [...host.querySelectorAll('button')].find((b) =>
      (b.textContent ?? '').includes('ذخیره و ادامه'),
    )!
    await act(async () => {
      save.click()
    })

    expect(localStorage.getItem('server:base')).toBe('http://192.168.0.183:8080')
    expect(reload).toHaveBeenCalled()
  })
})
