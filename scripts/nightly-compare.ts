// What scripts/nightly.ts measures, and the rule that fails it: a metric whose
// median is at least 25% worse than the baseline's, and worse by more than its
// noise floor (below the floor the run-to-run noise is bigger than 25%).

export type Metric = { name: string; unit: string; digits: number; floor: number }

export const METRICS: Record<string, Metric> = {
  first: { name: 'first paint', unit: 'ms', digits: 0, floor: 50 },
  click: { name: 'click → frame', unit: 'ms', digits: 1, floor: 5 },
  key: { name: 'key → frame', unit: 'ms', digits: 1, floor: 5 },
  theme: { name: 'theme switch', unit: 'ms', digits: 1, floor: 5 },
  scroll: { name: 'scroll step → frame', unit: 'ms', digits: 1, floor: 5 },
  rss: { name: 'RSS', unit: 'MB', digits: 0, floor: 10 },
  cpu: { name: 'idle CPU', unit: '% of a core', digits: 1, floor: 2 },
}
export const ORDER = Object.keys(METRICS)
export const THRESHOLD = 1.25

export type Measured = { median: number; p95: number; samples: number }
export type Results = {
  class: string; platform: string; arch: string; commit: string; date: string; runs: number
  apps: Record<string, { signal: string; metrics: Record<string, Measured> }>
}

export type Row = { app: string; key: string; value: number; p95: number; baseline: number | undefined; change: number | undefined; failed: boolean }

/** Every metric of every app, against the baseline's (none: nothing fails). */
export const compare = (results: Results, baseline: Results | undefined): Array<Row> => {
  const rows: Array<Row> = []
  for (const [app, { metrics }] of Object.entries(results.apps)) {
    for (const key of ORDER) {
      const metric = metrics[key]
      if (metric === undefined) continue
      const before = baseline?.apps[app]?.metrics[key]?.median
      const change = before === undefined || before === 0 ? undefined : metric.median / before - 1
      const failed = before !== undefined && metric.median >= before * THRESHOLD && metric.median - before >= METRICS[key]!.floor
      rows.push({ app, key, value: metric.median, p95: metric.p95, baseline: before, change, failed })
    }
  }
  return rows
}
