// A stand-in for GPUI's retained tree: it applies the mutation batches gpuix's
// queue sends to `applyBatch`, with the semantics the real tree has (checked
// against gpuix's Metal TestRenderer): `setStyle` replaces the whole style,
// `appendChild` moves an attached child, and `destroyElement` frees the subtree
// and reports every freed id. No GPU, so it runs anywhere.

import type { NativeRenderer } from '@gpuix/native/host'

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

  /** As gpuix reports bounds: from the content corner (moved by the left/top
   *  border and padding), without the borders in the size. */
  const reported = (id: number) => {
    const box = bounds.get(id)
    if (box === undefined) return null
    const style = (nodes.get(id)?.style ?? {}) as Record<string, number | undefined>
    const [left, top, right, bottom] = ['Left', 'Top', 'Right', 'Bottom'].map(side => style[`border${side}Width`] ?? 0) as [number, number, number, number]
    return {
      x: box.x + left + (style['paddingLeft'] ?? 0),
      y: box.y + top + (style['paddingTop'] ?? 0),
      width: box.width - left - right,
      height: box.height - top - bottom,
    }
  }
  let treeReads = 0
  type TreeNode = { id: number; bounds?: { x: number; y: number; width: number; height: number }; children?: Array<TreeNode> }
  const automation = (id: number): TreeNode => {
    const box = reported(id)
    const { children } = node(id)
    return { id, ...(box === null ? {} : { bounds: box }), ...(children.length === 0 ? {} : { children: children.map(automation) }) }
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
    getScrollOffset: (id: number) => offsets.get(id) ?? null,
    scrollTo: (id: number, x: number, y: number) => {
      scrollCalls.push({ id, x, y })
      offsets.set(id, [x, y])
    },
    setWindowKeyEvents: () => {},
  }

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
  }
}

export type FakeGpui = ReturnType<typeof createFakeGpui>
