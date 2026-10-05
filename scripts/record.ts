// Evidence for an example: a still and a short clip of the real app in a real
// window, driven through gpuix's automation channel.
//
//   bun run record weather            → evidence/weather.png, evidence/weather.mp4
//   bun run record weather some/dir   → some/dir/weather.png, …
//
// The walk-through is the example's demo (`examples/<name>/demo.ts`, or
// `examples/<name>.demo.ts` for the single-file demos); without one, the clip
// is a few seconds of the app at rest. Frames come from GPUI's own renderer,
// not a screen grab, so no screen-recording permission is needed. Needs
// ffmpeg on PATH. gpuix reads frames back on macOS and Windows only.

import { type App, launch } from '@gpuix/native/automation'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { entries } from '../examples/support/example.ts'

/** A demo module exports `ready` (text that shows once the app has drawn)
 *  and `demo`, which drives the app for the clip (`pause` is a plain wait). */
export type Demo = (app: App, pause: (ms: number) => Promise<void>) => Promise<void>

/** The centre of the `index`th element showing `text`, for `app.mouse`.
 *  gpuix's locators insist on exactly one match; lists repeat their labels
 *  ("Add to Cart" on every product). */
export const nth = async (app: App, text: string, index = 0) => {
  const found = (await app.getByText(text).all()).filter(node => node.bounds !== undefined)
  const node = found[index]
  if (node === undefined) throw new Error(`no element #${index} showing "${text}" (found ${found.length})`)
  return { x: node.bounds!.x + node.bounds!.width / 2, y: node.bounds!.y + node.bounds!.height / 2 }
}

const id = process.argv[2]
const all = await entries()
const entry = all.find(candidate => candidate.id === id)
if (entry === undefined) {
  console.error(`usage: bun run record <name> [dir]\nexamples: ${all.map(candidate => candidate.id).join(', ')}`)
  process.exit(1)
}
const root = resolve(import.meta.dir, '..')
const outDir = resolve(process.argv[3] ?? join(root, 'evidence'))
await mkdir(outDir, { recursive: true })
const frameDir = await mkdtemp(join(tmpdir(), 'foldkit-native-record-'))

const demoFile = [join(root, 'examples', entry.id, 'demo.ts'), join(root, 'examples', `${entry.id}.demo.ts`)].find(existsSync)
const { demo, ready } = demoFile === undefined
  ? { demo: (async (_app, pause) => pause(3000)) as Demo, ready: undefined }
  : ((await import(demoFile)) as { demo: Demo; ready?: string })

const app = await launch({ command: process.execPath, args: [...entry.command], cwd: root, env: { FOLDKIT_NATIVE_AUTOMATION: '1' } })
// The app is its own process: close it however this script ends (a demo
// that throws, a \`ready\` that never shows, Ctrl-C), or its window stays open.
process.once('SIGINT', () => void app.close().finally(() => process.exit(130)))
const pause = (ms: number) => new Promise<void>(done => setTimeout(done, ms))
// Frames are taken as fast as the app answers; each keeps its real duration.
const frames: Array<{ file: string; at: number }> = []
try {
  // `ready` may show more than once (a list), so wait for any match.
  const until = performance.now() + 10_000
  while (ready !== undefined && (await app.getByText(ready).count()) === 0) {
    if (performance.now() > until) throw new Error(`"${ready}" didn't show within 10 s`)
    await pause(50)
  }
  if (ready === undefined) await pause(1500)
  await pause(500)
  await app.screenshot({ path: join(outDir, `${entry.id}.png`) })

  let recording = true
  const recordFrom = performance.now()
  const recorder = (async () => {
    while (recording) {
      const file = join(frameDir, `${String(frames.length).padStart(5, '0')}.png`)
      await app.screenshot({ path: file })
      frames.push({ file, at: performance.now() - recordFrom })
    }
  })()
  try {
    await demo(app, pause)
    await pause(800)
  } finally {
    recording = false
    await recorder
  }
} finally {
  await app.close()
}

// ffmpeg's concat list gives every frame the time until the next one.
const list = frames.map((frame, i) =>
  `file '${frame.file}'\nduration ${(((frames[i + 1]?.at ?? frame.at + 100) - frame.at) / 1000).toFixed(3)}`)
await writeFile(join(frameDir, 'frames.txt'), `${list.join('\n')}\nfile '${frames.at(-1)!.file}'\n`)
const clip = join(outDir, `${entry.id}.mp4`)
const ffmpeg = Bun.spawnSync(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(frameDir, 'frames.txt'),
  '-vf', 'fps=30,scale=trunc(iw/2)*2:trunc(ih/2)*2,format=yuv420p', '-c:v', 'libx264', '-crf', '20', clip])
if (ffmpeg.exitCode !== 0) throw new Error(`ffmpeg failed: ${ffmpeg.stderr.toString()}`)
await rm(frameDir, { recursive: true })
const seconds = (frames.at(-1)!.at / 1000).toFixed(1)
console.log(`${join(outDir, `${entry.id}.png`)}\n${clip}: ${frames.length} frames over ${seconds} s`)
process.exit(0)
