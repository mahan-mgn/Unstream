// @vitest-environment jsdom
//
// تشخیصِ «زیرِ انگشت چه چیزی اسکرول می‌شود».
//
// این تابع تنها دلیلِ درست‌کار-بودنِ ژستِ بستنِ شیت بعد از ثابت‌شدنِ شیت است:
// شیت دیگر اسکرول ندارد، پس اگر لمس روی پنلِ متن باشد و آن پنل بالا رفته
// باشد، ژست نباید شروع شود — وگرنه کاربر به‌جای خواندنِ خط‌های بعدی، کلِ
// پخش‌کننده را می‌بندد.
import { describe, expect, it } from 'vitest'
import { scrollableAncestor } from './useSheetDrag'

/** jsdom ارتفاعِ واقعی ندارد؛ scrollHeight/clientHeight را دستی می‌سازیم */
function makeScrollable(el: HTMLElement, scrolled = 0) {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: 800 })
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 200 })
  el.style.overflowY = 'auto'
  el.scrollTop = scrolled
  return el
}

function tree() {
  const sheet = document.createElement('div')
  const panel = makeScrollable(document.createElement('div'))
  const line = document.createElement('p')
  const cover = document.createElement('div') // اسکرول نمی‌کند
  panel.appendChild(line)
  sheet.append(panel, cover)
  document.body.appendChild(sheet)
  return { sheet, panel, line, cover }
}

describe('scrollableAncestor', () => {
  it('finds the scrollable panel above the touched node', () => {
    const { sheet, panel, line } = tree()
    expect(scrollableAncestor(line, sheet)).toBe(panel)
  })

  it('returns null for a node with no scrollable ancestor inside the sheet', () => {
    const { sheet, cover } = tree()
    expect(scrollableAncestor(cover, sheet)).toBeNull()
  })

  it('does not climb past the sheet itself', () => {
    // تنها اسکرول‌کننده بیرون از مرز است — نباید پیدایش کند، وگرنه اسکرولِ
    // صفحه‌ی پشتی جلوی بستنِ شیت را می‌گیرد
    const sheet = document.createElement('div')
    const leaf = document.createElement('p')
    sheet.appendChild(leaf)
    const outer = makeScrollable(document.createElement('div'))
    outer.appendChild(sheet)
    document.body.appendChild(outer)
    expect(scrollableAncestor(leaf, sheet)).toBeNull()
  })

  it('ignores an element that overflows but is not scrollable', () => {
    const sheet = document.createElement('div')
    const clipped = document.createElement('div')
    Object.defineProperty(clipped, 'scrollHeight', { configurable: true, value: 800 })
    Object.defineProperty(clipped, 'clientHeight', { configurable: true, value: 200 })
    clipped.style.overflowY = 'hidden'
    const leaf = document.createElement('span')
    clipped.appendChild(leaf)
    sheet.appendChild(clipped)
    expect(scrollableAncestor(leaf, sheet)).toBeNull()
  })
})
