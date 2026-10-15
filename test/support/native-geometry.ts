import type { Image } from './png.ts'

export type Size = { width: number; height: number }
export type Bounds = Size & { x: number; y: number }

/** Centre of the target's visible intersection with the actual native window.
 *  This only chooses coordinates; GPUI still decides what receives the hit. */
export const visibleCentre = (box: Bounds, size: Size, name: string) => {
  const left = Math.max(0, box.x), top = Math.max(0, box.y)
  const right = Math.min(size.width, box.x + box.width), bottom = Math.min(size.height, box.y + box.height)
  if (![left, top, right, bottom].every(Number.isFinite) || right <= left || bottom <= top) {
    throw new Error(`"${name}" is fully clipped or outside the native window: ${JSON.stringify({ box, size })}`)
  }
  return { x: (left + right) / 2, y: (top + bottom) / 2 }
}

/** Read a logical native-window point with each screenshot density axis. */
export const pixelAt = (image: Image, size: Size, point: { x: number; y: number }) => {
  if (![size.width, size.height, image.width, image.height].every(value => Number.isFinite(value) && value > 0) ||
    ![point.x, point.y].every(Number.isFinite) || point.x < 0 || point.y < 0 || point.x >= size.width || point.y >= size.height) {
    throw new Error(`pixel point is outside the native window: ${JSON.stringify({ point, size })}`)
  }
  return image.pixel(
    Math.min(image.width - 1, Math.round(point.x * image.width / size.width)),
    Math.min(image.height - 1, Math.round(point.y * image.height / size.height)),
  )
}
