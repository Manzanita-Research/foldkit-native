// scripts/css.ts: an app's CSS as written (Tailwind 4 here) → CSS happy-dom
// and the mirror can read. Each check is something happy-dom would otherwise
// drop or get wrong.
import { afterAll, expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { nativeCss } from '../scripts/css.ts'
import { mountFake } from './support/mount.ts'

const dir = mkdtempSync(join(tmpdir(), 'foldkit-native-css-'))
afterAll(() => rmSync(dir, { recursive: true, force: true }))

test('Tailwind utilities reach the computed style and GPUI', async () => {
  const classes = 'px-6 py-2 bg-blue-500 text-white rounded-lg shadow-lg hover:bg-blue-600 bg-black/50'
  writeFileSync(join(dir, 'view.ts'), `export const c = '${classes}'`)
  writeFileSync(join(dir, 'styles.css'), "@import 'tailwindcss';\n")
  const css = await nativeCss(join(dir, 'styles.css'))

  // What happy-dom can't read is gone.
  expect(css).not.toMatch(/@layer\s+\w+\s*\{|@property|oklch\(|&:hover|padding-inline/)

  const mounted = mountFake({ css })
  try {
    const button = mounted.document.createElement('button')
    button.className = classes.replace(' bg-black/50', '')
    button.textContent = 'Go'
    mounted.container.appendChild(button)
    await mounted.settle()
    expect(mounted.nativeOf(button).style).toMatchObject({
      paddingLeft: 24, paddingRight: 24, paddingTop: 8, paddingBottom: 8,
      backgroundColor: '#3080ff', borderTopLeftRadius: 8,
      boxShadow: { offsetY: 10, blurRadius: 15, spreadRadius: -3 },
    })
    // The hover colour arrives as a GPUI hover state.
    const veil = mounted.document.createElement('div')
    veil.className = 'bg-black/50'
    mounted.container.appendChild(veil)
    await mounted.settle()
    expect(mounted.nativeOf(veil).style.backgroundColor).toMatch(/^rgba\(0, 0, 0, \.5\)$|^#00000080$/)
  } finally {
    await mounted.close()
  }
})

test('plain CSS passes through, nesting flattened', async () => {
  writeFileSync(join(dir, 'plain.css'), '.card { padding: 4px; &:hover { padding: 8px } }')
  const css = await nativeCss(join(dir, 'plain.css'))
  expect(css).toContain('.card:hover')
  expect(css).not.toContain('&')
})
