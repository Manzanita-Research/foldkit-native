// What an example is, and how to find them. Each example is a folder in
// examples/ with an `app.ts` that exports `meta` and `start`; the gallery, the
// launcher and the tests all find examples this way, so adding one never
// touches a shared list.

import type { WindowOptions } from '@gpuix/native'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

// FoldKit Native's `document` global, before any app.ts loads: an app may name
// it at module scope, as on the web (see src/dom.ts).
import '../../src/dom.ts'

export type ExampleMeta = Readonly<{
  title: string
  /** One line: what the app is. */
  blurb: string
  /** What it shows from FoldKit (the app side). */
  foldkit: string
  /** What it shows from GPUI (the drawing side). */
  gpui: string
  /** Where the code came from, for ports: FoldKit's example folder. */
  source?: string
  /** Window size in logical pixels. */
  width: number
  height: number
  /** What draws it: the DOM mirror (the default), or FoldKit on gpuix
   *  (packages/foldkit-gpuix), which has no DOM engine. */
  renderer?: 'mirror' | 'gpuix'
  /** More of gpuix's window options, on FoldKit on gpuix: a layer-shell
   *  surface (Layer bar's), a fixed size. Width and height above still count. */
  window?: WindowOptions
}>

export type ExampleApp = Readonly<{
  meta: ExampleMeta
  /** Runs the app in a container: FoldKit's entry.ts, with the container passed in. */
  start: (container: HTMLElement) => void
  /** CSS from the libraries the app uses (a UI library's), before its own. */
  libraryCss?: string
}>

export const EXAMPLES_DIR = resolve(import.meta.dir, '..')

/** One gallery entry: what to show, and the command that opens it. */
export type Entry = Readonly<{ id: string; meta: ExampleMeta; command: ReadonlyArray<string> }>

/** The two demos from before the gallery: single files that open their own
 *  window (the window tests launch them as they are). */
const SCRIPTS: ReadonlyArray<Entry> = [
  {
    id: 'counter',
    command: ['examples/counter.ts'],
    meta: {
      title: 'Counter', blurb: 'The smallest FoldKit app, drawn natively.',
      foldkit: 'Model, Messages and update; only the setup import is native-specific',
      gpui: 'Buttons with hover and pressed states', width: 720, height: 420,
    },
  },
  {
    id: 'themes',
    command: ['examples/themes.ts'],
    meta: {
      title: 'Themes', blurb: 'Two token sets, switched while the app runs.',
      foldkit: 'A view written against semantic tokens and parts',
      gpui: 'Restyling the whole tree live, shadows and rounded surfaces', width: 640, height: 480,
    },
  },
]

/** Every example, folder examples first, as the gallery lists them. */
export const entries = async (): Promise<ReadonlyArray<Entry>> => {
  const folders: Array<Entry> = []
  for (const id of exampleIds()) {
    const { meta } = (await import(join(EXAMPLES_DIR, id, 'app.ts'))) as ExampleApp
    folders.push({ id, meta, command: ['examples/open.ts', id] })
  }
  return [...folders, ...SCRIPTS]
}

/** Every example folder (one with an app.ts), sorted by name. */
export const exampleIds = (): Array<string> =>
  readdirSync(EXAMPLES_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && existsSync(join(EXAMPLES_DIR, entry.name, 'app.ts')))
    .map(entry => entry.name)
    .sort()

export const loadExample = async (id: string): Promise<ExampleApp & { id: string; css: string }> => {
  if (!exampleIds().includes(id)) {
    throw new Error(`no example "${id}". Examples: ${exampleIds().join(', ')}`)
  }
  const app = (await import(join(EXAMPLES_DIR, id, 'app.ts'))) as ExampleApp
  return { ...app, id, css: (app.libraryCss ?? '') + exampleCss(id) }
}

/** The example's CSS as the mirror reads it (`bun run css` generates it). */
export const exampleCss = (id: string): string => {
  const file = join(EXAMPLES_DIR, id, 'styles.native.css')
  return existsSync(file) ? readFileSync(file, 'utf8') : ''
}
