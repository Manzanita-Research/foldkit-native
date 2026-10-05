// The rule that fails the nightly (scripts/nightly-compare.ts): a median at
// least 25% worse than the baseline's AND worse by more than the metric's
// noise floor. Pure, so it runs everywhere.
import { describe, expect, test } from 'bun:test'

import { type Measured, type Results, compare } from '../scripts/nightly-compare.ts'

const results = (metrics: Record<string, Partial<Measured>>): Results => ({
  class: 'test', platform: 'linux', arch: 'x64', commit: 'abc', date: '2026-10-04', runs: 5,
  apps: { app: { signal: 'retained', metrics: Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, { median: 0, p95: 0, samples: 10, ...value }])) } },
})
const failed = (now: Record<string, number>, before: Record<string, number>) =>
  compare(
    results(Object.fromEntries(Object.entries(now).map(([key, median]) => [key, { median }]))),
    results(Object.fromEntries(Object.entries(before).map(([key, median]) => [key, { median }]))),
  ).filter(row => row.failed).map(row => row.key)

describe('the nightly comparison', () => {
  test('under 25% worse passes, 25% or more worse fails', () => {
    expect(failed({ first: 1499 }, { first: 1200 })).toEqual([]) // +24.9%
    expect(failed({ first: 1500 }, { first: 1200 })).toEqual(['first']) // +25%
    expect(failed({ rss: 520 }, { rss: 400 })).toEqual(['rss']) // +30%
  })

  test('worse by 25% but within the noise floor passes', () => {
    expect(failed({ click: 6.2 }, { click: 4.5 })).toEqual([]) // +38%, 1.7 ms
    expect(failed({ cpu: 2.5 }, { cpu: 2 })).toEqual([]) // +25%, half a point
    expect(failed({ click: 10 }, { click: 4.5 })).toEqual(['click']) // +122%, 5.5 ms
  })

  test('better, equal, or with no baseline for the metric never fails', () => {
    expect(failed({ first: 600, rss: 100 }, { first: 1200, rss: 400 })).toEqual([])
    expect(failed({ first: 1200 }, { first: 1200 })).toEqual([])
    expect(failed({ first: 9999, scroll: 999 }, { rss: 1 })).toEqual([])
    expect(compare(results({ first: { median: 9999 } }), undefined).some(row => row.failed)).toBe(false)
  })

  test('reports the change against the baseline, and p95 beside the median', () => {
    const [row] = compare(results({ theme: { median: 66, p95: 80 } }), results({ theme: { median: 60 } }))
    expect(row).toMatchObject({ app: 'app', key: 'theme', value: 66, p95: 80, baseline: 60, failed: false })
    expect(row!.change).toBeCloseTo(0.1, 5)
  })
})
