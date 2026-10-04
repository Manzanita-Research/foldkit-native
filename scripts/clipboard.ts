// Clipboard and undo in a live window, against the system clipboard (FKN-21).
// The offscreen tests (packages/foldkit-gpuix/test/keyboard.test.ts) check
// GPUI's editor actions with its test platform's in-memory clipboard; this
// checks the real one: FoldKit's Form on gpuix in a window, driven through
// gpuix's automation channel. Keystrokes go through GPUI's key dispatch and
// the editor's own actions; a person's physical keyboard isn't involved.
//
//   bun scripts/clipboard.ts      # macOS (pbcopy/pbpaste); Linux: wl-copy/wl-paste
//
// It saves the clipboard first and puts it back after.

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const linux = process.platform === 'linux'
const readClipboard = () => spawnSync(linux ? 'wl-paste' : 'pbpaste', linux ? ['--no-newline'] : [], { encoding: 'utf8' }).stdout
const writeClipboard = (text: string) => spawnSync(linux ? 'wl-copy' : 'pbcopy', [], { input: text })

type Automation = Awaited<ReturnType<typeof import('@gpuix/native/automation')['launch']>>
const painted = async (app: Automation) => ((await app.call('getPaintedText', {})) as { text: Array<string> }).text
/** Until a painted frame has a line that is exactly `text`. */
const paints = async (app: Automation, text: string, timeoutMs = 5000) => {
  const until = performance.now() + timeoutMs
  while (!(await painted(app)).includes(text)) {
    if (performance.now() > until) return false
    await new Promise(done => setTimeout(done, 20))
  }
  return true
}

const saved = readClipboard()
const results: Array<{ step: string; ok: boolean; detail?: string }> = []
const check = (step: string, ok: boolean, detail?: string) => {
  results.push({ step, ok, ...(detail === undefined ? {} : { detail }) })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${step}${detail === undefined ? '' : `: ${detail}`}`)
}

const { launch } = await import('@gpuix/native/automation')
const app = await launch({
  command: process.execPath, args: ['examples/open.ts', 'form'], cwd: root,
  env: { ...process.env, FOLDKIT_NATIVE_RENDERER: 'gpuix' },
})
try {
  if (!(await paints(app, 'Join Our Waitlist', 15_000))) throw new Error('the Form never painted')
  const [name] = await app.getByType('input').all()
  const box = name?.bounds
  if (box === undefined) throw new Error('no painted input')
  await app.call('click', { x: box.x + box.width / 2, y: box.y + box.height / 2 })

  // Another app's copy, pasted into GPUI's editor.
  writeClipboard('from the system')
  await app.call('keystrokes', { keys: 'cmd-v' })
  check('paste from the system clipboard', await paints(app, 'from the system'))

  // Typed, then copied out to the system clipboard.
  await app.call('keystrokes', { keys: 'space x' })
  check('typing after the paste', await paints(app, 'from the system x'))
  await app.call('keystrokes', { keys: 'cmd-a cmd-c' })
  await new Promise(done => setTimeout(done, 200))
  const copied = readClipboard()
  check('copy to the system clipboard', copied === 'from the system x', JSON.stringify(copied))

  // Undo and redo the typed " x".
  // GPUI undoes the "x" and the space as separate steps (a browser usually
  // undoes a typed run at once), so either is an undo.
  await app.call('keystrokes', { keys: 'cmd-z' })
  await new Promise(done => setTimeout(done, 200))
  const undone = (await painted(app)).filter(line => line.startsWith('from the system'))
  check('undo', undone.length === 1 && ['from the system ', 'from the system'].includes(undone[0]!), JSON.stringify(undone))
  await app.call('keystrokes', { keys: 'cmd-shift-z' })
  check('redo', await paints(app, 'from the system x'))

  // Cut: the field empties, the clipboard has it.
  writeClipboard('')
  await app.call('keystrokes', { keys: 'cmd-a cmd-x' })
  await new Promise(done => setTimeout(done, 200))
  const cut = readClipboard()
  check('cut to the system clipboard', cut === 'from the system x' && !(await painted(app)).includes('from the system x'), JSON.stringify(cut))
} finally {
  await app.close()
  writeClipboard(saved)
}
console.log(JSON.stringify({ platform: process.platform, results }))
process.exit(results.every(result => result.ok) ? 0 : 1)
