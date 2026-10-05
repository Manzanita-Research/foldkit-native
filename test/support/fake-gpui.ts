// A stand-in for GPUI's retained tree: it applies the mutation batches gpuix's
// queue sends to `applyBatch`, with the semantics the real tree has (checked
// against gpuix's Metal TestRenderer): `setStyle` replaces the whole style,
// `appendChild` moves an attached child, and `destroyElement` frees the subtree
// and reports every freed id. No GPU, so it runs anywhere.

import type { NativeRenderer } from '@gpuix/native/host'

/** As gpuix's: how far along its axis an alignment puts the content. */
const alignment = (value: unknown) =>
  value === 'center' || value === 'space-around' ? 0.5 : value === 'flex-end' || value === 'end' ? 1 : 0

export type FakeNode = {
  id: number
  type: string
  parent: number | undefined
  children: Array<number>
  text: string | undefined
  style: Record<string, unknown>
  props: Record<string, unknown>
  listeners: Set<string>
}

/** The native tree as plain data, for `toEqual`: type, text, children. */
export type Shape = { type: string; text?: string; children?: Array<Shape> }

export const createFakeGpui = () => {
  const nodes = new Map<number, FakeNode>()
  const batches: Array<Array<[string, ...Array<unknown>]>> = []
  let root: number | undefined
  const bounds = new Map<number, { x: number; y: number; width: number; height: number }>()
  /** Scroll offsets, gpuix's way: negative when scrolled down or right. */
  const offsets = new Map<number, [number, number]>()
  const scrollCalls: Array<{ id: number; x: number; y: number }> = []
  /** A virtual list's anchor (its top row, and how far into it), as GPUI's
   *  scrollToItem sets it, clamped to its rows; the viewport's height from
   *  setBounds. */
  const anchors = new Map<number, [number, number]>()
  const itemScrolls: Array<{ id: number; index: number; offset: number }> = []

  const node = (id: number) => {
    const found = nodes.get(id)
    if (found === undefined) throw new Error(`fake gpui: no element ${id}`)
    return found
  }
  const detach = (id: number) => {
    const child = node(id)
    if (child.parent === undefined) return
    const siblings = node(child.parent).children
    siblings.splice(siblings.indexOf(id), 1)
    child.parent = undefined
  }
  const destroy = (id: number, freed: Array<number>) => {
    const gone = node(id)
    freed.push(id)
    for (const child of gone.children) destroy(child, freed)
    nodes.delete(id)
  }

  /** Whether GPUI scrolls the element (gpuix: `overflow: scroll`). */
  const scrolls = (id: number) => {
    const style = nodes.get(id)?.style ?? {}
    return style['overflowX'] === 'scroll' || style['overflowY'] === 'scroll'
  }
  /** As gpuix reports bounds: from the content corner (moved by the left/top
   *  border and padding), without the borders in the size, and a scroll
   *  area's own box moved by its own scroll offset (checked on Metal by
   *  packages/foldkit-gpuix/test/contract.test.ts). */
  const reported = (id: number) => {
    const box = bounds.get(id)
    if (box === undefined) return null
    const style = (nodes.get(id)?.style ?? {}) as Record<string, number | undefined>
    const [left, top, right, bottom] = ['Left', 'Top', 'Right', 'Bottom'].map(side => style[`border${side}Width`] ?? 0) as [number, number, number, number]
    const [scrollX, scrollY] = scrolls(id) ? offsets.get(id) ?? [0, 0] : [0, 0]
    // The corner moves back as the content is aligned (half the padding
    // when centred, all of it at the end); a single-line input centres its
    // editor vertically.
    const along = style as Record<string, unknown>
    const column = along['flexDirection'] === 'column' || along['flexDirection'] === 'column-reverse'
    const alongX = alignment(column ? along['alignItems'] : along['justifyContent'])
    const alongY = nodes.get(id)?.type === 'input' ? 0.5 : alignment(column ? along['justifyContent'] : along['alignItems'])
    const [padLeft, padRight, padTop, padBottom] = ['Left', 'Right', 'Top', 'Bottom'].map(side => style[`padding${side}`] ?? 0) as [number, number, number, number]
    return {
      x: box.x + left + padLeft - alongX * (padLeft + padRight) + scrollX,
      y: box.y + top + padTop - alongY * (padTop + padBottom) + scrollY,
      width: box.width - left - right,
      height: box.height - top - bottom,
    }
  }
  /** How far GPUI lets an element scroll: its children's extent past its own
   *  box, where both are known (setBounds); unbounded otherwise. */
  const scrollRange = (id: number): [number, number] => {
    const own = bounds.get(id)
    const boxes = (nodes.get(id)?.children ?? []).map(child => bounds.get(child)).filter(box => box !== undefined)
    if (own === undefined || boxes.length === 0) return [-Infinity, -Infinity]
    const right = Math.max(...boxes.map(box => box.x + box.width)) - own.x
    const bottom = Math.max(...boxes.map(box => box.y + box.height)) - own.y
    return [-Math.max(0, right - own.width), -Math.max(0, bottom - own.height)]
  }
  let treeReads = 0
  type TreeNode = { id: number; type: string; bounds?: { x: number; y: number; width: number; height: number }; children?: Array<TreeNode> }
  const automation = (id: number): TreeNode => {
    const box = reported(id)
    const { type, children } = node(id)
    return { id, type, ...(box === null ? {} : { bounds: box }), ...(children.length === 0 ? {} : { children: children.map(automation) }) }
  }
  const renderer: NativeRenderer & { getAutomationTree: () => string } = {
    applyBatch: (json: string) => {
      const ops = JSON.parse(json) as Array<[string, ...Array<unknown>]>
      batches.push(ops)
      const freed: Array<number> = []
      for (const [op, ...args] of ops) {
        const id = args[0] as number
        switch (op) {
          case 'createElement':
            if (nodes.has(id)) throw new Error(`fake gpui: element ${id} created twice`)
            nodes.set(id, { id, type: args[1] as string, parent: undefined, children: [], text: undefined, style: {}, props: {}, listeners: new Set() })
            break
          case 'appendChild': case 'insertBefore': {
            const childId = args[1] as number
            detach(childId)
            const siblings = node(id).children
            const before = op === 'insertBefore' ? siblings.indexOf(args[2] as number) : -1
            siblings.splice(before === -1 ? siblings.length : before, 0, childId)
            node(childId).parent = id
            break
          }
          case 'destroyElement':
            detach(id)
            destroy(id, freed)
            break
          case 'setText': node(id).text = args[1] as string; break
          case 'setStyle': node(id).style = args[1] as Record<string, unknown>; break
          case 'setCustomProp': node(id).props[args[1] as string] = args[2]; break
          case 'setEventListener':
            if (args[2]) node(id).listeners.add(args[1] as string)
            else node(id).listeners.delete(args[1] as string)
            break
          case 'setRoot': root = id; break
          default: throw new Error(`fake gpui: unknown op ${op}`)
        }
      }
      return freed
    },
    getElementBounds: (id: number) => reported(id),
    /** gpuix's tree JSON with last-paint bounds (what its automation reads),
     *  reported the same way. */
    getAutomationTree: () => {
      treeReads++
      return JSON.stringify(root === undefined ? null : automation(root))
    },
    /** null for an element GPUI doesn't scroll, [0, 0] for one at rest. */
    getScrollOffset: (id: number) => offsets.get(id) ?? (scrolls(id) ? [0, 0] : null),
    /** Clamped as GPUI clamps: never past the top, never past the end. */
    scrollTo: (id: number, x: number, y: number) => {
      scrollCalls.push({ id, x, y })
      const [minX, minY] = scrollRange(id)
      offsets.set(id, [Math.min(0, Math.max(minX, x)), Math.min(0, Math.max(minY, y))])
    },
    setWindowKeyEvents: () => {},
    scrollToItem: (id: number, index: number, offset?: number | null) => {
      itemScrolls.push({ id, index, offset: offset ?? 0 })
      const count = Number(node(id).props['itemCount'] ?? 0)
      anchors.set(id, [Math.max(0, Math.min(count - 1, index)), offset ?? 0])
    },
    getListScrollTop: (id: number) => (nodes.get(id)?.type === 'virtual-list' ? [...(anchors.get(id) ?? [0, 0]), bounds.get(id)?.height ?? 0] : null),
  } as NativeRenderer & { getAutomationTree: () => string }

  const shape = (id: number): Shape => {
    const { type, text, children } = node(id)
    return {
      type,
      ...(text === undefined ? {} : { text }),
      ...(children.length === 0 ? {} : { children: children.map(shape) }),
    }
  }
  const reachable = (id: number): number => 1 + node(id).children.reduce((sum, child) => sum + reachable(child), 0)

  return {
    renderer,
    node,
    /** The tree under the root, as plain data. */
    tree: () => (root === undefined ? undefined : shape(root)),
    /** Every element alive, reachable or not; more than `reachableCount` is a leak. */
    retainedCount: () => nodes.size,
    reachableCount: () => (root === undefined ? 0 : reachable(root)),
    /** Every op sent, batch by batch. */
    batches,
    ops: () => batches.flat(),
    /** Where "GPUI painted" an element (its border box), for hit tests. */
    setBounds: (id: number, box: { x: number; y: number; width: number; height: number }) => bounds.set(id, box),
    /** How many times the whole tree's bounds were read (getAutomationTree). */
    treeReads: () => treeReads,
    /** Scrolls an element "in GPUI", as a wheel would: gpuix's negative offsets. */
    setScrollOffset: (id: number, x: number, y: number) => offsets.set(id, [x, y]),
    /** Every `scrollTo` the mirror asked GPUI for. */
    scrollCalls,
    /** Every scrollToItem a virtual list was asked for. */
    itemScrolls,
  }
}

export type FakeGpui = ReturnType<typeof createFakeGpui>
