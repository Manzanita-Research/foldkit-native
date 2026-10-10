// localStorage that outlives the window (FKN-22): a file per app, written
// through on every change, where each platform keeps app data.
import { afterEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { type ErrorReport, dataDirFor } from '../src/index.ts'
import { fileStorage } from '../src/storage.ts'
import { mountHeadless } from './support.ts'

const dirs: Array<string> = []
const scratch = () => {
  const dir = mkdtempSync(join(tmpdir(), 'foldkit-gpuix-storage-'))
  dirs.push(dir)
  return dir
}
let app: ReturnType<typeof mountHeadless> | undefined
afterEach(() => {
  app?.close()
  app = undefined
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe('where an app keeps its data', () => {
  test('per platform, under the appId', () => {
    const home = '/home/jem'
    expect(dataDirFor('dev.jem.jemera', { platform: 'darwin', home, env: {} })).toBe('/home/jem/Library/Application Support/dev.jem.jemera')
    expect(dataDirFor('dev.jem.jemera', { platform: 'linux', home, env: {} })).toBe('/home/jem/.local/share/dev.jem.jemera')
    expect(dataDirFor('dev.jem.jemera', { platform: 'linux', home, env: { XDG_DATA_HOME: '/data' } })).toBe('/data/dev.jem.jemera')
    // The XDG spec ignores a relative XDG_DATA_HOME.
    expect(dataDirFor('jemera', { platform: 'linux', home, env: { XDG_DATA_HOME: 'data' } })).toBe('/home/jem/.local/share/jemera')
    expect(dataDirFor('jemera', { platform: 'win32', home, env: { APPDATA: 'C:\\Users\\jem\\AppData\\Roaming' } })).toContain('jemera')
  })

  test('an appId that isn\'t a plain folder name is refused', () => {
    for (const appId of ['', '../x', 'a/b', '.hidden', 'a..b', 'a b']) expect(() => dataDirFor(appId)).toThrow(/can't name a folder/)
  })
})

describe('localStorage in a file', () => {
  test('each change is on disk when the call returns, and the next window reads it back', () => {
    const dir = scratch()
    app = mountHeadless({ dataDir: dir })
    localStorage.setItem('canvas', '{"grid":[1,2]}')
    localStorage.setItem('theme', 'dark')
    const file = join(dir, 'localStorage.json')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ canvas: '{"grid":[1,2]}', theme: 'dark' })
    localStorage.removeItem('theme')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ canvas: '{"grid":[1,2]}' })
    // No temporary files left behind.
    expect(readdirSync(dir)).toEqual(['localStorage.json'])
    app.close()

    // A restart: another window over the same folder.
    app = mountHeadless({ dataDir: dir })
    expect(localStorage.getItem('canvas')).toBe('{"grid":[1,2]}')
    expect(localStorage.length).toBe(1)
    expect(localStorage.key(0)).toBe('canvas')
    localStorage.clear()
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({})
  })

  test('the folder is made at the first write, not before', () => {
    const dir = join(scratch(), 'app', 'data')
    app = mountHeadless({ dataDir: dir })
    expect(localStorage.getItem('x')).toBeNull()
    expect(existsSync(dir)).toBe(false)
    localStorage.setItem('x', '1')
    expect(existsSync(join(dir, 'localStorage.json'))).toBe(true)
  })

  test('values are strings, as a browser stores them', () => {
    app = mountHeadless({ dataDir: scratch() })
    localStorage.setItem('n', 42 as unknown as string)
    expect(localStorage.getItem('n')).toBe('42')
  })

  test('a file that isn\'t a store is set aside and reported; the app starts empty', () => {
    const dir = scratch()
    writeFileSync(join(dir, 'localStorage.json'), '{not json')
    const reports: Array<ErrorReport> = []
    app = mountHeadless({ dataDir: dir, onError: report => void reports.push(report) })
    expect(localStorage.length).toBe(0)
    expect(readFileSync(join(dir, 'localStorage.json.unreadable'), 'utf8')).toBe('{not json')
    expect(reports.map(report => report.phase)).toEqual(['storage'])
    localStorage.setItem('a', '1')
    expect(JSON.parse(readFileSync(join(dir, 'localStorage.json'), 'utf8'))).toEqual({ a: '1' })
  })

  test('a write that fails throws, as a browser\'s quota error does, and changes nothing', () => {
    const parent = scratch()
    // A file where the folder should be: mkdir fails.
    writeFileSync(join(parent, 'blocked'), '')
    const storage = fileStorage(join(parent, 'blocked', 'app'))
    expect(() => storage.setItem('a', '1')).toThrow()
    expect(storage.getItem('a')).toBeNull()
    expect(storage.length).toBe(0)
  })

  test.each(['removeItem', 'clear'] as const)('failed %s preserves values, key order and later writes', operation => {
    const dir = scratch()
    const path = join(dir, 'localStorage.json')
    const temporary = `${path}.${process.pid}.tmp`
    const storage = fileStorage(dir)
    storage.setItem('saved', 'one')
    storage.setItem('other', 'two')
    const original = readFileSync(path, 'utf8')
    const state = () => ({
      saved: storage.getItem('saved'), other: storage.getItem('other'),
      length: storage.length, keys: [storage.key(0), storage.key(1), storage.key(2)],
    })
    const before = state()
    // Block the exact write destination without depending on OS permissions.
    mkdirSync(temporary)
    expect(() => storage.setItem('saved', 'replacement')).toThrow()
    expect(state()).toEqual(before)
    expect(() => storage.setItem('new', 'replacement')).toThrow()
    expect(storage.getItem('new')).toBeNull()
    expect(state()).toEqual(before)
    // Removing an absent key remains a no-op even while writes are blocked.
    expect(() => storage.removeItem('absent')).not.toThrow()
    expect(() => operation === 'removeItem' ? storage.removeItem('saved') : storage.clear()).toThrow()
    expect(state()).toEqual(before)
    expect(readFileSync(path, 'utf8')).toBe(original)
    expect(fileStorage(dir).getItem('saved')).toBe('one')

    rmSync(temporary, { recursive: true })
    storage.setItem('unrelated', 'three')
    const expected = { saved: 'one', other: 'two', unrelated: 'three' }
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual(expected)
    const restarted = fileStorage(dir)
    expect([restarted.key(0), restarted.key(1), restarted.key(2)]).toEqual(Object.keys(expected))
    expect(restarted.length).toBe(3)
    for (const [key, value] of Object.entries(expected)) expect(restarted.getItem(key)).toBe(value)
    // Successful deletion and clearing still write through synchronously.
    restarted.removeItem('saved')
    expect(restarted.getItem('saved')).toBeNull()
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ other: 'two', unrelated: 'three' })
    restarted.clear()
    expect(restarted.length).toBe(0)
    expect(restarted.key(0)).toBeNull()
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({})
    expect(readdirSync(dir)).toEqual(['localStorage.json'])
    mkdirSync(temporary)
    expect(() => restarted.clear()).not.toThrow()
    expect(() => restarted.removeItem('absent')).not.toThrow()
    expect(readFileSync(path, 'utf8')).toBe('{}')
  })

  for (const [kind, value] of Object.entries({ number: 42, boolean: true, null: null, object: { nested: 'value' }, array: ['value'] })) {
    for (const invalidFirst of [true, false]) {
      test(`a ${kind} entry ${invalidFirst ? 'before' : 'after'} a valid entry rejects and preserves the whole store`, () => {
        const dir = scratch()
        const path = join(dir, 'localStorage.json')
        const initial = JSON.stringify(invalidFirst ? { damaged: value, stable: 'keep' } : { stable: 'keep', damaged: value }, null, 2) + '\n'
        writeFileSync(path, initial)
        const reports: Array<ErrorReport> = []
        app = mountHeadless({ dataDir: dir, onError: report => void reports.push(report) })
        expect(localStorage.length).toBe(0)
        expect(localStorage.key(0)).toBeNull()
        expect(localStorage.getItem('stable')).toBeNull()
        expect(localStorage.getItem('damaged')).toBeNull()
        expect(reports.map(report => report.phase)).toEqual(['storage'])
        expect(readFileSync(`${path}.unreadable`, 'utf8')).toBe(initial)
        expect(existsSync(path)).toBe(false)
        localStorage.setItem('new', 'value')
        expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ new: 'value' })
        expect(readFileSync(`${path}.unreadable`, 'utf8')).toBe(initial)
        const restarted = fileStorage(dir)
        expect(restarted.length).toBe(1)
        expect(restarted.getItem('new')).toBe('value')
        expect(restarted.getItem('stable')).toBeNull()
        expect(reports.length).toBe(1)
      })
    }
  }

  test('a valid string map loads in order and survives the next write without a report', () => {
    const dir = scratch()
    const path = join(dir, 'localStorage.json')
    writeFileSync(path, '{"stable":"keep","other":"42"}')
    const reports: Array<ErrorReport> = []
    app = mountHeadless({ dataDir: dir, onError: report => void reports.push(report) })
    expect(localStorage.length).toBe(2)
    expect([localStorage.key(0), localStorage.key(1)]).toEqual(['stable', 'other'])
    expect(localStorage.getItem('stable')).toBe('keep')
    expect(localStorage.getItem('other')).toBe('42')
    localStorage.setItem('new', 'value')
    expect(JSON.parse(readFileSync(path, 'utf8'))).toEqual({ stable: 'keep', other: '42', new: 'value' })
    expect(reports).toEqual([])
    expect(readdirSync(dir)).toEqual(['localStorage.json'])
  })

  test('sessionStorage stays in memory', () => {
    const dir = scratch()
    app = mountHeadless({ dataDir: dir })
    sessionStorage.setItem('tab', '1')
    expect(existsSync(join(dir, 'localStorage.json'))).toBe(false)
    app.close()
    app = mountHeadless({ dataDir: dir })
    expect(sessionStorage.getItem('tab')).toBeNull()
  })

  test('a write costs well under a millisecond at the size apps keep (a 32×32 canvas)', () => {
    const dir = scratch()
    mkdirSync(dir, { recursive: true })
    const storage = fileStorage(dir)
    const canvas = JSON.stringify({ grid: Array.from({ length: 32 }, () => Array.from({ length: 32 }, () => '#a1b2c3')), gridSize: 32 })
    const writes = 200
    const started = performance.now()
    for (let i = 0; i < writes; i++) storage.setItem('pixel-art-canvas', canvas.replace('#a1b2c3', `#${String(i).padStart(6, '0')}`))
    const each = (performance.now() - started) / writes
    console.log(`localStorage write-through: ${(canvas.length / 1024).toFixed(1)} KB value, ${each.toFixed(3)} ms per write`)
    // Loose, so CI only catches "broken": the number above is the measurement.
    expect(each).toBeLessThan(5)
  })
})
