// Compare the same example's initial text on the mirror and the adapter.
// Per-example native tests own interactions; this suite owns agreement across
// renderers for the complete text, including repeated labels.
import { describe, expect, test } from 'bun:test'

import { mirrorHeadless } from '../../../examples/support/harness.ts'
import { exampleIds, loadExample } from '../../../examples/support/example.ts'
import { mountHeadless } from './support.ts'

const onAdapter = async (id: string) => {
  const example = await loadExample(id)
  const app = mountHeadless({
    css: example.css, viewport: { width: example.meta.width, height: example.meta.height },
  })
  example.start(app.container)
  await app.settle()
  await app.settle()
  return app
}

describe('mirror vs FoldKit on gpuix, same apps', () => {
  test('first render, every example', async () => {
    const fetch = globalThis.fetch
    globalThis.fetch = (async () => new Response('{}')) as never
    try {
      for (const id of exampleIds().filter(id => id !== 'native-ui')) {
        const mirror = await mirrorHeadless(id)
        let mirrorTexts: Array<string>
        try {
          mirrorTexts = mirror.texts()
        } finally {
          await mirror.close()
        }
        const adapter = await onAdapter(id)
        try {
          // The adapter rehomes positioned boxes under their containing block,
          // so native tree order differs. Text and its multiplicity must agree.
          expect({ id, texts: adapter.texts().sort() }).toEqual({ id, texts: mirrorTexts.sort() })
        } finally {
          adapter.close()
        }
      }
    } finally {
      globalThis.fetch = fetch
    }
  }, 60_000)
})
