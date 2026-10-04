// Opens one example in a native window:
//
//   bun run example weather
//
// The example's app.ts starts it exactly as FoldKit's entry.ts does on the
// web; only the container comes from FoldKit Native.

import { mountNative } from '../src/index.ts'
import { exampleIds, loadExample } from './support/example.ts'

const id = process.argv[2]
if (id === undefined) {
  console.error(`usage: bun run example <name>\nexamples: ${exampleIds().join(', ')}`)
  process.exit(1)
}
const example = await loadExample(id)
if (example.meta.renderer === 'gpuix') {
  const { mountGpuix } = await import('foldkit-gpuix')
  const native = mountGpuix({ title: example.meta.title, width: example.meta.width, height: example.meta.height, css: example.css })
  example.start(native.container)
} else {
  const native = mountNative({
    title: example.meta.title,
    width: example.meta.width,
    height: example.meta.height,
    css: example.css,
  })
  example.start(native.container)
}
