// Equal-workload measurements, the mirror against FoldKit on gpuix, in real
// windows on this machine's GPU (FKN-20). Each run is its own process,
// launched and driven through gpuix's automation channel; both paths get the
// same example, the same input and the same waits, one after the other.
//
//   bun scripts/measure.ts            # 5 runs per path, medians
//   RUNS=3 bun scripts/measure.ts      # fewer processes (interactions are 10× each)
//
// What each number is:
// - first paint: spawn → the example's text is in a painted frame
//   (bun start-up and module loading included, the same for both);
// - edit → frame: one keystroke into a field → the text it causes is painted
//   (Form: the name's validation message; Big List: the filtered count);
// - theme switch: a click on Big List's switch → "Light" is painted;
// - RSS: the process's resident memory once settled, from `ps`.
// Every wait polls the text of GPUI's last painted frame (getPaintedText),
// so the automation round trip is in every timing, on both paths alike.
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const RUNS = Number(process.env['RUNS'] ?? 5)
const root = resolve(import.meta.dir, '..')
type Row = Record<string, number>

const rss = (marker: string): number => {
  const out = execFileSync('ps', ['-axo', 'pid=,rss=,command='], { encoding: 'utf8' })
  const line = out.split('\n').find(row => row.includes(marker) && row.includes('examples/open.ts'))
  return line === undefined ? NaN : Number(line.trim().split(/\s+/)[1]) / 1024
}

type Automation = Awaited<ReturnType<typeof import('@gpuix/native/automation')['launch']>>
/** Clicks the first painted `input`, by its centre (the mirror has no test ids). */
const clickFirstInput = async (app: Automation) => {
  const [input] = await app.getByType('input').all()
  const box = input?.bounds
  if (box === undefined) throw new Error('no painted input')
  await app.call('click', { x: box.x + box.width / 2, y: box.y + box.height / 2 })
}

/** The text in GPUI's last painted frame (not its retained tree, which the
 *  mirror updates a frame before it paints). */
const painted = async (app: Automation) => ((await app.call('getPaintedText', {})) as { text: Array<string> }).text
/** Until a painted frame has text containing `text` (or, `gone`, has none). */
const appears = async (app: Automation, text: string, timeoutMs = 5000, gone = false) => {
  const until = performance.now() + timeoutMs
  while ((await painted(app)).some(line => line.includes(text)) === gone) {
    if (performance.now() > until) throw new Error(`"${text}" never ${gone ? 'left' : 'painted'}`)
  }
}

const SAMPLES = 10

/** One process: first paint and RSS once, the interactions SAMPLES times. */
const once = async (example: string, renderer: 'mirror' | 'gpuix', run: number): Promise<Record<string, Array<number>>> => {
  const { launch } = await import('@gpuix/native/automation')
  const marker = `--measure-${renderer}-${example}-${run}-${process.pid}`
  const started = performance.now()
  const app = await launch({
    command: process.execPath, args: ['examples/open.ts', example, marker], cwd: root,
    env: { ...process.env, FOLDKIT_NATIVE_RENDERER: renderer, FOLDKIT_NATIVE_AUTOMATION: '1' },
  })
  const row: Record<string, Array<number>> = {}
  const record = (name: string, value: number) => (row[name] ??= []).push(value)
  const timed = async (name: string, act: () => Promise<unknown>) => {
    const at = performance.now()
    await act()
    record(name, performance.now() - at)
  }
  const settle = (ms = 600) => new Promise(done => setTimeout(done, ms))
  try {
    if (example === 'form') {
      await appears(app, 'Join Our Waitlist', 15_000)
      record('first paint', performance.now() - started)
      await settle()
      record('RSS MB', rss(marker))
      await clickFirstInput(app)
      await settle()
      // Each keystroke: until the name field's text, as painted, has it.
      for (let i = 1; i <= SAMPLES; i++) {
        await timed('edit → frame', async () => {
          await app.call('keystrokes', { keys: 'q' })
          await appears(app, 'q'.repeat(i))
        })
        await settle(50)
      }
    } else {
      await appears(app, '10,000 tracks', 15_000)
      record('first paint', performance.now() - started)
      await settle()
      record('RSS MB', rss(marker))
      for (let i = 0; i < SAMPLES; i++) {
        const [from, to] = i % 2 === 0 ? ['Dark', 'Light'] : ['Light', 'Dark']
        await timed('theme switch', async () => {
          await clickText(app, from)
          await appears(app, to)
        })
        await settle(100)
      }
      await clickFirstInput(app)
      await settle()
      // Filter by a letter, then take it back: the count changes each time.
      for (let i = 0; i < SAMPLES; i++) {
        await timed('edit → frame', async () => {
          await app.call('keystrokes', { keys: i % 2 === 0 ? 'z' : 'backspace' })
          await appears(app, '10,000 of 10,000', 5000, i % 2 === 0)
        })
        await settle(100)
      }
    }
  } finally {
    await app.close()
  }
  return row
}

/** Clicks the painted element whose own text is exactly `text`. */
const clickText = async (app: Automation, text: string) => {
  const nodes = await app.getByText(text).all()
  const node = nodes.find(found => found.text === text && found.bounds !== undefined) ?? nodes.find(found => found.bounds !== undefined)
  if (node?.bounds === undefined) throw new Error(`nothing painted says "${text}"`)
  await app.call('click', { x: node.bounds.x + node.bounds.width / 2, y: node.bounds.y + node.bounds.height / 2 })
}

const percentile = (values: Array<number>, p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))]!

const results: Array<string> = []
for (const example of ['form', 'big-list']) {
  const pooled: Record<string, Record<string, Array<number>>> = { mirror: {}, gpuix: {} }
  for (let run = 0; run < RUNS; run++) {
    for (const renderer of ['mirror', 'gpuix'] as const) {
      const row = await once(example, renderer, run)
      for (const [metric, values] of Object.entries(row)) (pooled[renderer]![metric] ??= []).push(...values)
      await new Promise(done => setTimeout(done, 500))
    }
  }
  for (const metric of Object.keys(pooled['gpuix']!)) {
    const cell = (path: 'mirror' | 'gpuix') => {
      const values = pooled[path]![metric]!
      const digits = metric === 'RSS MB' ? 0 : 1
      return `${percentile(values, 0.5).toFixed(digits)} (p90 ${percentile(values, 0.9).toFixed(digits)})`
    }
    const ratio = percentile(pooled['mirror']![metric]!, 0.5) / percentile(pooled['gpuix']![metric]!, 0.5)
    results.push(`| ${example} | ${metric}${metric === 'RSS MB' ? '' : ' (ms)'} | ${cell('mirror')} | ${cell('gpuix')} | ${ratio.toFixed(2)}× | ${pooled['gpuix']![metric]!.length} |`)
  }
  console.error(`${example}: ${JSON.stringify(pooled)}`)
}
console.log(`| Example | Measure | Mirror, median (p90) | FoldKit on gpuix, median (p90) | Mirror ÷ gpuix | Samples per path |\n|---|---|---|---|---|---|\n${results.join('\n')}`)
console.log(`\n${RUNS} processes per path; interactions ${SAMPLES}× per process. ${process.platform} ${process.arch}, live windows.`)
