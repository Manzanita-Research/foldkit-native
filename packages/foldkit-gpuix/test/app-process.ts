// A process that is only a FoldKit app on gpuix, for app.test.ts: it opens,
// draws a few frames, closes, and says what happened on stdout. The fake GPUI
// stands in for the window unless the mode says "real".
//
//   bun app-process.ts close-host        close() with exitOnClose: false
//   bun app-process.ts close-host-busy   the same, with other work running
//   bun app-process.ts close-exit        close() with the default exitOnClose
//   bun app-process.ts no-compositor     init fails as gpuix does without one
//   bun app-process.ts real-no-display   the real gpuix with no display (Linux)
//   bun app-process.ts real-close-host   close() on a real window (Metal)
//   bun app-process.ts real-native-close the window closes as a person's click does

import { dlopen, FFIType } from 'bun:ffi'

import { mountGpuix } from '../src/index.ts'
import { createFakeWindow, frames, log, openApp } from './app-support.ts'

const mode = process.argv[2]
const say = (line: string) => process.stdout.write(`${line} ${Math.round(performance.now())}\n`)
process.on('beforeExit', () => say('beforeExit'))
process.on('exit', () => say('exit'))

if (mode === 'no-compositor') {
  const window = createFakeWindow({
    init: () => {
      throw new Error('The GPUI UI thread panicked during initialization: called `Result::unwrap()` on an `Err` value: NoCompositor')
    },
  })
  mountGpuix({ createRenderer: window.createRenderer })
  say('opened')
} else if (mode === 'real-no-display') {
  // The real gpuix, a real start: exitOnClose's default says why in a
  // sentence and exits 1, or (with false) throws. Run it with no display.
  try {
    mountGpuix({ title: 'app-process', exitOnClose: process.argv[3] !== 'throw' })
    say('opened')
  } catch (error) {
    say(`threw ${(error as Error).name}: ${(error as Error).message}`)
  }
} else if (mode === 'close-host' || mode === 'close-host-busy' || mode === 'close-exit') {
  const { app } = openApp(mode === 'close-exit' ? { exitOnClose: true } : {})
  if (mode === 'close-host-busy') setTimeout(() => say('other work done'), 1500)
  await frames(6)
  say(log.join(','))
  say('closing')
  await app.close()
  say(`closed ${log.join(',')}`)
} else if (mode === 'real-close-host' || mode === 'real-native-close') {
  const app = mountGpuix({ title: 'app-process', width: 240, height: 160, focus: false, exitOnClose: mode === 'real-native-close', onClose: () => void say('onClose') })
  app.container.textContent = 'hello'
  await frames(10)
  say('closing')
  if (mode === 'real-close-host') {
    await app.close()
    say('closed')
  } else {
    // [[NSApp windows][0] performClose:nil]: what the red button does.
    const objc = dlopen('/usr/lib/libobjc.A.dylib', {
      objc_getClass: { args: [FFIType.cstring], returns: FFIType.ptr },
      sel_registerName: { args: [FFIType.cstring], returns: FFIType.ptr },
      objc_msgSend: { args: [FFIType.ptr, FFIType.ptr, FFIType.u64], returns: FFIType.ptr },
    })
    const send = (target: unknown, selector: string, argument = 0) =>
      objc.symbols.objc_msgSend(target as never, objc.symbols.sel_registerName(Buffer.from(`${selector}\0`)), argument)
    const windows = send(send(objc.symbols.objc_getClass(Buffer.from('NSApplication\0')), 'sharedApplication'), 'windows')
    send(send(windows, 'objectAtIndex:', 0), 'performClose:', 0)
    say('asked')
  }
} else {
  throw new Error(`unknown mode ${mode}`)
}
