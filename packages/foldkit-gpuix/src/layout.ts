// LAYOUT, READ BACK
//
// Where GPUI last painted things answers getBoundingClientRect,
// document.elementsFromPoint, scrollIntoView and the host's click-outside
// test. Three costs shape how it's read:
// - gpuix's automation tree has every element's box in one call, where
//   `getElementBounds` has one (on Linux, a round trip each: see below).
// - On Linux, every geometry query (bounds, the automation tree, scroll
//   offsets, the window's size) is a round trip to GPUI's UI thread, which
//   waits up to 2 s when the window isn't painting (hidden, minimised, behind
//   a lock screen). On macOS they're answered in place.
// - The automation tree asks GPUI to draw again, and gpuix 0.10's published
//   build (made with GPUI's test-support) draws the whole window right there,
//   inside the call: 35 ms for Pixel Art's 2,200 elements on an M1 Pro, 75 ms
//   with its six history previews (8,300). `getElementBounds`
//   reads the same last painted boxes without drawing (2.6 ms for all 2,200).
//   So where bounds are answered in place (`bounds`), the tree is read only
//   when its shape changed (`reshaped`); otherwise each box is read again
//   from the last painted frame, through the shape the last tree read gave.
//
// The layout is read on demand, at most once per frame GPUI draws, and only
// in the frames after something could have moved (a change, a scroll, a
// resize), or once it's half a second old (GPUI can move things the host
// doesn't see: an image arriving, a native animation). Every query goes through a guard (`createGuard`) that times it.
// Nothing here ever waits for GPUI to paint: until a read succeeds, answers
// come from the last layout GPUI gave (README: what each API returns then).

export type Box = { x: number; y: number; width: number; height: number }

/** gpuix's automation tree: each element's last painted box, in paint order. */
type TreeNode = { id: number; type?: string; bounds?: Box; children?: Array<TreeNode> }

/** A slow query (over a quarter of a 60 Hz frame) spaces out the next one of
 *  its kind, so that queries take at most a quarter of the time. */
const SLOW_MS = 4
const SPACING = 3
/** After a query fails (gpuix's 2 s timeout), no query is made for a while:
 *  three times what the miss cost (6 s after a 2 s timeout), at least 1 s,
 *  doubling to 30 s. A retry also waits for input (someone's using the
 *  window, so it's likely painting), or for the longest back-off to pass. */
export const BACKOFF = { firstMs: 1000, maxMs: 30_000 }

export type GuardStats = { queries: number; misses: number; ms: number; skipped: number }

/** Times GPUI's geometry queries and stops asking when GPUI stops answering. */
export const createGuard = (now: () => number = () => performance.now()) => {
  let resumeAt = -Infinity
  let backoff = 0
  let missedAt: number | undefined
  let inputAt = -Infinity
  const spacedUntil = new Map<string, number>()
  const stats: GuardStats = { queries: 0, misses: 0, ms: 0, skipped: 0 }
  const open = (kind: string) => {
    const at = now()
    if (at < (spacedUntil.get(kind) ?? -Infinity)) return false
    if (missedAt === undefined) return true
    return at >= resumeAt && (inputAt > missedAt || at - missedAt >= BACKOFF.maxMs)
  }
  return {
    stats,
    /** Whether a query of this kind would be made now. */
    open,
    /** Runs `query` unless GPUI's not answering; `undefined` if it wasn't
     *  run or failed. */
    ask: <T>(kind: string, query: () => T): T | undefined => {
      if (!open(kind)) {
        stats.skipped++
        return undefined
      }
      const started = now()
      stats.queries++
      try {
        const value = query()
        const ended = now()
        stats.ms += ended - started
        if (ended - started > SLOW_MS) spacedUntil.set(kind, ended + (ended - started) * SPACING)
        missedAt = undefined
        backoff = 0
        return value
      } catch {
        const ended = now()
        stats.ms += ended - started
        stats.misses++
        missedAt = ended
        backoff = Math.min(BACKOFF.maxMs, Math.max(BACKOFF.firstMs, (ended - started) * SPACING, backoff * 2))
        resumeAt = ended + backoff
        return undefined
      }
    },
    /** GPUI delivered input: the window's in use, so worth asking again. */
    input: () => {
      inputAt = now()
    },
    /** Whether the last query failed and queries are on hold. */
    get holding() {
      return missedAt !== undefined
    },
  }
}
export type Guard = ReturnType<typeof createGuard>

/** One painted element: its border box, the box its ancestors clip it to
 *  (null: unclipped), and which ancestors those are. */
type Painted = { id: number; box: Box; clip: Box | null; clippers: ReadonlyArray<number> }

/** A layout this old is read again when asked for, moved or not. */
export const MAX_AGE_MS = 500

export type LayoutOptions = {
  guard: Guard
  now?: () => number
  /** gpuix's automation tree, as JSON. */
  tree: (() => string) | undefined
  /** One element's last painted box, read in place without a redraw (gpuix's
   *  `getElementBounds` in macOS's live window); null if it wasn't painted.
   *  Without it every read is a tree read. */
  bounds?: (id: number) => Box | null
  /** gpuix's box for an element → its border box (host.ts undoes gpuix's
   *  content-corner boxes and a scroll area's own scroll offset). */
  borderBox: (id: number, box: Box) => Box
  /** Whether the element clips what's inside it (overflow other than visible). */
  clips: (id: number) => boolean
}

const intersect = (a: Box | null, b: Box): Box => {
  if (a === null) return b
  const x = Math.max(a.x, b.x)
  const y = Math.max(a.y, b.y)
  return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) }
}
const contains = (box: Box, x: number, y: number) => x >= box.x && x < box.x + box.width && y >= box.y && y < box.y + box.height

export const createLayout = (options: LayoutOptions) => {
  const { guard } = options
  const now = options.now ?? (() => performance.now())
  let readAt = -Infinity
  let painted: Array<Painted> = []
  let boxes = new Map<number, Box>()
  /** Each painted element's parent in GPUI's tree. */
  let parents = new Map<number, number>()
  /** Frames GPUI has drawn (`drew`), the frame of the last read, and the last
   *  frame whose layout may differ from what was read. */
  let frame = 0
  let readFrame = 0
  let staleThrough = 0
  let reads = 0
  /** The tree's shape at the last tree read (each node's box as it was then),
   *  and whether GPUI's tree has changed shape since. */
  let shape: TreeNode | null | undefined
  let reshaped = true

  /** The tree with each box as GPUI last painted it: the tree itself, or,
   *  while its shape holds, each box read again through the last shape. */
  const fetch = (): { root: TreeNode | null; boxOf: (node: TreeNode) => Box | undefined } | undefined => {
    const { tree, bounds } = options
    if (bounds !== undefined && !reshaped && shape !== undefined) {
      const known = shape
      const fresh = guard.ask('bounds', () => {
        const out = new Map<number, Box>()
        const visit = (node: TreeNode) => {
          const box = bounds(node.id)
          if (box !== null) out.set(node.id, box)
          for (const child of node.children ?? []) visit(child)
        }
        if (known !== null) visit(known)
        return out
      })
      return fresh === undefined ? undefined : { root: known, boxOf: node => fresh.get(node.id) }
    }
    if (tree === undefined) return undefined
    // Changes from here on are after this read.
    const was = reshaped
    reshaped = false
    const json = guard.ask('tree', tree)
    if (json === undefined) {
      reshaped = was
      return undefined
    }
    shape = JSON.parse(json) as TreeNode | null
    return { root: shape, boxOf: node => node.bounds }
  }

  const read = () => {
    const fetched = fetch()
    if (fetched === undefined) return
    const { root, boxOf } = fetched
    readFrame = frame
    readAt = now()
    reads++
    const order: Array<Painted> = []
    const byId = new Map<number, Box>()
    const parentOf = new Map<number, number>()
    // GPUI paints an anchored element after everything else, unclipped.
    const deferred: Array<TreeNode> = []
    const walk = (node: TreeNode, clip: Box | null, clippers: ReadonlyArray<number>, top: boolean) => {
      if (node.type === 'anchored' && !top) {
        deferred.push(node)
        return
      }
      const painted = boxOf(node)
      const box = painted === undefined ? null : options.borderBox(node.id, painted)
      if (box !== null) {
        order.push({ id: node.id, box, clip, clippers })
        byId.set(node.id, box)
      }
      const clipping = box !== null && options.clips(node.id)
      const inner = clipping ? intersect(clip, box) : clip
      const within = clipping ? [...clippers, node.id] : clippers
      for (const child of node.children ?? []) {
        parentOf.set(child.id, node.id)
        walk(child, inner, within, false)
      }
    }
    if (root !== null) walk(root, null, [], true)
    for (let at = 0; at < deferred.length; at++) walk(deferred[at]!, null, [], true)
    painted = order
    boxes = byId
    parents = parentOf
  }
  /** The layout as GPUI last painted it: read now if it may have changed
   *  since the last read and GPUI has drawn since (and is answering). */
  const current = () => {
    if (frame > readFrame && (readFrame <= staleThrough || now() - readAt >= MAX_AGE_MS)) read()
  }

  return {
    /** GPUI's tree changed shape (an element created, destroyed or moved):
     *  the next read is a tree read. */
    reshaped: () => {
      reshaped = true
    },
    /** Something may have moved: the layout is read again on demand over the
     *  next few frames (GPUI paints a change within one or two). */
    moved: () => {
      staleThrough = frame + 2
    },
    /** A scroll area moved its content by (dx, dy), and GPUI hasn't painted
     *  it yet: what's inside it is where it will be, at once, as a browser
     *  answers after a scroll. The next read replaces it with GPUI's. */
    scrolled: (area: number, dx: number, dy: number) => {
      if (dx === 0 && dy === 0) return
      const inside = (id: number) => {
        for (let at = parents.get(id); at !== undefined; at = parents.get(at)) if (at === area) return true
        return false
      }
      const moved = painted.filter(entry => inside(entry.id))
      for (const entry of moved) {
        entry.box = { ...entry.box, x: entry.box.x + dx, y: entry.box.y + dy }
        boxes.set(entry.id, entry.box)
      }
      for (const entry of moved) entry.clip = entry.clippers.reduce<Box | null>((clip, id) => intersect(clip, boxes.get(id)!), null)
    },
    /** GPUI drew a frame. */
    drew: () => {
      frame++
    },
    /** Whether something moved in the last few frames (the layout is still
     *  being read again). */
    get settling() {
      return frame <= staleThrough + 1
    },
    /** An element's border box where GPUI last painted it, or null if it
     *  wasn't in the last layout read. */
    box: (id: number): Box | null => {
      current()
      return boxes.get(id) ?? null
    },
    /** Every painted element under the point, topmost first: children over
     *  their parents, later siblings over earlier ones, anchored elements
     *  over everything, as GPUI paints them; nothing outside a clipping
     *  ancestor. */
    at: (x: number, y: number): Array<number> => {
      current()
      const out: Array<number> = []
      for (let at = painted.length - 1; at >= 0; at--) {
        const { id, box, clip } = painted[at]!
        if (contains(box, x, y) && (clip === null || contains(clip, x, y))) out.push(id)
      }
      return out
    },
    /** How many times the tree was read (tests). */
    get reads() {
      return reads
    },
  }
}
export type Layout = ReturnType<typeof createLayout>
