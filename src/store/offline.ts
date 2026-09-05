import { create } from 'zustand'
import * as offline from '../lib/offline'
import type { LibraryItem } from '../lib/types'

const KEY = 'offline:pinned'

/**
 * ردیف‌هایی که برای پخشِ بدون اینترنت سنجاق شده‌اند.
 *
 * خودِ فایل‌ها در Cache Storage‌اند؛ اینجا فقط *متادیتا* می‌ماند و دلیلش این
 * است که آفلاین، `/api/library` جواب نمی‌دهد و بدون این فهرست، کتابخانه خالی
 * دیده می‌شد — با اینکه صداها روی همان دستگاه بودند.
 */
function read(): Record<string, LibraryItem> {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? (JSON.parse(raw) as Record<string, LibraryItem>) : {}
  } catch {
    return {}
  }
}

function write(items: Record<string, LibraryItem>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    // سهمیه پر است — سنجاق‌ها سر جایشان‌اند، فقط فهرستِ آفلاین به‌روز نشد
  }
}

interface OfflineState {
  items: Record<string, LibraryItem>
  /** jobIdهایی که همین الان در حال دانلود شدن به کش‌اند */
  busy: string[]
  pin: (item: LibraryItem) => Promise<boolean>
  unpin: (item: LibraryItem) => Promise<void>
  /** فهرستِ محلی را با چیزی که واقعاً در کش است یکی می‌کند */
  sync: () => Promise<void>
}

export const useOffline = create<OfflineState>((set, get) => ({
  items: read(),
  busy: [],

  pin: async (item) => {
    set({ busy: [...get().busy, item.jobId] })
    try {
      await offline.pin(item)
      const items = { ...get().items, [item.jobId]: item }
      write(items)
      set({ items })
      return true
    } catch {
      return false
    } finally {
      set({ busy: get().busy.filter((id) => id !== item.jobId) })
    }
  },

  unpin: async (item) => {
    await offline.unpin(item)
    const items = { ...get().items }
    delete items[item.jobId]
    write(items)
    set({ items })
  },

  sync: async () => {
    const cached = await offline.cachedUrls()
    const items = get().items
    // ردیفی که مرورگر کشش را دور انداخته (کمبود فضا) نباید در فهرست بماند و
    // بعد آفلاین یک ترکِ غیرقابل‌پخش نشان بدهد
    const alive = Object.fromEntries(
      Object.entries(items).filter(([, item]) => cached.has(new URL(item.streamUrl, location.origin).href)),
    )
    if (Object.keys(alive).length !== Object.keys(items).length) {
      write(alive)
      set({ items: alive })
    }
  },
}))

/** آیا این ردیف سنجاق شده — برای دکمه‌ی هر سطر */
export function usePinned(jobId: string): boolean {
  return useOffline((s) => Boolean(s.items[jobId]))
}
