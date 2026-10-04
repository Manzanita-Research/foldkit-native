// Just enough PNG decoding to read pixels back from gpuix's screenshots:
// 8-bit RGB or RGBA, not interlaced.

import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

export type Image = { width: number; height: number; pixel: (x: number, y: number) => [number, number, number] }

export const readPng = (path: string): Image => {
  const file = readFileSync(path)
  let offset = 8
  let width = 0, height = 0, channels = 0
  const data: Array<Buffer> = []
  while (offset < file.length) {
    const length = file.readUInt32BE(offset)
    const type = file.toString('ascii', offset + 4, offset + 8)
    const body = file.subarray(offset + 8, offset + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      const [depth, color, , , interlace] = [body[8], body[9], body[10], body[11], body[12]]
      if (depth !== 8 || (color !== 2 && color !== 6) || interlace !== 0) throw new Error(`unsupported PNG (depth ${depth}, colour ${color})`)
      channels = color === 6 ? 4 : 3
    } else if (type === 'IDAT') data.push(body)
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(data))
  const stride = width * channels
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]!
    for (let i = 0; i < stride; i++) {
      const value = raw[y * (stride + 1) + 1 + i]!
      const a = i >= channels ? pixels[y * stride + i - channels]! : 0
      const b = y > 0 ? pixels[(y - 1) * stride + i]! : 0
      const c = i >= channels && y > 0 ? pixels[(y - 1) * stride + i - channels]! : 0
      const predicted = filter === 0 ? 0 : filter === 1 ? a : filter === 2 ? b : filter === 3 ? (a + b) >> 1 : (() => {
        const p = a + b - c
        const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)]
        return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      })()
      pixels[y * stride + i] = (value + predicted) & 0xff
    }
  }
  return {
    width,
    height,
    pixel: (x, y) => {
      const at = y * stride + x * channels
      return [pixels[at]!, pixels[at + 1]!, pixels[at + 2]!]
    },
  }
}

/** `#1d1d21` → [29, 29, 33]. */
export const rgb = (hex: string): [number, number, number] =>
  [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]

/** Every channel within `tolerance` (GPU output isn't bit-exact across machines). */
export const near = (actual: [number, number, number], expected: [number, number, number], tolerance = 3) =>
  actual.every((value, i) => Math.abs(value - expected[i]!) <= tolerance)
