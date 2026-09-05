import { describe, expect, it } from 'vitest'
import { isLocalServer, localBase, normalizeBase, rewrite } from './server'

describe('normalizeBase', () => {
  it('یک آی‌پیِ لخت را http فرض می‌کند', () => {
    expect(normalizeBase('192.168.0.183:8080')).toBe('http://192.168.0.183:8080')
  })

  it('به آدرسی که خودش پروتکل دارد دست نمی‌زند', () => {
    expect(normalizeBase('https://x.trycloudflare.com')).toBe('https://x.trycloudflare.com')
  })

  it('اسلشِ آخر را می‌بُرد', () => {
    expect(normalizeBase('http://10.0.0.5:8080///')).toBe('http://10.0.0.5:8080')
  })

  // کاربری که آدرس را از نوار مرورگر کپی می‌کند معمولاً /api هم همراهش می‌آید،
  // و بدون این، درخواست‌ها به /api/api/... می‌رفتند
  it('«api/» اضافه‌ی کاربر را حذف می‌کند', () => {
    expect(normalizeBase('http://host:8080/api')).toBe('http://host:8080')
    expect(normalizeBase('http://host:8080/api/')).toBe('http://host:8080')
  })

  it('فاصله‌ها را نادیده می‌گیرد و خالی را خالی نگه می‌دارد', () => {
    expect(normalizeBase('  ')).toBe('')
    expect(normalizeBase(' host:1 ')).toBe('http://host:1')
  })
})

describe('rewrite', () => {
  const base = 'http://192.168.0.183:8080'

  it('بدون ریشه هیچ‌چیز را عوض نمی‌کند', () => {
    const input = { streamUrl: '/api/downloads/1/stream' }
    expect(rewrite(input, '')).toBe(input)
  })

  it('آدرس‌های نسبیِ سرور را مطلق می‌کند', () => {
    expect(rewrite({ streamUrl: '/api/downloads/1/stream' }, base)).toEqual({
      streamUrl: `${base}/api/downloads/1/stream`,
    })
  })

  // کاور از CDNِ اسپاتیفای/دیزر می‌آید و لینکِ منبع به خودِ آن سایت — چسباندنِ
  // ریشه به این‌ها یعنی هیچ عکسی بالا نمی‌آید
  it('به آدرس‌های مطلق دست نمی‌زند', () => {
    const input = {
      artworkUrl: 'https://i.scdn.co/image/abc',
      sourceUrl: 'https://open.spotify.com/album/1',
    }
    expect(rewrite(input, base)).toEqual(input)
  })

  it('به رشته‌هایی که آدرس نیستند دست نمی‌زند', () => {
    expect(rewrite({ title: '/api روی سرور', artist: 'x' }, base)).toEqual({
      title: '/api روی سرور',
      artist: 'x',
    })
  })

  it('داخل آرایه و آبجکتِ تودرتو هم کار می‌کند', () => {
    const page = {
      items: [
        { jobId: 'a', streamUrl: '/api/downloads/a/stream', fileUrl: '/api/downloads/a/file' },
        { jobId: 'b', streamUrl: '/api/downloads/b/stream', lyricsUrl: null },
      ],
      total: 2,
    }
    const out = rewrite(page, base)
    expect(out.items[0].streamUrl).toBe(`${base}/api/downloads/a/stream`)
    expect(out.items[0].fileUrl).toBe(`${base}/api/downloads/a/file`)
    expect(out.items[1].lyricsUrl).toBeNull()
    expect(out.total).toBe(2)
  })

  it('null و عدد و بولین را دست‌نخورده رد می‌کند', () => {
    expect(rewrite({ a: null, b: 3, c: false }, base)).toEqual({ a: null, b: 3, c: false })
  })
})

describe('isLocalServer', () => {
  // «همین گوشی» را باید از هر دو املای رایج بشناسد؛ کسی که آدرس را دستی
  // می‌نویسد معمولاً localhost می‌زند
  it('loopback را با هر دو نام می‌شناسد', () => {
    expect(isLocalServer('http://127.0.0.1:8000')).toBe(true)
    expect(isLocalServer('http://localhost:8000')).toBe(true)
    expect(isLocalServer('http://127.0.0.1')).toBe(true)
  })

  it('آی‌پیِ شبکه‌ی خانه را محلی نمی‌شمارد', () => {
    // این مهم است: 192.168.x.x هم «داخل شبکه» است ولی دستگاهِ *دیگری* است —
    // همان لپ‌تاپی که کاربر می‌خواهد از آن مستقل باشد
    expect(isLocalServer('http://192.168.0.183:8080')).toBe(false)
    expect(isLocalServer('https://x.trycloudflare.com')).toBe(false)
  })

  it('آدرسِ خالی و آدرسِ بی‌پروتکل محلی نیستند', () => {
    expect(isLocalServer('')).toBe(false)
    expect(isLocalServer('127.0.0.1:8000')).toBe(false)
  })

  it('localBase با چیزی که isLocalServer می‌پذیرد یکی است', () => {
    // وگرنه دکمه‌ی «روی این گوشی» آدرسی ذخیره می‌کند که خودِ نشانهِ «همین
    // گوشی» نمی‌شناسدش
    expect(isLocalServer(localBase())).toBe(true)
  })
})
