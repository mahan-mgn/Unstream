import type { MusicApi } from '../types'
import { httpApi } from './http'
import { mockApi } from './mock'

/**
 * برای وصل شدن به بک‌اند واقعی، در فایل .env.local بنویس:
 *   VITE_API_MODE=http
 */
const mode = import.meta.env.VITE_API_MODE ?? 'mock'

export const api: MusicApi = mode === 'http' ? httpApi : mockApi
export const API_MODE = mode
