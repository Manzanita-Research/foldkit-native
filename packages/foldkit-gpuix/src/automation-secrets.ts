import type { NativeRenderer } from '@gpuix/native/host'

// These are memory limits, never a retirement boundary. If native drawing
// stalls through this much history, text reads fail until a fresh draw covers
// the unknown history; the adapter need not keep the strings to refuse a read.
const MAX_VALUES = 256
const MAX_CHARACTERS = 65_536

/** Secret history for one automation-enabled renderer. Internal to the host. */
export const createAutomationSecrets = (renderer: NativeRenderer) => {
  const retained = new Set<string>()
  let characters = 0
  let live = new Set<string>()
  let newer = new Set<string>()
  let covered = new Set<string>()
  let baseline: number | undefined
  let seen = 0
  let failed = false
  let dirty = false
  let disposed = false
  const clear = () => {
    retained.clear()
    characters = 0
    live.clear()
    newer.clear()
    covered.clear()
    baseline = undefined
  }
  const invalidate = () => {
    failed = true
    clear()
  }
  const frameCount = () => {
    const frames = renderer.getDebugFrameOverlayStats?.().frames
    if (frames === undefined || !Number.isSafeInteger(frames) || frames < seen) throw new Error('Invalid automation draw acknowledgement')
    seen = frames
    return frames
  }
  const capture = (value: string) => {
    if (disposed || value === '') return
    dirty = true
    if (failed) return
    newer.add(value)
    if (retained.has(value)) return
    if (retained.size === MAX_VALUES || characters + value.length > MAX_CHARACTERS) return invalidate()
    retained.add(value)
    characters += value.length
  }
  const submitted = (values: ReadonlyArray<string>) => {
    if (disposed || (!dirty && !failed && retained.size === 0)) return
    for (const value of values) capture(value)
    dirty = false
    // Unknown history can be discarded only behind a new fence, and the
    // current native values must still be protected after that recovery.
    const current = new Set(values)
    if (current.size > MAX_VALUES || [...current].reduce((sum, value) => sum + value.length, 0) > MAX_CHARACTERS) return invalidate()
    live = current
    if (!failed) {
      covered = new Set(retained)
      newer.clear()
    }
    try {
      // gpuix 0.10.0 samples completed draws on this window's UI thread,
      // after the host's successful applyBatch/Invalidate. The root renders
      // anew each draw (native 9fcd6288; GPUI 81c99f8 window.rs:3054/3199).
      baseline = frameCount()
      // The batch may already have painted before the sample. Request a
      // later draw explicitly; an empty native batch still invalidates.
      renderer.applyBatch('[]')
    } catch {
      invalidate()
    }
  }
  const poll = () => {
    if (disposed || baseline === undefined) return
    try {
      if (frameCount() <= baseline) return
      if (failed) {
        // Captures newer than this fence must first reach a successful sync.
        if (dirty) return
        failed = false
        const current = new Set(live)
        clear()
        live = current
        for (const value of live) {
          retained.add(value)
          characters += value.length
        }
      } else {
        for (const value of covered) {
          if (live.has(value) || newer.has(value)) continue
          retained.delete(value)
          characters -= value.length
        }
        covered.clear()
        baseline = undefined
      }
    } catch {
      invalidate()
    }
  }
  return {
    capture, submitted, poll, invalidate,
    changed: () => { if (!disposed) dirty = true },
    get dirty() { return dirty || failed },
    values: (current: ReadonlyArray<string>) => {
      poll()
      if (disposed || failed) throw new Error('Automation text unavailable until a native draw is acknowledged')
      return [...new Set([...retained, ...current])].sort((a, b) => b.length - a.length)
    },
    dispose: () => {
      disposed = true
      clear()
    },
  }
}

export type AutomationSecrets = ReturnType<typeof createAutomationSecrets>
