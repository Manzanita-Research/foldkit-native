// Every example follows the same shape (EXAMPLES.md): FoldKit's two kinds of
// test, a native test, generated CSS, and the facts the gallery shows.
import { describe, expect, test } from 'bun:test'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { EXAMPLES_DIR, exampleIds, loadExample } from './support/example.ts'

describe.each(exampleIds())('%s', id => {
  test('has story, scene and native tests, and generated CSS', () => {
    for (const file of ['story.test.ts', 'scene.test.ts', 'native.test.ts', 'styles.css', 'styles.native.css']) {
      expect(existsSync(join(EXAMPLES_DIR, id, file)), `examples/${id}/${file}`).toBe(true)
    }
  })

  test('says what it shows from FoldKit and from GPUI', async () => {
    const { meta, start } = await loadExample(id)
    for (const field of ['title', 'blurb', 'foldkit', 'gpui'] as const) expect(meta[field].length).toBeGreaterThan(0)
    expect(meta.width).toBeGreaterThan(0)
    expect(meta.height).toBeGreaterThan(0)
    expect(typeof start).toBe('function')
  })
})
