import { useCallback, useEffect, useRef, useState } from 'react'
import AlbumView from './components/AlbumView'
import DownloadQueue from './components/DownloadQueue'
import Footer from './components/Footer'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import SearchResults from './components/SearchResults'
import { AlbumSkeleton, ResultsSkeleton } from './components/Skeletons'
import Toaster from './components/Toaster'
import { api } from './lib/api'
import { isUrl } from './lib/format'
import { useI18n } from './lib/i18n'
import type { Album, AlbumDetail, SearchResults as Results } from './lib/types'
import { usePreview } from './lib/usePreview'
import { useToasts } from './store/toasts'

type View =
  | { kind: 'home' }
  | { kind: 'results'; query: string }
  | { kind: 'album'; ref: string; from?: string }

function viewFromLocation(): View {
  const p = new URLSearchParams(location.search)
  const url = p.get('url')
  if (url) return { kind: 'album', ref: url, from: p.get('q') ?? undefined }
  const q = p.get('q')
  if (q) return { kind: 'results', query: q }
  return { kind: 'home' }
}

function pushView(view: View) {
  const p = new URLSearchParams()
  if (view.kind === 'results') p.set('q', view.query)
  if (view.kind === 'album') {
    p.set('url', view.ref)
    if (view.from) p.set('q', view.from)
  }
  const qs = p.toString()
  history.pushState(null, '', qs ? `/?${qs}` : '/')
}

export default function App() {
  const [view, setView] = useState<View>(viewFromLocation)
  const [results, setResults] = useState<Results | null>(null)
  const [album, setAlbum] = useState<AlbumDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const inflight = useRef<AbortController | null>(null)
  const preview = usePreview()
  const pushToast = useToasts((s) => s.push)
  const { t } = useI18n()

  const navigate = useCallback((next: View, { push = true } = {}) => {
    if (push) pushView(next)
    setView(next)
  }, [])

  useEffect(() => {
    const onPop = () => setView(viewFromLocation())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // بارگذاری داده بر اساس ویو فعلی
  useEffect(() => {
    inflight.current?.abort()
    preview.stop()

    if (view.kind === 'home') {
      setLoading(false)
      return
    }

    const ctrl = new AbortController()
    inflight.current = ctrl
    setLoading(true)

    const task =
      view.kind === 'results'
        ? api.search(view.query, ctrl.signal).then((r) => setResults(r))
        : api.getAlbum(view.ref, ctrl.signal).then((a) => setAlbum(a))

    task
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return
        pushToast(err instanceof Error ? err.message : t.fetchError, 'error')
      })
      .finally(() => {
        if (!ctrl.signal.aborted) setLoading(false)
      })

    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  const submit = (value: string) => {
    if (isUrl(value)) navigate({ kind: 'album', ref: value })
    else navigate({ kind: 'results', query: value })
  }

  const openAlbum = (a: Album) =>
    navigate({
      kind: 'album',
      ref: a.sourceUrl || a.id,
      from: view.kind === 'results' ? view.query : undefined,
    })

  const back = () => {
    if (view.kind === 'album' && view.from) navigate({ kind: 'results', query: view.from })
    else history.back()
  }

  // پیست کردن لینک در هر جای صفحه
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return
      const text = e.clipboardData?.getData('text')?.trim()
      if (text && isUrl(text)) {
        e.preventDefault()
        submit(text)
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const query =
    view.kind === 'results' ? view.query : view.kind === 'album' ? (view.from ?? '') : ''

  return (
    <div className="flex min-h-dvh flex-col">
      <Header onHome={() => navigate({ kind: 'home' })} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-32">
        <section className="pt-14 text-center sm:pt-20">
          <h1 className="text-3xl font-black leading-[1.35] sm:text-5xl sm:leading-[1.3]">
            {t.heroLine1}
            <br />
            <span className="text-accent">{t.heroLine2}</span>
          </h1>
          <p className="mx-auto mt-4 max-w-lg text-xs leading-6 text-muted sm:text-sm sm:leading-7">
            {t.heroBody}
          </p>

          <div className="mx-auto mt-8 max-w-2xl">
            <SearchBar
              value={query}
              loading={loading && view.kind === 'results'}
              onSubmit={submit}
            />
          </div>
        </section>

        <section className="mt-10">
          {view.kind === 'results' &&
            (loading || !results ? (
              <ResultsSkeleton />
            ) : (
              <SearchResults
                results={results}
                playingId={preview.playingId}
                onTogglePlay={preview.toggle}
                onOpenAlbum={openAlbum}
              />
            ))}

          {view.kind === 'album' &&
            (loading || !album ? (
              <AlbumSkeleton />
            ) : (
              <AlbumView
                album={album}
                playingId={preview.playingId}
                onTogglePlay={preview.toggle}
                onBack={back}
              />
            ))}
        </section>
      </main>

      <Footer />
      <DownloadQueue />
      <Toaster />
    </div>
  )
}
