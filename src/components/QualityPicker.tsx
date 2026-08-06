import { useEffect, useRef, useState } from 'react'
import { digits } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { CODEC_QUALITIES, MP3_QUALITIES, type Quality } from '../lib/types'
import { useSettings } from '../store/settings'
import { ChevronIcon } from './icons'

/**
 * هفت گزینه در یک ردیفِ رادیویی جا نمی‌شود، و mp3 ۳۲۰ کنار flac هم‌ارز نیست.
 * پس منوی گروه‌بندی‌شده: بیت‌ریت‌ها یک دسته، کدک‌ها دسته‌ی دیگر.
 */
export default function QualityPicker() {
  const { quality, setQuality } = useSettings()
  const { t, lang } = useI18n()
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const label =
    quality === 'original'
      ? t.qualityOriginal
      : /^\d+$/.test(quality)
        ? digits(quality, lang)
        : quality

  const pick = (q: Quality) => {
    setQuality(q)
    setOpen(false)
  }

  const option = (id: Quality, text: string) => (
    <button
      key={id}
      role="menuitemradio"
      aria-checked={quality === id}
      onClick={() => pick(id)}
      className={`w-full rounded-lg px-3 py-1.5 text-start text-xs transition ${
        quality === id ? 'bg-accent font-semibold text-accent-fg' : 'text-muted hover:text-fg'
      }`}
    >
      {text}
    </button>
  )

  return (
    <div ref={box} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t.qualityMenu}
        className="flex items-center gap-1.5 rounded-full border border-line bg-panel py-1.5 pe-2 ps-3 text-xs text-muted transition hover:text-fg"
      >
        <span className="text-muted-2">{t.quality}</span>
        <span className="font-semibold text-fg">{label}</span>
        <ChevronIcon className={`size-3 transition ${open ? '-rotate-90' : 'rotate-90'}`} flip={false} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute end-0 z-40 mt-2 w-40 space-y-0.5 rounded-xl border border-line bg-panel p-1.5 shadow-xl"
        >
          <p className="px-3 pb-0.5 pt-1 text-[10px] uppercase tracking-wide text-muted-2">
            {t.qualityMp3}
          </p>
          {MP3_QUALITIES.map((q) => option(q.id, digits(q.kbps, lang)))}

          <p className="px-3 pb-0.5 pt-2 text-[10px] uppercase tracking-wide text-muted-2">
            {t.qualityCodec}
          </p>
          {CODEC_QUALITIES.map((q) => option(q.id, q.label))}

          <div className="my-1 border-t border-line-soft" />
          {option('original', t.qualityOriginal)}
        </div>
      )}
    </div>
  )
}
