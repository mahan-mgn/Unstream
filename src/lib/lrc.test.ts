import { describe, expect, it } from 'vitest'
import {
  activeLyricIndex,
  activeWordIndex,
  lineProgress,
  parseLrc,
  wordProgress,
  type LyricLine,
} from './lrc'

describe('parseLrc', () => {
  it('parses timestamp and text', () => {
    expect(parseLrc('[00:12.50]Hello there')).toEqual([{ time: 12.5, text: 'Hello there' }])
  })

  it('sorts lines by time regardless of source order', () => {
    const lines = parseLrc('[00:20.00]Second\n[00:05.00]First')
    expect(lines.map((l) => l.text)).toEqual(['First', 'Second'])
  })

  it('expands one tag into multiple lines when repeated on the same row', () => {
    const lines = parseLrc('[00:01.00][00:30.00]La la la')
    expect(lines).toEqual([
      { time: 1, text: 'La la la' },
      { time: 30, text: 'La la la' },
    ])
  })

  it('ignores metadata rows and blank lines', () => {
    expect(parseLrc('[ar:Someone]\n[ti:Song]\n\n[00:01.00]First line')).toEqual([
      { time: 1, text: 'First line' },
    ])
  })

  it('handles colon-separated hundredths too', () => {
    expect(parseLrc('[01:02:03]Text')[0].time).toBeCloseTo(62.03)
  })

  it('parses enhanced word timestamps into words', () => {
    const [line] = parseLrc('[00:12.50]<00:12.50>Hello <00:13.00>world')
    expect(line.text).toBe('Hello world')
    expect(line.words).toEqual([
      { time: 12.5, text: 'Hello ' },
      { time: 13, text: 'world' },
    ])
  })

  it('keeps the leading gap on the first word and trailing whitespace trimmed', () => {
    const [line] = parseLrc('[00:12.50] <00:12.50>Go <00:12.80>now ')
    expect(line.text).toBe('Go now')
    expect(line.words![0].text).toBe('Go ')
  })

  it('ignores empty word tags (instrumental line) but keeps plain parsing', () => {
    expect(parseLrc('[00:12.50]<00:12.50><00:13.00>')[0].words).toBeUndefined()
    expect(parseLrc('[00:12.50]<00:12.50>Hello')[0].text).toBe('Hello')
  })

  it('gives each repeated line tag its own word timings', () => {
    const lines = parseLrc('[00:01.00]<00:01.00>Hi <00:01.50>there\n[00:30.00]Hi there')
    expect(lines[0].words).toEqual([
      { time: 1, text: 'Hi ' },
      { time: 1.5, text: 'there' },
    ])
    expect(lines[1].words).toBeUndefined()
  })
})

describe('activeLyricIndex', () => {
  const lines = parseLrc('[00:01.00]A\n[00:05.00]B\n[00:10.00]C')

  it('returns -1 before the first line', () => {
    expect(activeLyricIndex(lines, 0)).toBe(-1)
  })

  it('returns the last line whose time has passed', () => {
    expect(activeLyricIndex(lines, 6)).toBe(1)
  })

  it('returns the final line once past the end', () => {
    expect(activeLyricIndex(lines, 999)).toBe(2)
  })
})

describe('lineProgress', () => {
  const lines: LyricLine[] = [
    { time: 10, text: 'A' },
    { time: 20, text: 'B' },
    { time: 30, text: 'C' },
  ]

  it('is 0 before the line starts and 1 once the next line begins', () => {
    expect(lineProgress(lines, 0, 5, 60)).toBe(0)
    expect(lineProgress(lines, 0, 20, 60)).toBe(1)
  })

  it('interpolates across the gap to the next line', () => {
    expect(lineProgress(lines, 0, 15, 60)).toBeCloseTo(0.5)
    expect(lineProgress(lines, 1, 22.5, 60)).toBeCloseTo(0.25)
  })

  it('stretches the final line to the end of the track', () => {
    expect(lineProgress(lines, 2, 45, 60)).toBeCloseTo(0.5)
    expect(lineProgress(lines, 2, 60, 60)).toBe(1)
  })

  it('clamps to [0,1] past the end', () => {
    expect(lineProgress(lines, 2, 999, 60)).toBe(1)
  })

  it('returns 0 for no active line and 1 for a zero-length gap', () => {
    expect(lineProgress(lines, -1, 15, 60)).toBe(0)
    expect(lineProgress(lines, 99, 15, 60)).toBe(0)
    expect(lineProgress([{ time: 5, text: 'x' }, { time: 5, text: 'y' }], 0, 5, 60)).toBe(1)
  })
})

describe('activeWordIndex / wordProgress', () => {
  const words = [
    { time: 10, text: 'Go ' },
    { time: 10.5, text: 'now' },
    { time: 11.5, text: 'ok' },
  ]

  it('finds the last word whose time has passed', () => {
    expect(activeWordIndex(words, 10.2)).toBe(0)
    expect(activeWordIndex(words, 11.9)).toBe(2)
    expect(activeWordIndex(words, 9)).toBe(-1)
  })

  it('fills each word between its own tag and the next', () => {
    expect(wordProgress(words, 0, 10.25, 12)).toBeCloseTo(0.5)
    expect(wordProgress(words, 1, 10.5, 12)).toBe(0)
    // last word stretches to the end of the line (11.5 → 12)
    expect(wordProgress(words, 2, 11.75, 12)).toBeCloseTo(0.5)
  })

  it('clamps and handles zero-length spans', () => {
    expect(wordProgress(words, 1, 99, 12)).toBe(1)
    expect(wordProgress([{ time: 5, text: 'x' }, { time: 5, text: 'y' }], 0, 5, 6)).toBe(1)
  })
})
