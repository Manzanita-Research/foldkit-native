// Theming without a screen: token changes restyle the native tree.
import { expect, test } from 'bun:test'

import { installDom } from '../src/dom.ts'

test('semantic tokens resolve at render time and switch without a restart', async () => {
  const window = installDom()
  const { setTokens, token } = await import('../src/theme.ts')
  const { createMirror } = await import('../src/mirror.ts')
  setTokens(document, { 'color.surface': '#111111', 'radius.2': 8 })
  const style = document.createElement('style')
  style.textContent = `[data-part="card"] { background-color: ${token('color.surface')}; border-top-left-radius: ${token('radius.2')}; }
    [data-part="card"]:hover { background-color: #222222; } [data-part="card"]:active { background-color: #333333; }`
  document.head.appendChild(style)

  const ops: Array<Array<unknown>> = []
  const queue = new Proxy({ pending: 0, flushMutations: () => {} } as Record<string, unknown>, {
    get: (target, key) => key in target ? target[key as string] : (...args: Array<unknown>) => ops.push([key, ...args]),
  })
  const mirror = createMirror({ window, mutations: queue as never, eventHandlers: new Map() })
  const card = document.createElement('div')
  card.setAttribute('data-part', 'card')
  document.body.appendChild(card)
  mirror.refreshStyles()
  await new Promise(resolve => setTimeout(resolve, 20))

  const lastCardStyle = () => {
    const id = mirror.idFor(card as unknown as Node)
    return ops.filter(op => op[0] === 'setStyle' && op[1] === id).at(-1)?.[2] as Record<string, unknown>
  }
  expect(lastCardStyle()['backgroundColor']).toBe('#111111')
  expect(lastCardStyle()['borderTopLeftRadius']).toBe(8)
  // Interaction states become GPUI state styles.
  expect((lastCardStyle()['hover'] as Record<string, unknown>)['backgroundColor']).toBe('#222222')
  expect((lastCardStyle()['active'] as Record<string, unknown>)['backgroundColor']).toBe('#333333')

  setTokens(document, { 'color.surface': '#eeeeee', 'radius.2': 2 })
  await new Promise(resolve => setTimeout(resolve, 20))
  expect(lastCardStyle()['backgroundColor']).toBe('#eeeeee')
  expect(lastCardStyle()['borderTopLeftRadius']).toBe(2)
})
