// Validate the root README's complete setup, without opening a native window.
// Only mountGpuix's window startup is replaced: the document/host, FoldKit
// runtime, view, native event dispatch and owned disposal are real.
import { expect, spyOn, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { createRendererState } from '@gpuix/native/host'
import { Schema } from 'effect'
import { Runtime } from 'foldkit'
import { defineMessageUnion } from 'foldkit/message'
import ts from 'typescript'

import type { NativeOptions } from '../packages/foldkit-gpuix/src/index.ts'
import { mountHeadless } from '../packages/foldkit-gpuix/test/support.ts'

const root = join(import.meta.dir, '..')
const readme = readFileSync(join(root, 'README.md'), 'utf8')
const source = readme.match(/## Use it\n[\s\S]*?```ts\n([\s\S]*?)\n```/)?.[1]
if (source === undefined) throw new Error('README Use it needs a TypeScript example')

// An in-memory source file uses the real tsconfig paths and pinned dependency
// declarations. Also check this validator; no scratch files or aggregate build.
test('README setup typechecks with the checkout APIs', () => {
  const config = ts.readConfigFile(join(root, 'tsconfig.json'), ts.sys.readFile)
  expect(config.error).toBeUndefined()
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root)
  const path = join(root, 'test', 'readme-setup.snippet.ts')
  const host = ts.createCompilerHost(parsed.options)
  const getSourceFile = host.getSourceFile.bind(host)
  host.getSourceFile = (name, languageVersion, onError, shouldCreateNewSourceFile) =>
    name === path ? ts.createSourceFile(name, source, languageVersion, true)
      : getSourceFile(name, languageVersion, onError, shouldCreateNewSourceFile)
  const program = ts.createProgram([path, import.meta.path], parsed.options, host)
  const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)]
  expect(ts.formatDiagnostics(diagnostics, {
    getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n',
  })).toBe('')
}, 30_000)

for (const owned of [true, false]) {
  test(`README setup renders, increments and ${owned ? 'owns disposal' : 'detects missing ownership'}`, async () => {
    const before = globalThis.document
    let mounted: ReturnType<typeof mountHeadless> | undefined
    let handle: { dispose: () => void } | undefined
    let dispose: ReturnType<typeof spyOn> | undefined
    const startHeadless = (options: NativeOptions) => {
      // These are the documented window options; this counterpart supplies
      // their viewport to attachGpuix instead of loading or initializing GPUI.
      expect(options).toEqual({ title: 'My app', width: 800, height: 600, css: expect.any(String) })
      mounted = mountHeadless({ css: options.css, viewport: { width: options.width!, height: options.height! } })
      return {
        ...mounted,
        own: (runtime: { dispose: () => void }) => {
          handle = runtime
          dispose = spyOn(runtime, 'dispose')
          return owned ? mounted!.own(runtime) : runtime
        },
      }
    }
    try {
      const body = new Bun.Transpiler({ loader: 'ts' }).transformSync(source.replace(/^import .*\n/gm, ''))
      new Function('Schema', 'Runtime', 'defineMessageUnion', 'mountGpuix', body)(
        Schema, Runtime, defineMessageUnion, startHeadless,
      )
      const app = mounted!
      expect(handle).toBeDefined()
      await app.settle()
      expect(app.unsupported).toEqual([])
      expect(app.texts()).toContain('Count: 0')
      // Effective adapter styles and forwarded fills, not physical pixel proof.
      for (const selector of ['body', '.app', 'p', 'button']) {
        const element = app.document.querySelector(selector)!
        const style = app.window.getComputedStyle(element)
        expect(style.getPropertyValue('color')).toBe('#000000')
        if (selector === 'body' || selector === '.app') {
          expect(style.getPropertyValue('background-color')).toBe('#ffffff')
          expect(app.gpui.node(element.nativeId).style['backgroundColor']).toBe('#ffffff')
        }
      }
      await app.click('+1')
      expect(app.texts()).toContain('Count: 1')
      expect(app.gpui.retainedCount()).toBeGreaterThan(0)
      app.close()
      expect(dispose).toHaveBeenCalledTimes(owned ? 1 : 0)
      expect(app.gpui.retainedCount()).toBe(0)
      expect(createRendererState(app.fake.renderer).current()).toBeUndefined()
      expect(globalThis.document).toBe(before)
      app.close()
      expect(dispose).toHaveBeenCalledTimes(owned ? 1 : 0)
    } finally {
      mounted?.close()
      if (!owned) handle?.dispose()
      dispose?.mockRestore()
    }
  })
}
