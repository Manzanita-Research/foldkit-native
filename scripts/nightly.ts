// The performance numbers (FKN-26): FoldKit on gpuix, in real windows, three
// apps, each in its own process, driven through gpuix's automation channel.
// Compared against a committed baseline for the machine class; a metric whose
// median got 25% worse (and by more than its noise floor) fails the run.
//
//   bun scripts/nightly.ts                          # run, print the table, compare to bench/baseline.<class>.json
//   bun scripts/nightly.ts --record                 # run and write that baseline
//   bun scripts/nightly.ts --runs 3 --apps counter  # fewer processes, one app
//   bun scripts/nightly.ts --out results.json       # also write the numbers as JSON
//   bun scripts/nightly.ts --class linux-m6         # name the machine class (default: macos or linux)
//
// A window is needed: macOS desktop, or on Linux inside
// scripts/wayland-session.sh (a headless compositor). Run one at a time.
//
// What each number is (lower is better for all of them). The table shows the
// median and, in brackets, the p95 (the budgets in the FKN-26 task are p95s);
// the run is gated on the median, because a p95 over a few dozen samples moves
// by 20% between identical runs:
// - first paint: spawn → the app's text is on screen (bun start-up and module
//   loading included). Over the runs.
// - click → frame: a click on a button → the text it changes is on screen.
//   Over every sample.
// - key → frame: one keystroke → the text it changes is on screen.
// - theme switch: Big List's switch → "Light"/"Dark" on screen.
// - scroll step → frame: one wheel step over Big List's rows → the row it
//   reaches is on screen. (A step's latency, not GPUI's frame time: gpuix
//   gives automation no frame times.)
// - RSS: the process's resident memory once settled.
// - idle CPU: the process's CPU time while nothing happens, as a share of one
//   core (the quietest of three 2-second windows, once the loop has settled).
//
// "On screen" is GPUI's last painted frame (getPaintedText) where gpuix has it
// (macOS), and the retained tree (getAllText), up to a frame earlier, where it
// doesn't (Linux: gpuix 0.10's painted-text read is empty there). The table
// says which. Every number includes the automation round trip, the same in
// every run.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { METRICS, ORDER, type Results, type Row, THRESHOLD, compare } from './nightly-compare.ts'

const root = resolve(import.meta.dir, '..')
const flag = (name: string) => process.argv.includes(`--${name}`)
const option = (name: string) => {
  const at = process.argv.indexOf(`--${name}`)
  return at === -1 ? undefined : process.argv[at + 1]
}

const RUNS = Number(option('runs') ?? 5)
const SAMPLES = 10
const APPS = (option('apps') ?? 'counter,big-list,pixel-art').split(',')
const CLASS = option('class') ?? (process.platform === 'darwin' ? 'macos' : 'linux')
const BASELINE = resolve(root, `bench/baseline.${CLASS}.json`)
type App = { id: string; command: Array<string>; env: Record<string, string>; ready: string }
const APP: Record<string, App> = {
  'counter': { id: 'counter', command: ['bench/counter.ts'], env: {}, ready: 'Count: 0' },
  'big-list': { id: 'big-list', command: ['examples/open.ts', 'big-list'], env: { FOLDKIT_NATIVE_RENDERER: 'gpuix' }, ready: '10,000 tracks' },
  'pixel-art': { id: 'pixel-art', command: ['examples/open.ts', 'pixel-art'], env: { FOLDKIT_NATIVE_RENDERER: 'gpuix' }, ready: 'PixelForge' },
}

type Automation = Awaited<ReturnType<typeof import('@gpuix/native/automation')['launch']>>
const call = (app: Automation, method: string, params: Record<string, unknown> = {}) =>
  (app as unknown as { call: (method: string, params: Record<string, unknown>) => Promise<unknown> }).call(method, params)
const texts = async (app: Automation, method: 'getPaintedText' | 'getAllText') => ((await call(app, method)) as { text: Array<string> }).text

const settle = (ms: number) => new Promise(done => setTimeout(done, ms))

/** The process: its pid, resident MB, and CPU seconds, from `ps` and /proc. */
const processOf = (marker: string) => {
  const out = execFileSync('ps', ['-axo', 'pid=,rss=,command='], { encoding: 'utf8' })
  const line = out.split('\n').find(row => row.includes(marker))
  if (line === undefined) throw new Error(`no process runs ${marker}`)
  const [pid, rss] = line.trim().split(/\s+/)
  return { pid: Number(pid), rssMb: Number(rss) / 1024 }
}
const cpuSeconds = (pid: number): number => {
  if (process.platform === 'linux') {
    // utime and stime, in clock ticks (fields 14 and 15; the name may hold spaces).
    const after = readFileSync(`/proc/${pid}/stat`, 'utf8').replace(/^.*\) /, '').split(' ')
    return (Number(after[11]) + Number(after[12])) / 100
  }
  const [minutes, seconds] = execFileSync('ps', ['-o', 'time=', '-p', String(pid)], { encoding: 'utf8' }).trim().split(':')
  return Number(minutes) * 60 + Number(seconds)
}

type Samples = Record<string, Array<number>>

const once = async (app: App, run: number): Promise<{ samples: Samples; signal: string }> => {
  const { launch } = await import('@gpuix/native/automation')
  const marker = `--nightly-${app.id}-${run}-${process.pid}`
  const started = performance.now()
  const window = await launch({
    command: process.execPath, args: [...app.command, marker], cwd: root, env: { ...process.env, ...app.env },
  })
  const samples: Samples = {}
  const record = (key: string, value: number) => (samples[key] ??= []).push(value)
  const timed = async (key: string, act: () => Promise<unknown>) => {
    const at = performance.now()
    await act()
    record(key, performance.now() - at)
  }
  try {
    // First, which signal means "on screen": painted text if gpuix has it.
    let signal: 'getPaintedText' | 'getAllText' = 'getAllText'
    const lines = async () => texts(window, signal)
    const appears = async (text: string, timeoutMs = 5000, gone = false) => {
      for (const until = performance.now() + timeoutMs; (await lines()).some(line => line.includes(text)) === gone;) {
        if (performance.now() > until) {
          const seen = (await lines()).slice(0, 25).join(' | ')
          throw new Error(`${app.id}: "${text}" never ${gone ? 'left' : 'was on screen'} (${signal} text: ${seen})`)
        }
      }
    }
    await window.getByText(app.ready).waitFor({ timeoutMs: 15_000 })
    // Pixel Art's Listbox opens in an anchored overlay that macOS's painted text
    // doesn't list, so it always waits on the retained tree.
    if (app.id !== 'pixel-art' && (await texts(window, 'getPaintedText')).length > 0) signal = 'getPaintedText'
    await appears(app.ready, 15_000)
    record('first', performance.now() - started)
    await settle(800)
    record('rss', processOf(marker).rssMb)

    /** The painted element whose own text is exactly `text`: where to click. */
    const centreOf = async (text: string) => {
      const nodes = await window.getByText(text).all()
      const box = (nodes.find(found => found.text === text && found.bounds !== undefined) ?? nodes.find(found => found.bounds !== undefined))?.bounds
      if (box === undefined) throw new Error(`${app.id}: nothing painted says "${text}"`)
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
    }
    const click = (at: { x: number; y: number }) => call(window, 'click', at)

    if (app.id === 'counter') {
      const plus = await centreOf('+1')
      for (let i = 1; i <= SAMPLES; i++) {
        await timed('click', async () => {
          await click(plus)
          await appears(`Count: ${i}`)
        })
        await settle(50)
      }
    } else if (app.id === 'big-list') {
      const toggle = await centreOf('Dark')
      for (let i = 0; i < SAMPLES; i++) {
        const to = i % 2 === 0 ? 'Light' : 'Dark'
        await timed('theme', async () => {
          await click(toggle)
          await appears(to)
        })
        await settle(100)
      }
      const [input] = await window.getByType('input').all()
      if (input?.bounds === undefined) throw new Error('big-list: no painted input')
      await click({ x: input.bounds.x + input.bounds.width / 2, y: input.bounds.y + input.bounds.height / 2 })
      await settle(300)
      for (let i = 0; i < SAMPLES; i++) {
        await timed('key', async () => {
          await call(window, 'keystrokes', { keys: i % 2 === 0 ? 'z' : 'backspace' })
          await appears('10,000 of 10,000', 5000, i % 2 === 0)
        })
        await settle(100)
      }
      // Wheel over the rows: down a few, back to the top; the first row's
      // number says where it got to.
      const row = await centreOf('Harbor (Lonely Mix)')
      const firstRow = async () => {
        const all = await lines()
        return all[all.indexOf('Time') + 1]
      }
      for (let i = 0; i < SAMPLES * 2; i++) {
        const down = i % 2 === 0
        await timed('scroll', async () => {
          await call(window, 'scrollWheel', { x: row.x, y: row.y, deltaX: 0, deltaY: down ? -600 : 600 })
          for (const until = performance.now() + 5000; ((await firstRow()) === '1') === down;) {
            if (performance.now() > until) throw new Error(`big-list: the wheel ${down ? 'down' : 'up'} never moved the rows`)
          }
        })
        await settle(100)
      }
    } else {
      const theme = await centreOf('Syntax')
      for (let i = 0; i < SAMPLES; i++) {
        await timed('click', async () => {
          await click(theme)
          await appears('Sunset')
        })
        await settle(100)
        await timed('key', async () => {
          await call(window, 'keystrokes', { keys: 'escape' })
          await appears('Sunset', 5000, true)
        })
        await settle(100)
      }
    }

    // Idle: nothing happening. The loop settles 2-4 s after the last
    // interaction (right after one, it's about twice as busy), then three
    // 2-second windows; the quietest is the figure.
    await settle(3000)
    const { pid } = processOf(marker)
    const windows: Array<number> = []
    for (let i = 0; i < 3; i++) {
      const before = cpuSeconds(pid)
      const at = performance.now()
      await settle(2000)
      windows.push(((cpuSeconds(pid) - before) / ((performance.now() - at) / 1000)) * 100)
    }
    record('cpu', Math.min(...windows))
    return { samples, signal: signal === 'getPaintedText' ? 'painted' : 'retained' }
  } finally {
    await window.close()
  }
}

const percentile = (values: Array<number>, p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))]!

const commit = () => {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

const results: Results = { class: CLASS, platform: process.platform, arch: process.arch, commit: commit(), date: new Date().toISOString(), runs: RUNS, apps: {} }
for (const id of APPS) {
  const app = APP[id]
  if (app === undefined) throw new Error(`unknown app ${id}: ${Object.keys(APP).join(', ')}`)
  const pooled: Samples = {}
  let signal = 'retained'
  for (let run = 0; run < RUNS; run++) {
    const once1 = await once(app, run)
    signal = once1.signal
    for (const [key, values] of Object.entries(once1.samples)) (pooled[key] ??= []).push(...values)
    await settle(500)
  }
  results.apps[id] = {
    signal,
    metrics: Object.fromEntries(Object.entries(pooled).map(([key, values]) => [key, { median: percentile(values, 0.5), p95: percentile(values, 0.95), samples: values.length }])),
  }
  console.error(`${id}: ${JSON.stringify(results.apps[id]!.metrics)}`)
}

// COMPARE

const baseline: Results | undefined = existsSync(BASELINE) && !flag('record') ? JSON.parse(readFileSync(BASELINE, 'utf8')) : undefined
const rows = compare(results, baseline)

const cell = (row: Row) => {
  const metric = METRICS[row.key]!
  const value = `${row.value.toFixed(metric.digits)} ${metric.unit}${row.key === 'rss' || row.key === 'cpu' ? '' : ` (p95 ${row.p95.toFixed(metric.digits)})`}`
  if (row.baseline === undefined || row.change === undefined) return value
  const sign = row.change >= 0 ? '+' : ''
  return `${value} ${sign}${(row.change * 100).toFixed(0)}% vs ${row.baseline.toFixed(metric.digits)}${row.failed ? ' ✗' : ''}`
}
const table = [
  `| App | ${ORDER.map(key => METRICS[key]!.name).join(' | ')} |`,
  `|---|${ORDER.map(() => '---').join('|')}|`,
  ...Object.keys(results.apps).map(app => `| ${app} | ${ORDER.map(key => {
    const row = rows.find(each => each.app === app && each.key === key)
    return row === undefined ? '–' : cell(row)
  }).join(' | ')} |`),
].join('\n')
const failures = rows.filter(row => row.failed)
const header = `FoldKit on gpuix, ${CLASS} (${process.platform} ${process.arch}), commit ${results.commit}, ${RUNS} processes per app, interactions ${SAMPLES}× per process. On screen = ${[...new Set(Object.values(results.apps).map(each => each.signal))].join(', ')} text.`
const verdict = baseline === undefined
  ? flag('record') ? `Recorded as the baseline: ${BASELINE}` : `No baseline for class "${CLASS}" (${BASELINE}): run with --record to make one.`
  : failures.length === 0 ? `Within ${Math.round((THRESHOLD - 1) * 100)}% of the baseline (${baseline.commit}, ${baseline.date.slice(0, 10)}).`
    : `FAILED: ${failures.length} metric(s) at least ${Math.round((THRESHOLD - 1) * 100)}% worse than the baseline (${baseline.commit}, ${baseline.date.slice(0, 10)}): ${failures.map(row => `${row.app} ${METRICS[row.key]!.name}`).join(', ')}`

console.log(`${header}\n\n${table}\n\n${verdict}`)
const out = option('out')
if (out !== undefined) writeFileSync(resolve(out), `${JSON.stringify(results, null, 2)}\n`)
if (flag('record')) writeFileSync(BASELINE, `${JSON.stringify(results, null, 2)}\n`)
process.exit(failures.length === 0 ? 0 : 1)
