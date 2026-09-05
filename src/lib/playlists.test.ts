import { describe, expect, it } from 'vitest'
import { buildRule } from './playlists'

describe('قانونِ پلی‌لیستِ هوشمند', () => {
  it('«فرقی نمی‌کند» هیچ فیلترِ حس‌وحالی نمی‌گذارد', () => {
    const rule = buildRule('any', 'any')
    expect(rule.valenceMin).toBeUndefined()
    expect(rule.valenceMax).toBeUndefined()
    expect(rule.energyMin).toBeUndefined()
    expect(rule.energyMax).toBeUndefined()
  })

  it('شاد کفِ والانس می‌گذارد و غمگین سقفش', () => {
    expect(buildRule('happy', 'any').valenceMin).toBeGreaterThan(0.5)
    expect(buildRule('sad', 'any').valenceMax).toBeLessThan(0.5)
  })

  it('پرشور و آرام روی انرژی می‌نشینند، نه والانس', () => {
    expect(buildRule('any', 'loud').energyMin).toBeGreaterThan(0.5)
    expect(buildRule('any', 'calm').energyMax).toBeLessThan(0.5)
    expect(buildRule('any', 'loud').valenceMin).toBeUndefined()
  })

  it('حس‌وحال و انرژی با هم جمع می‌شوند', () => {
    const rule = buildRule('happy', 'loud')
    expect(rule.valenceMin).toBeDefined()
    expect(rule.energyMin).toBeDefined()
  })

  it('دو سرِ یک محور هیچ‌وقت هم‌زمان ست نمی‌شوند — وگرنه نتیجه همیشه خالی بود', () => {
    const happy = buildRule('happy', 'any')
    expect(happy.valenceMax).toBeUndefined()
    const sad = buildRule('sad', 'any')
    expect(sad.valenceMin).toBeUndefined()
  })

  it('سقفِ تعداد همیشه هست — پلی‌لیستِ هوشمند نباید کلِ کتابخانه شود', () => {
    expect(buildRule('any', 'any').limit).toBeGreaterThan(0)
  })
})
