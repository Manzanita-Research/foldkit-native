import { expect, test } from 'bun:test'

test('unsupported selector tokens exit with an error instead of looping', async () => {
  const proc = Bun.spawn([process.execPath, '-e', "import { parseSelector } from './packages/foldkit-gpuix/src/dom.ts'; parseSelector('&')"], {
    cwd: new URL('../../..', import.meta.url).pathname,
    stdout: 'pipe', stderr: 'pipe',
  })
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; proc.kill() }, 1000)
  try {
    await proc.exited
    expect(timedOut).toBe(false)
    expect(await new Response(proc.stderr).text()).toContain('Unsupported selector')
  } finally { clearTimeout(timer); proc.kill() }
})
