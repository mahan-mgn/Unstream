import { useEffect, useRef, useState } from 'react'
import { isUrl } from '../lib/format'
import { useI18n } from '../lib/i18n'
import { ArrowIcon, SearchIcon, Spinner } from './icons'

interface Props {
  value: string
  loading: boolean
  onSubmit: (value: string) => void
}

export default function SearchBar({ value, loading, onSubmit }: Props) {
  const [draft, setDraft] = useState(value)
  const input = useRef<HTMLInputElement>(null)
  const { t } = useI18n()

  useEffect(() => setDraft(value), [value])

  // میان‌بر «/» برای فوکوس روی سرچ
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== input.current) {
        e.preventDefault()
        input.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  // لینک پیست‌شده جستجو نمی‌شود، مستقیم باز می‌شود — پس برچسب دکمه هم عوض می‌شود
  const linkMode = isUrl(draft)
  const [hintBefore, hintAfter] = t.searchHint.split('{kbd}')

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        const v = draft.trim()
        if (v) onSubmit(v)
      }}
      className="w-full"
    >
      <div className="flex items-center gap-2 rounded-full border border-line bg-panel py-1.5 pe-1.5 ps-4 transition focus-within:border-accent/70 focus-within:shadow-[0_0_0_4px_var(--color-accent-dim)]">
        <SearchIcon className="size-4 shrink-0 text-muted-2" />

        <input
          ref={input}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          className="bidi-auto min-w-0 flex-1 bg-transparent px-1 text-sm outline-none placeholder:text-muted-2"
          placeholder={t.searchPlaceholder}
        />

        <button
          type="submit"
          disabled={loading || !draft.trim()}
          className="flex shrink-0 items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-sm font-semibold text-accent-fg transition enabled:hover:brightness-110 disabled:opacity-45"
        >
          {loading ? (
            <>
              <Spinner className="size-4" />
              {t.searching}
            </>
          ) : (
            <>
              {linkMode ? t.open : t.search}
              <ArrowIcon className="size-3.5" />
            </>
          )}
        </button>
      </div>

      <p className="mt-2 text-center text-xs text-muted-2">
        {hintBefore}
        <kbd className="rounded border border-line bg-panel px-1.5 py-0.5 text-[10px]">/</kbd>
        {hintAfter}
      </p>
    </form>
  )
}
