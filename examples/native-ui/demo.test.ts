// The recording walk-through on the fake GPUI tree: no native window or Metal.
import { describe, expect, test } from 'bun:test'

import { openHeadless } from '../support/harness.ts'
import { demo } from './demo.ts'

type Step = { method: string; params: Record<string, unknown> } | { pause: number }

const capture = async () => {
  const steps: Array<Step> = []
  // The demo only uses the automation client's call boundary.
  const client = {
    call: async (method: string, params: Record<string, unknown>) => {
      await Promise.resolve()
      steps.push({ method, params })
      return { ok: true }
    },
  } as unknown as Parameters<typeof demo>[0]
  await demo(client, async ms => { steps.push({ pause: ms }) })
  return steps
}

describe('headless recording demo', () => {
  test('releases each theme Space before its pause and preserves the rest of the walk-through', async () => {
    const steps = await capture()
    const calls = steps.filter(step => 'method' in step)
    const keys = (text: string) => [...text].map(letter => letter === ' ' ? 'space' : letter)
    expect(calls.filter(call => call.method === 'keystrokes').map(call => call.params.keys)).toEqual([
      'tab', 'tab', ...keys('Ada Lovelace'), 'tab', ...keys('ada@example.com'), 'tab',
      'tab', ...Array(7).fill('down'), 'enter', 'tab', 'enter', 'tab', 'tab', 'escape',
    ])
    expect(steps.filter(step => 'pause' in step).map(step => step.pause)).toEqual([
      900, 400, 300, ...Array(12).fill(90), 400, 300,
      ...Array(4).fill(90), 700, ...Array(11).fill(90), 500,
      500, 1100, 700, 400, ...Array(7).fill(260), 1000, 400, 900, 450, 450, 900,
    ])
    expect(calls.filter(call => call.method !== 'keystrokes')).toEqual([
      { method: 'keyDown', params: { key: 'space' } },
      { method: 'keyUp', params: { key: 'space' } },
      { method: 'keyDown', params: { key: 'space' } },
      { method: 'keyUp', params: { key: 'space' } },
    ])
    const firstPress = steps.findIndex(step => 'method' in step && step.method === 'keyDown')
    expect(steps.slice(firstPress, firstPress + 6)).toEqual([
      { method: 'keyDown', params: { key: 'space' } },
      { method: 'keyUp', params: { key: 'space' } },
      { pause: 1100 },
      { method: 'keyDown', params: { key: 'space' } },
      { method: 'keyUp', params: { key: 'space' } },
      { pause: 700 },
    ])
  })

  test('the actual recorded theme gestures show dark, light, then dark at their pauses', async () => {
    const steps = await capture()
    const tabs = steps.flatMap((step, index) =>
      'method' in step && step.method === 'keystrokes' && step.params.keys === 'tab' ? [index] : [])
    // Replay the actual switch segment, between reaching it and leaving it.
    const gestures = steps.slice(tabs[3]! + 1, tabs[4]!)
    const app = await openHeadless('native-ui')
    try {
      const control = app.document.getElementById('dark')!
      control.focus()
      const themes: Array<string | null> = []
      const backgrounds: Array<unknown> = []
      for (const step of gestures) {
        if ('pause' in step) {
          themes.push(control.getAttribute('aria-checked'))
          backgrounds.push(app.nativeOf(app.document.querySelector('[data-ui="root"]')!).style['backgroundColor'])
        } else {
          // Pinned gpuix keystrokes are down-only; never supply an implicit release.
          expect(['keystrokes', 'keyDown', 'keyUp']).toContain(step.method)
          const key = step.method === 'keystrokes' ? step.params.keys : step.params.key
          app.send(1, { eventType: step.method === 'keyUp' ? 'windowKeyUp' : 'windowKeyDown', key, modifiers: {} })
          await app.settle()
        }
      }
      expect(themes).toEqual(['true', 'false', 'true'])
      expect(backgrounds).toEqual(['#141318', '#f4f1ea', '#141318'])
    } finally {
      await app.close()
    }
  })

  test('down-only Space leaves the theme unchanged until released', async () => {
    const app = await openHeadless('native-ui')
    try {
      const control = app.document.getElementById('dark')!
      control.focus()
      expect(control.getAttribute('aria-checked')).toBe('true')
      for (const _ of [1, 2]) {
        app.send(1, { eventType: 'windowKeyDown', key: 'space', modifiers: {} })
        await app.settle()
        expect(control.getAttribute('aria-checked')).toBe('true')
      }
      app.send(1, { eventType: 'windowKeyUp', key: 'space', modifiers: {} })
      await app.settle()
      expect(control.getAttribute('aria-checked')).toBe('false')
      await app.key('space')
      expect(control.getAttribute('aria-checked')).toBe('true')
    } finally {
      await app.close()
    }
  })
})
