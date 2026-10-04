// Records examples/themes.ts as a short video: the real app in a real window,
// driven through gpuix's automation channel (hover, select, switch theme).
// Frames come from GPUI's own renderer (Metal on macOS), not a screen grab, so
// no screen-recording permission is needed. Needs ffmpeg on PATH.
//
//   bun run record [out.mp4]
//
// gpuix can only read frames back on macOS and Windows.

import { launch } from '@gpuix/native/automation'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const out = resolve(process.argv[2] ?? 'themes-demo.mp4')
const dir = await mkdtemp(join(tmpdir(), 'foldkit-native-record-'))
await mkdir(dir, { recursive: true })

const app = await launch({ command: 'bun', args: ['examples/themes.ts'], cwd: resolve(import.meta.dir, '..') })
const pause = (ms: number) => new Promise(done => setTimeout(done, ms))
await app.getByText('Inbox').waitFor({ timeoutMs: 10_000 })

// Frames are taken as fast as the app answers; each keeps its real duration.
const frames: Array<{ file: string; at: number }> = []
let recording = true
const started = performance.now()
const recorder = (async () => {
  while (recording) {
    const file = join(dir, `${String(frames.length).padStart(5, '0')}.png`)
    await app.screenshot({ path: file })
    frames.push({ file, at: performance.now() - started })
  }
})()

const item = (label: string) => app.getByText(label)
const theme = (name: string) => app.getByText(`switch theme (${name})`)
const script: Array<() => Promise<unknown>> = [
  () => pause(2500),
  () => item('Projects').hover(), () => pause(700),
  () => item('Projects').click(), () => pause(1000),
  () => item('Threads').hover(), () => pause(700),
  () => item('Threads').click(), () => pause(1200),
  () => theme('dusk').hover(), () => pause(600),
  () => theme('dusk').click(), () => pause(2000),
  () => item('Settings').hover(), () => pause(700),
  () => item('Settings').click(), () => pause(1200),
  () => item('Inbox').hover(), () => pause(700),
  () => item('Inbox').click(), () => pause(1200),
  () => theme('paper').click(), () => pause(2000),
  () => item('Projects').click(), () => pause(2500),
]
for (const step of script) await step()
recording = false
await recorder
await app.close()

// ffmpeg's concat list gives every frame the time until the next one.
const list = frames.map((frame, i) =>
  `file '${frame.file}'\nduration ${(((frames[i + 1]?.at ?? frame.at + 100) - frame.at) / 1000).toFixed(3)}`)
await writeFile(join(dir, 'frames.txt'), `${list.join('\n')}\nfile '${frames.at(-1)!.file}'\n`)
const ffmpeg = Bun.spawnSync(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(dir, 'frames.txt'),
  '-vf', 'fps=30,format=yuv420p', '-c:v', 'libx264', '-crf', '20', out])
if (ffmpeg.exitCode !== 0) throw new Error(`ffmpeg failed: ${ffmpeg.stderr.toString()}`)
await rm(dir, { recursive: true })
const seconds = (frames.at(-1)!.at / 1000).toFixed(1)
console.log(`${out}: ${frames.length} frames over ${seconds} s (${(frames.length / Number(seconds)).toFixed(1)} fps captured)`)
process.exit(0)
