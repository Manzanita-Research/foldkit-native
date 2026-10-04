// The global `document`. FoldKit apps can name it at module scope, before any
// window exists (snake's keyboard Subscription is `target: document`), and a
// process can open window after window: the `document` an app kept must stay
// the one the newest window draws.
import { afterEach, expect, test } from 'bun:test'

import { installDom } from '../src/dom.ts'
import { type Mounted, mountFake } from './support/mount.ts'

// What an app module keeps when it loads.
const kept = globalThis.document

const windows: Array<ReturnType<typeof installDom>> = []
let mounted: Mounted | undefined
afterEach(async () => {
  await mounted?.close()
  mounted = undefined
  for (const window of windows.splice(0)) {
    await window.happyDOM.abort()
    window.close()
  }
})

test('document is defined before any window, and is the same object after one', () => {
  expect(kept).toBeDefined()
  const window = installDom()
  windows.push(window)
  expect(globalThis.document).toBe(kept)
  expect(kept.body).toBe(window.document.body as unknown as HTMLElement)
  // happy-dom's document is an HTMLDocument (not `instanceof window.Document`).
  expect(kept).toBeInstanceOf(window.HTMLDocument as unknown as typeof Document)
})

test('a listener on the kept document hears the newest window', () => {
  windows.push(installDom())
  const newest = installDom()
  windows.push(newest)
  const keys: Array<string> = []
  kept.addEventListener('keydown', event => keys.push((event as KeyboardEvent).key))
  newest.document.body.dispatchEvent(new newest.KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }))
  expect(keys).toEqual(['ArrowUp'])
  expect(kept.createElement('p').ownerDocument).toBe(newest.document as unknown as Document)
})

test('setting a property sets it on the newest window', () => {
  const window = installDom()
  windows.push(window)
  kept.title = 'Snake | 0 pts'
  expect(window.document.title).toBe('Snake | 0 pts')
})

test('kept before attachDom, listened to after: the mirror sees the real document, and GPUI window keys reach it', () => {
  mounted = mountFake()
  // The mirror wraps addEventListener to learn what each node listens for.
  // Through the kept document, that wrapper must run with the real document.
  let proto = Object.getPrototypeOf(mounted.document.body)
  while (!Object.prototype.hasOwnProperty.call(proto, 'addEventListener')) proto = Object.getPrototypeOf(proto)
  const tracked = proto.addEventListener
  const seen: Array<[unknown, string]> = []
  proto.addEventListener = function (this: unknown, type: string, ...rest: Array<unknown>) {
    seen.push([this, type])
    return tracked.call(this, type, ...rest)
  }
  const keys: Array<string> = []
  try {
    kept.addEventListener('keydown', event => keys.push((event as KeyboardEvent).key))
  } finally {
    proto.addEventListener = tracked
  }
  expect(seen).toEqual([[mounted.document, 'keydown']])

  // A GPUI window key goes to <body> and bubbles up to the document.
  mounted.mirror.windowKey({ eventType: 'keyDown', key: 'up' } as never)
  expect(keys).toEqual(['ArrowUp'])
})

test('the element classes FoldKit checks with instanceof are globals', () => {
  const window = installDom()
  windows.push(window)
  // @foldkit/ui's Dialog opens with `element instanceof HTMLDialogElement`;
  // FoldKit's Canvas checks HTMLCanvasElement.
  expect(kept.createElement('dialog')).toBeInstanceOf(globalThis.HTMLDialogElement)
  expect(kept.createElement('canvas')).toBeInstanceOf(globalThis.HTMLCanvasElement)
})
