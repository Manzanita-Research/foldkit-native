// STARTING GPUI
//
// What goes wrong before a window opens, in one sentence a person can act
// on. gpuix fails in two places:
//
// - Loading its native module. On Linux the module links against
//   libxkbcommon (and loads libwayland-client), so a machine without them
//   fails at load, and napi-rs reports "Cannot find native binding" with the
//   loader's errors as causes ("libxkbcommon.so.0: cannot open shared object
//   file"). That's why the adapter loads gpuix when a window is mounted, not
//   when it's imported.
// - `init`. On Linux GPUI runs on its own UI thread, and a panic there comes
//   back as "The GPUI UI thread panicked during initialization: …": with no
//   compositor to connect to it's wayland-client's `NoCompositor`.
//
// Everything else stays as gpuix said it, typed so a caller can tell.

import { createRequire } from 'node:module'

export type StartFailure = 'NoDisplay' | 'MissingLibrary' | 'Other'

export class NativeStartError extends Error {
  override readonly name = 'NativeStartError'
  constructor(readonly reason: StartFailure, message: string, options: { cause: unknown }) {
    super(message, options)
  }
}

/** Every message in an error and its causes (napi-rs chains the loader's). */
const messages = (error: unknown): Array<string> => {
  const out: Array<string> = []
  const seen = new Set<unknown>()
  for (let at: unknown = error; at !== undefined && at !== null && !seen.has(at); at = (at as { cause?: unknown }).cause) {
    seen.add(at)
    out.push(at instanceof Error ? at.message : String(at))
    if (at instanceof AggregateError) for (const inner of at.errors) out.push(...messages(inner))
  }
  return out
}

const LIBRARY = /(lib[\w+.-]+?\.so(?:\.\d+)*): cannot open shared object file/

/** gpuix's error, as one plain sentence and a reason. */
export const explainStartError = (error: unknown): NativeStartError => {
  if (error instanceof NativeStartError) return error
  const text = messages(error).join('\n')
  const library = LIBRARY.exec(text)?.[1] ?? (/NoWaylandLib/.test(text) ? 'libwayland-client.so.0' : undefined)
  if (library !== undefined) {
    return new NativeStartError('MissingLibrary', `GPUI needs ${library}, which isn't installed: install your distribution's package for it and start the app again.`, { cause: error })
  }
  if (/NoCompositor|cannot open display|XOpenDisplay|no (?:wayland )?compositor/i.test(text)) {
    return new NativeStartError('NoDisplay', 'There is no display to open a window on: start the app from a Wayland or X11 session (WAYLAND_DISPLAY or DISPLAY must be set).', { cause: error })
  }
  const first = (messages(error)[0] ?? 'unknown error').split('\n')[0]
  return new NativeStartError('Other', `GPUI couldn't open a window: ${first}`, { cause: error })
}

/** gpuix's runtime, loaded now rather than at import (see above). */
export const loadGpuix = () => {
  const require = createRequire(import.meta.url)
  try {
    return {
      native: require('@gpuix/native') as typeof import('@gpuix/native'),
      runtime: require('@gpuix/native/runtime') as typeof import('@gpuix/native/runtime'),
    }
  } catch (error) {
    throw explainStartError(error)
  }
}
