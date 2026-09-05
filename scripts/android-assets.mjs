/**
 * آیکون‌های لانچر و تصویرهای اسپلشِ اندروید را از روی همان لوگو می‌سازد.
 *
 * جایگزینِ `@capacitor/assets` است — نه از سرِ لجبازی، بلکه چون آن ابزار برای
 * خودش `sharp` نصب می‌کند و اینجا (ویندوز، با اسکریپت‌های نصبِ محدودشده)
 * باینری‌اش بالا نمی‌آید. این اسکریپت همان کار را با `sharp`ی می‌کند که خودِ
 * پروژه از قبل دارد.
 *
 * اجرا: `npm run android:assets` (خودش داخلِ `android:sync` هم صدا زده می‌شود)
 */

import { mkdir, writeFile } from 'node:fs/promises'
import sharp from 'sharp'

const BG = '#070707'
const ACCENT = '#c6f24e'
const RES = 'android/app/src/main/res'

const HEADPHONES = `
  <g fill="none" stroke="${ACCENT}" stroke-width="26" stroke-linecap="round">
    <path d="M144 296v-40a112 112 0 0 1 224 0v40" />
    <rect x="118" y="288" width="64" height="96" rx="24" fill="${ACCENT}" stroke="none" />
    <rect x="330" y="288" width="64" height="96" rx="24" fill="${ACCENT}" stroke="none" />
  </g>`

/** لوگو با مقیاسِ دلخواه، وسطِ یک بومِ ۵۱۲تایی */
const logo = (scale) =>
  `<g transform="translate(256 256) scale(${scale}) translate(-256 -256)">${HEADPHONES}</g>`

const square = (body) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">${body}</svg>`,
  )

const png = (source, width, height = width) =>
  sharp(source, { density: 384 }).resize(width, height).png({ compressionLevel: 9 }).toBuffer()

async function write(path, buffer) {
  await mkdir(path.slice(0, path.lastIndexOf('/')), { recursive: true })
  await writeFile(path, buffer)
}

/* ---------- آیکونِ لانچر ---------- */

/** آیکونِ کامل: لوگو داخلِ مربعِ گردگوشه — برای اندرویدهای پیش از آیکونِ تطبیقی */
const fullIcon = square(`<rect width="512" height="512" rx="112" fill="${BG}" />${logo(1)}`)

/** همان، ولی گِرد — بعضی لانچرها هنوز `ic_launcher_round` را جدا می‌خواهند */
const roundIcon = square(`<circle cx="256" cy="256" r="256" fill="${BG}" />${logo(1)}`)

/**
 * لایه‌ی جلوی آیکونِ تطبیقی: فقط لوگو، روی بومِ شفاف.
 *
 * ضریبِ ۰٫۵۵ از روی قاعده‌ی خودِ اندروید است: از بومِ ۱۰۸dp تنها ۷۲dpِ مرکزی
 * (۶۶٪) تضمین‌شده بیرونِ ماسک می‌ماند. لوگو در این ضریب حدود ۵۹dp می‌شود، پس
 * روی ماسکِ دایره‌ای هم گوشه‌هایش بریده نمی‌شوند.
 */
const foreground = square(logo(0.55))

/** dpi → اندازه‌ی آیکون (پیکسل). عددهای استانداردِ اندروید. */
const ICON = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 }

for (const [dpi, size] of Object.entries(ICON)) {
  await write(`${RES}/mipmap-${dpi}/ic_launcher.png`, await png(fullIcon, size))
  await write(`${RES}/mipmap-${dpi}/ic_launcher_round.png`, await png(roundIcon, size))
  // لایه‌ی جلو روی بومِ ۱۰۸dp است نه ۴۸dp، پس ۲٫۲۵ برابرِ آیکونِ همان چگالی
  await write(
    `${RES}/mipmap-${dpi}/ic_launcher_foreground.png`,
    await png(foreground, Math.round(size * 2.25)),
  )
}

/* ---------- اسپلش ---------- */

/**
 * تصویرِ اسپلش برای یک نسبتِ مشخص.
 *
 * لوگو با نسبت به *کوچک‌ترین* بُعد اندازه می‌گیرد، نه به عرض: وگرنه همان تصویر
 * در حالت افقی یک لوگوی غول‌پیکرِ بریده می‌شد.
 */
function splashSvg(width, height) {
  const min = Math.min(width, height)
  const size = Math.round(min * 0.28)
  const x = Math.round((width - size) / 2)
  const y = Math.round((height - size) / 2)
  const halo = Math.round(min * 0.45)

  return Buffer.from(`
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="${ACCENT}" stop-opacity="0.13" />
      <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0" />
    </radialGradient>
  </defs>
  <rect width="${width}" height="${height}" fill="${BG}" />
  <circle cx="${width / 2}" cy="${height / 2}" r="${halo}" fill="url(#glow)" />
  <svg x="${x}" y="${y}" width="${size}" height="${size}" viewBox="0 0 512 512">${HEADPHONES}</svg>
</svg>`)
}

/** dpi → اندازه‌ی عمودیِ اسپلش؛ حالتِ افقی همین‌ها با جای عوض‌شده است */
const SPLASH = {
  mdpi: [320, 480],
  hdpi: [480, 800],
  xhdpi: [720, 1280],
  xxhdpi: [960, 1600],
  xxxhdpi: [1280, 1920],
}

for (const [dpi, [w, h]] of Object.entries(SPLASH)) {
  await write(`${RES}/drawable-port-${dpi}/splash.png`, await png(splashSvg(w, h), w, h))
  await write(`${RES}/drawable-land-${dpi}/splash.png`, await png(splashSvg(h, w), h, w))
}

// نسخه‌ی بی‌چگالی — وقتی اندروید هیچ‌کدام از بالایی‌ها را انتخاب نکند
await write(`${RES}/drawable/splash.png`, await png(splashSvg(480, 320), 480, 320))

console.log('آیکون‌ها و اسپلش ساخته شدند.')
