// The mirror without a screen: a real FoldKit app in happy-dom, a recording
// mutation queue instead of GPUI, and a click delivered the way gpuix does.
import { expect, test } from 'bun:test'

import { installDom } from '../src/dom.ts'

test('FoldKit DOM → native mutations, native click → FoldKit update', async () => {
  const window = installDom()
  const style = document.createElement('style')
  style.textContent = '.count { color: #fff3ff; font-size: 24px; } .button { cursor: pointer; }'
  document.head.appendChild(style)

  const { createMirror } = await import('../src/mirror.ts')
  const ops: Array<Array<unknown>> = []
  const queue = new Proxy({ pending: 0, flushMutations: () => {} } as Record<string, unknown>, {
    get: (target, key) => key in target ? target[key as string] : (...args: Array<unknown>) => ops.push([key, ...args]),
  })
  const handlers = new Map()
  const mirror = createMirror({ window, mutations: queue as never, eventHandlers: handlers })
  mirror.refreshStyles()

  const container = document.createElement('div')
  container.id = 'app'
  document.body.appendChild(container)

  const { Schema } = await import('effect')
  const { Runtime } = await import('foldkit')
  const { defineMessageUnion } = await import('foldkit/message')
  const Message = defineMessageUnion({ Clicked: {} })
  Runtime.run(Runtime.makeElement({
    Model: Schema.Struct({ count: Schema.Number }),
    init: () => ({ model: { count: 0 } }),
    update: (model: { count: number }) => ({ model: { count: model.count + 1 } }),
    view: (model: { count: number }, h: any) =>
      h.div([], [h.p([h.Class('count')], [`Count: ${model.count}`]), h.button([h.Class('button'), h.OnClick(Message.Clicked())], ['+1'])]),
    container: container as never,
  }))
  await new Promise(resolve => setTimeout(resolve, 100))

  const texts = () => ops.filter(op => op[0] === 'setText').map(op => op[2])
  expect(texts()).toContain('Count: 0')
  // Inherited text style reaches the text node (GPUI text doesn't inherit).
  const countStyle = ops.find(op => op[0] === 'setStyle' && (op[2] as { color?: string }).color === '#fff3ff')
  expect(countStyle).toBeDefined()

  // The button's listener became a native click listener…
  const listen = ops.find(op => op[0] === 'setEventListener' && op[2] === 'click' && op[3] === true)
  expect(listen).toBeDefined()
  const buttonId = listen![1] as number
  // …and a native click on it runs FoldKit's update and patches the text.
  // gpuix's handler map: element id → event type → handler.
  const handler = (handlers as Map<number, Map<string, (event: unknown) => void>>).get(buttonId)?.get('click')
  expect(handler).toBeDefined()
  handler!({ elementId: buttonId, eventType: 'click', x: 1, y: 1, button: 0, clickCount: 1 })
  await new Promise(resolve => setTimeout(resolve, 100))
  expect(texts()).toContain('Count: 1')
})
