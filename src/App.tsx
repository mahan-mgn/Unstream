import { useCallback, useEffect, useRef, useState } from 'react'
import AlbumView from './components/AlbumView'
import ArtistView from './components/ArtistView'
import DownloadQueue from './components/DownloadQueue'
import Footer from './components/Footer'
import Header from './components/Header'
import LibraryView from './components/LibraryView'
import SearchBar from './components/SearchBar'
import SearchResults from './components/SearchResults'
import { AlbumSkeleton, ResultsSkeleton } from './components/Skeletons'
import Toaster from './components/Toaster'
import { api } from './lib/api'
import { isUrl } from './lib/format'
import { useI18n } from './lib/i18n'
import type {
  Album,
  AlbumDetail,
  Artist,
  ArtistDetail,
  SearchResults as Results,
} from './lib/types'
import { usePreview } from './lib/usePreview'
import { useToasts } from './store/toasts'

type View =
  | { kind: 'home' }
  | { kind: 'results'; query: string }
  | { kind: 'album'; ref: string; from?: string }
  | { kind: 'artist'; ref: string; from?: string }
  | { kind: 'library' }

function viewFromLocation(): View {
  const p = new URLSearchParams(location.search)
  if (p.has('library')) return { kind: 'library' }
  const artist = p.get('artist')
  if (artist) return { kind: 'artist', ref: artist, from: p.get('q') ?? undefined }
  const url = p.get('url')
  if (url) return { kind: 'album', ref: url, from: p.get('q') ?? undefined }
  const q = p.get('q')
  if (q) return { kind: 'results', query: q }
  return { kind: 'home' }
}

function pushView(view: View) {
  const p = new URLSearchParams()
  if (view.kind === 'results') p.set('q', view.query)
  if (view.kind === 'library') p.set('library', '1')
  if (view.kind === 'album' || view.kind === 'artist') {
    p.set(view.kind === 'album' ? 'url' : 'artist', view.ref)
    if (view.from) p.set('q', view.from)
  }
  const qs = p.toString()
  history.pushState(null, '', qs ? `/?${qs}` : '/')
}

export default function App() {
  const [view, setView] = useState<View>(viewFromLocation)
  const [results, setResults] = useState<Results | null>(null)
  const [album, setAlbum] = useState<AlbumDetail | null>(null)
  const [artist, setArtist] = useState<ArtistDetail | null>(null)
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

    // خانه و کتابخانه هیچ‌کدام از این لایه داده نمی‌گیرند
    // (کتابخانه خودش fetch می‌کند چون جستجوی درون‌صفحه‌ای دارد)
    if (view.kind === 'home' || view.kind === 'library') {
      setLoading(false)
      return
    }

    const ctrl = new AbortController()
    inflight.current = ctrl
    setLoading(true)

    const task =
      view.kind === 'results'
        ? api.search(view.query, ctrl.signal).then((r) => setResults(r))
        : view.kind === 'artist'
          ? api.getArtist(view.ref, ctrl.signal).then((a) => setArtist(a))
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

  /** عبارت جستجویی که باید موقع «برگشت» به آن برگردیم */
  const searchOrigin = () =>
    view.kind === 'results' ? view.query : 'from' in view ? view.from : undefined

  const openAlbum = (a: Album) =>
    navigate({ kind: 'album', ref: a.sourceUrl || a.id, from: searchOrigin() })

  const openArtist = (a: Artist) =>
    navigate({ kind: 'artist', ref: a.id, from: searchOrigin() })

  const back = () => {
    if ((view.kind === 'album' || view.kind === 'artist') && view.from) {
      navigate({ kind: 'results', query: view.from })
    } else {
      history.back()
    }
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

  const query = view.kind === 'results' ? view.query : searchOrigin() ?? ''

  return (
    <div className="flex min-h-dvh flex-col">
      <Header
        onHome={() => navigate({ kind: 'home' })}
        onLibrary={() => navigate({ kind: 'library' })}
        inLibrary={view.kind === 'library'}
      />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 pb-32">
        {view.kind !== 'library' && (
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
        )}

        <section className={view.kind === 'library' ? 'pt-8' : 'mt-10'}>
          {view.kind === 'library' && <LibraryView />}

          {view.kind === 'results' &&
            (loading || !results ? (
              <ResultsSkeleton />
            ) : (
              <SearchResults
                results={results}
                playingId={preview.playingId}
                onTogglePlay={preview.toggle}
                onOpenAlbum={openAlbum}
                onOpenArtist={openArtist}
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

          {view.kind === 'artist' &&
            (loading || !artist ? (
              <AlbumSkeleton />
            ) : (
              <ArtistView
                artist={artist}
                playingId={preview.playingId}
                onTogglePlay={preview.toggle}
                onOpenAlbum={openAlbum}
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
