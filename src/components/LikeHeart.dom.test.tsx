// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import LikeHeart from './LikeHeart'

/**
 * منطقِ غیربدیهیِ LikeHeart: پاشش فقط در گذارِ «لایک» اجرا می‌شود، نقطه‌ها
 * بردارِ تصادفی می‌گیرند، و کلاسِ is-bursting باید با reflow از نو پخش شود.
 * انیمیشنِ واقعی را jsdom اجرا نمی‌کند؛ همین‌قدر که side-effectهای DOM درست
 * بنشینند کافی است.
 */
let host: HTMLDivElement
let root: Root

beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(liked: boolean, onToggle = vi.fn()) {
  act(() => {
    root.render(
      <LikeHeart liked={liked} onToggle={onToggle} ariaLabel="لایک" iconClassName="size-4" />,
    )
  })
  return host.querySelector<HTMLButtonElement>('button.like-heart')!
}

describe('LikeHeart', () => {
  it('هشت نقطه دارد و aria-pressed وضعیت را می‌دهد', () => {
    const btn = render(true)
    expect(btn.getAttribute('aria-pressed')).toBe('true')
    expect(btn.getAttribute('data-liked')).toBe('true')
    expect(btn.querySelectorAll('.like-particles i')).toHaveLength(8)
  })

  it('در گذارِ لایک، is-bursting می‌گیرد و بردارها پر می‌شوند', () => {
    const btn = render(false)
    expect(btn.classList.contains('is-bursting')).toBe(false)
    act(() => btn.click())
    expect(btn.classList.contains('is-bursting')).toBe(true)
    const dots = [...btn.querySelectorAll<HTMLElement>('.like-particles i')]
    // هر نقطه بردار/تأخیر/اندازه‌ی خودش را گرفته — تصادفی ولی پر
    for (const d of dots) {
      expect(d.style.getPropertyValue('--px')).toMatch(/px$/)
      expect(d.style.getPropertyValue('--py')).toMatch(/px$/)
      expect(d.style.getPropertyValue('--pdelay')).toMatch(/ms$/)
      expect(d.style.getPropertyValue('--psize')).not.toBe('')
    }
  })

  it('در برداشتنِ لایک پاشش اجرا نمی‌شود', () => {
    const btn = render(true)
    act(() => btn.click())
    expect(btn.classList.contains('is-bursting')).toBe(false)
  })

  it('لایکِ دوباره پس از برداشتن، پاشش را از نو پخش می‌کند', () => {
    const btn = render(false)
    act(() => btn.click())
    expect(btn.classList.contains('is-bursting')).toBe(true)
    // والد لایک را ثبت می‌کند؛ کلیکِ بعدی = برداشتنِ لایک → پاشش پاک می‌شود
    act(() => root.render(
      <LikeHeart liked={true} onToggle={vi.fn()} ariaLabel="لایک" iconClassName="size-4" />,
    ))
    const liked = host.querySelector<HTMLButtonElement>('button.like-heart')!
    act(() => liked.click())
    expect(liked.classList.contains('is-bursting')).toBe(false)
    // و لایکِ دوباره پاشش را از نو می‌زند
    act(() => root.render(
      <LikeHeart liked={false} onToggle={vi.fn()} ariaLabel="لایک" iconClassName="size-4" />,
    ))
    const again = host.querySelector<HTMLButtonElement>('button.like-heart')!
    act(() => again.click())
    expect(again.classList.contains('is-bursting')).toBe(true)
  })

  it('onToggle همیشه صدا زده می‌شود', () => {
    const onToggle = vi.fn()
    const btn = render(false, onToggle)
    act(() => btn.click())
    act(() => btn.click())
    expect(onToggle).toHaveBeenCalledTimes(2)
  })
})
