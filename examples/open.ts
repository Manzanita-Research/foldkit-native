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
// FOLDKIT_NATIVE_RENDERER=gpuix|mirror overrides the example's own choice
// (scripts/measure.ts runs each example on both).
const renderer = process.env['FOLDKIT_NATIVE_RENDERER'] ?? example.meta.renderer
if (renderer === 'gpuix') {
  const { mountGpuix } = await import('foldkit-gpuix')
  // localStorage is a file in the app's data folder; FOLDKIT_NATIVE_DATA_DIR
  // puts it somewhere else (the tests use a scratch folder).
  const dataDir = process.env['FOLDKIT_NATIVE_DATA_DIR']
  const native = mountGpuix({
    title: example.meta.title, width: example.meta.width, height: example.meta.height, css: example.css,
    appId: `dev.foldkit-native.${id}`, ...(dataDir === undefined ? {} : { dataDir }),
  })
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
