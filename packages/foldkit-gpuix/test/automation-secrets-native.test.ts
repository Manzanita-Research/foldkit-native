// Actual native/OS timing belongs to the sole qualifier. Separate process so
// gpuix 0.10's uncloseable macOS window cannot keep the test process alive.
import { expect, test } from 'bun:test'
import { WINDOWS } from '../../../test/support/windows.ts'

test.skipIf(!WINDOWS)('native privacy: stale clear/replacement/removal and acknowledged public reuse', async () => {
  const child = Bun.spawn([process.execPath, `${import.meta.dir}/secret-stale-native-app.ts`], {
    stdin: 'pipe', stdout: 'pipe', stderr: 'pipe', env: { ...process.env },
  })
  const stdout = new Response(child.stdout).text()
  const stderr = new Response(child.stderr).text()
  const timeout = setTimeout(() => child.kill(), 90_000)
  try {
    const exit = await child.exited
    const [out, errors] = await Promise.all([stdout, stderr])
    if (exit !== 0) throw new Error(`native privacy fixture failed (${exit}): ${errors}\n${out}`)
    const result = JSON.parse(out.trim()) as { nativePrivacy: Array<{ action: string; rawAtMutation: Array<string>; stale: { text: Array<string> }; publicReuse: { text: Array<string> } }> }
    expect(result.nativePrivacy.map(row => row.action)).toEqual(['clear', 'replace', 'remove'])
    for (const row of result.nativePrivacy) {
      // Establish that the timing gap actually occurred, not just static masking.
      expect(row.rawAtMutation).toContain('596274')
      expect(row.stale.text).not.toContain('596274')
      expect(row.publicReuse.text).toContain('596274')
    }
  } finally { clearTimeout(timeout); child.kill() }
}, 100_000)
