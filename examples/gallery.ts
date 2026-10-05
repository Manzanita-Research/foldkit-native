// The examples gallery.
//
//   bun run gallery           a window listing every example; click one to open it
//   bun run gallery --list    the same list in the terminal
//
// Each example opens as its own process and window (`bun run example <name>`).

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { entries } from './support/example.ts'

const listed = await entries()

if (process.argv.includes('--list')) {
  const width = Math.max(...listed.map(entry => entry.id.length))
  for (const entry of listed) {
    console.log(`${entry.id.padEnd(width)}  ${entry.meta.title}: ${entry.meta.blurb}`)
    console.log(`${''.padEnd(width)}  FoldKit: ${entry.meta.foldkit}`)
    console.log(`${''.padEnd(width)}  GPUI:    ${entry.meta.gpui}`)
  }
  console.log('\nOpen one with: bun run example <name>')
  process.exit(0)
}

const { Runtime } = await import('foldkit')
const Gallery = await import('./gallery/main.ts')

const root = resolve(import.meta.dir, '..')
const children = new Set<ReturnType<typeof Bun.spawn>>()
Gallery.setLauncher(command => {
  const child = Bun.spawn([process.execPath, ...command], { cwd: root, stdio: ['ignore', 'inherit', 'inherit'] })
  children.add(child)
  void child.exited.then(() => children.delete(child))
})
process.on('exit', () => {
  for (const child of children) child.kill()
})

const window = {
  title: 'FoldKit Native examples',
  width: 960,
  height: 760,
  appId: 'foldkit-native-gallery',
  css: readFileSync(resolve(import.meta.dir, 'gallery/styles.native.css'), 'utf8'),
}
// FoldKit on gpuix, as the examples are, unless FOLDKIT_NATIVE_RENDERER=mirror.
const native = process.env['FOLDKIT_NATIVE_RENDERER'] === 'mirror'
  ? (await import('../src/index.ts')).mountNative(window)
  : (await import('foldkit-gpuix')).mountGpuix(window)
Runtime.run(Runtime.makeElement({
  Model: Gallery.Model,
  init: Gallery.init(listed.map(entry => ({
    id: entry.id,
    title: entry.meta.title,
    blurb: entry.meta.blurb,
    foldkit: entry.meta.foldkit,
    gpui: entry.meta.gpui,
    ported: entry.meta.source !== undefined,
    command: [...entry.command],
  }))),
  update: Gallery.update,
  view: Gallery.view,
  container: native.container,
}))
