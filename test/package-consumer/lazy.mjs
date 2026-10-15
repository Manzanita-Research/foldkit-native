import assert from 'node:assert/strict'
const before = process.exit
const { sheetFromCss } = await import('foldkit-gpuix')
const { uiCss, token } = await import('@foldkit-native/ui')
assert.equal(sheetFromCss('.app { padding: 12px; }').unsupported.length, 0)
assert.ok(uiCss.length > 0)
assert.equal(token('color.canvas'), 'var(--fn-color-canvas)')
assert.equal(process.exit, before)
console.log('Adapter and UI import without an installed platform native binary passed.')
