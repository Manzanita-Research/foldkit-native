import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pixelAt, visibleCentre } from '../../../test/support/native-geometry.ts'

// Each mock lives in its own child so @gpuix/native/testing is never replaced
// in the suite that runs real Metal tests. No native library is loaded here.
const probe = String.raw`
import { mock } from 'bun:test'
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { deflateSync } from 'node:zlib'
import { createFocusableFake, openMetal } from './packages/foldkit-gpuix/test/support.ts'

const scenario = process.env.GEOMETRY_SCENARIO
const level = process.env.GEOMETRY_LEVEL
const requested = scenario === 'density' ? { width: 8, height: 8 } : { width: 1100, height: 820 }
const actual = scenario === 'density' ? { width: 4, height: 4 } : scenario === 'unconstrained' ? requested : { width: 1024, height: 653 }
let clicked
let constructed
const box = scenario === 'clipped' ? { x: 414, y: 634, width: 134, height: 40 }
  : scenario === 'hidden' ? { x: 37, y: 778, width: 42, height: 20 }
  : { x: 40, y: 50, width: 80, height: 40 }
mock.module('@gpuix/native/testing', () => ({ TestRenderer: class {
  constructor(size) {
    constructed = size
    const fake = createFocusableFake(actual)
    return Object.assign(fake.renderer, {
      flush() {}, dispatchNativeEvents() {},
      getElementBounds: () => box,
      nativeSimulateClick: (x, y) => { clicked = { x, y } },
      captureScreenshot(path) {
        // 8x12 screenshot for a 4x4 logical window: x density2, y density3.
        const chunk = (type, data) => {
          const out = Buffer.alloc(data.length + 12)
          out.writeUInt32BE(data.length); out.write(type, 4); data.copy(out, 8)
          let crc = 0xffffffff
          for (const byte of out.subarray(4, 8 + data.length)) {
            crc ^= byte
            for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
          }
          out.writeUInt32BE((crc ^ 0xffffffff) >>> 0, 8 + data.length)
          return out
        }
        const header = Buffer.alloc(13)
        header.writeUInt32BE(8); header.writeUInt32BE(12, 4); header[8] = 8; header[9] = 2
        const rows = Buffer.alloc((1 + 8 * 3) * 12, 255)
        for (let y = 0; y < 12; y++) rows[y * 25] = 0
        const at = 5 * 25 + 1 + 3 * 3
        rows[at] = 38; rows[at + 1] = 36; rows[at + 2] = 39
        writeFileSync(path, Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR',header), chunk('IDAT',deflateSync(rows)), chunk('IEND',Buffer.alloc(0))]))
      },
    })
  }
} }))
const app = level === 'support' ? await openMetal('geometry-headless', requested)
  : await (await import('./examples/support/harness.ts'))[level === 'mirror' ? 'mirrorMetal' : 'openMetal']('pixel-art', requested)
try {
  assert.deepEqual(constructed, requested, 'requested native size must not be replaced')
  if (scenario === 'viewport' || scenario === 'unconstrained') {
    const window = app.window ?? app.document.defaultView
    assert.equal(window.innerWidth, actual.width)
    assert.equal(window.innerHeight, actual.height)
    if (level !== 'mirror') assert.equal(app.document.documentElement.clientHeight, actual.height)
  } else if (scenario === 'density') {
    if (level === 'support') assert.deepEqual(app.pixels('density').at(1.5, 1.5), [38,36,39])
    else {
      const shot = app.screenshot('density')
      assert.deepEqual(shot.logicalSize, actual)
      assert.deepEqual(shot.pixel(Math.round(1.5 * shot.width / shot.logicalSize.width), Math.round(1.5 * shot.height / shot.logicalSize.height)), [38,36,39])
    }
  } else if (scenario === 'hidden') {
    await assert.rejects(app.click(level === 'support' ? { nativeId: 1 } : 'Syntax'), /outside.*window|fully clipped/)
    assert.equal(clicked, undefined, 'a hidden target must not receive native input')
  } else {
    await app.click(level === 'support' ? { nativeId: 1 } : 'Syntax')
    assert.deepEqual(clicked, scenario === 'clipped' ? { x: 481, y: 643.5 } : { x: 80, y: 70 })
  }
} finally { await app.close() }
process.exit(0)
`

for (const level of ['support', 'gpuix', 'mirror']) {
  for (const scenario of ['viewport', 'unconstrained', 'density', 'clipped', 'hidden', 'visible']) {
    test(`native helper geometry, headless: ${level} ${scenario}`, () => {
      const evidence = mkdtempSync(join(tmpdir(), 'geometry-headless-'))
      try {
        const child = spawnSync(process.execPath, ['-r', './test/support/dom.ts', '-e', probe], {
          cwd: new URL('../../../', import.meta.url),
          env: { ...process.env, GEOMETRY_LEVEL: level, GEOMETRY_SCENARIO: scenario, FOLDKIT_NATIVE_EVIDENCE: evidence, FOLDKIT_NATIVE_RENDERER: 'gpuix' },
          encoding: 'utf8', timeout: 10_000,
        })
        expect({ status: child.status, error: child.error?.message, stderr: child.stderr }).toEqual({ status: 0, error: undefined, stderr: '' })
      } finally { rmSync(evidence, { recursive: true, force: true }) }
    })
  }
}

test('visible native points stay inside every window edge, headless', () => {
  const size = { width: 100, height: 80 }
  for (const [box, point] of [
    [{ x: -20, y: 20, width: 30, height: 20 }, { x: 5, y: 30 }],
    [{ x: 90, y: 20, width: 30, height: 20 }, { x: 95, y: 30 }],
    [{ x: 20, y: -20, width: 20, height: 30 }, { x: 30, y: 5 }],
    [{ x: 20, y: 70, width: 20, height: 30 }, { x: 30, y: 75 }],
  ] as const) expect(visibleCentre(box, size, 'edge target')).toEqual(point)
  expect(() => visibleCentre({ x: 100, y: 0, width: 10, height: 10 }, size, 'edge target')).toThrow('fully clipped')
  expect(() => visibleCentre({ x: 0, y: 0, width: 0, height: 10 }, size, 'empty target')).toThrow('fully clipped')
})

test('pixel sampling respects the final pixel and rejects outside points, headless', () => {
  const image = { width: 8, height: 12, pixel: (x: number, y: number): [number, number, number] => [x, y, 0] }
  const size = { width: 4, height: 4 }
  expect(pixelAt(image, size, { x: 3.99, y: 3.99 })).toEqual([7, 11, 0])
  expect(pixelAt(image, size, { x: 0, y: 0 })).toEqual([0, 0, 0])
  expect(() => pixelAt(image, size, { x: 4, y: 1 })).toThrow('outside')
  expect(() => pixelAt(image, size, { x: 1, y: -1 })).toThrow('outside')
  expect(() => pixelAt(image, { width: 0, height: 4 }, { x: 0, y: 1 })).toThrow('outside')
})
