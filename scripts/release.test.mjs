import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, cpSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { command, github, validateGate, releasePlan, publish } from './release.mjs'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const sha = 'a'.repeat(40)
const older = 'b'.repeat(40)
const repo = 'julia-script/foldkit-native'
const notes = '### Patch Changes\n\n- Source release.'
const log = `# foldkit-native\n\n## 0.1.1\n\n${notes}\n\n## 0.1.0\n\nOld notes.\n`
const pkg = { name: 'foldkit-native', version: '0.1.1', private: true }
const validRun = { id: 123, run_attempt: 1, status: 'completed', conclusion: 'success', name: 'CI',
  event: 'push', head_branch: 'main', head_sha: sha, head_repository: { full_name: repo },
  repository: { full_name: repo }, path: '.github/workflows/ci.yml' }
const event = () => ({ workflow_run: structuredClone(validRun), repository: { full_name: repo } })

function fixture(t) {
  const cwd = mkdtempSync(resolve(tmpdir(), 'source-release-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  mkdirSync(resolve(cwd, '.changeset'))
  writeFileSync(resolve(cwd, 'package.json'), JSON.stringify(pkg))
  writeFileSync(resolve(cwd, 'package-lock.json'), JSON.stringify({ name: pkg.name, version: pkg.version, packages: { '': pkg } }))
  writeFileSync(resolve(cwd, 'CHANGELOG.md'), log)
  const eventPath = resolve(cwd, 'event.json')
  writeFileSync(eventPath, JSON.stringify(event()))
  const env = { GITHUB_EVENT_NAME: 'workflow_run', GITHUB_EVENT_PATH: eventPath, GITHUB_REPOSITORY: repo, GITHUB_SHA: sha }
  const writes = []
  let ref = null
  let release = null
  let main = sha
  let gateReads = 0
  const api = (args, options = {}) => {
    const path = args[0]
    if (args.includes('POST')) {
      writes.push({ args, options })
      if (path.endsWith('/git/refs')) ref = { object: { type: 'commit', sha } }
      else release = JSON.parse(options.input)
      return {}
    }
    if (path.endsWith('/actions/runs/123')) { gateReads++; return structuredClone(validRun) }
    if (path.endsWith('/git/ref/heads/main')) return { object: { sha: main } }
    if (path.includes('/git/ref/tags/')) return ref
    if (path.includes('/releases/tags/')) return release
    throw new Error(`Unexpected API read: ${path}`)
  }
  const execute = (file, args) => {
    assert.equal(file, 'git')
    if (args[0] === 'rev-parse') return sha
    if (args[0] === 'status') return ''
    if (args[0] === 'merge-base') return ''
    if (args[0] === 'show') return args[1].endsWith(':package.json') ? JSON.stringify(pkg) : log
    throw new Error(`Unexpected command: ${args}`)
  }
  return { cwd, env, api, execute, writes, get gateReads() { return gateReads },
    set main(value) { main = value }, set ref(value) { ref = value }, set release(value) { release = value } }
}

test('successful exact-main CI is accepted; failed, unrelated, stale and fork events fail closed', () => {
  assert.equal(validateGate(event(), validRun, sha, sha, repo), sha)
  const invalidRuns = [
    { conclusion: 'failure' }, { status: 'in_progress' }, { event: 'pull_request' },
    { head_branch: 'topic' }, { name: 'Fake CI' }, { path: '.github/workflows/other.yml' },
    { head_repository: { full_name: 'attacker/fork' } }, { repository: { full_name: 'attacker/fork' } },
    { id: 124 }, { run_attempt: 2 }, { run_attempt: undefined }, { run_attempt: 0 }, { head_sha: older }, { head_sha: 'not-a-sha' },
  ]
  for (const delta of invalidRuns) assert.throws(() => validateGate(event(), { ...validRun, ...delta }, sha, sha, repo))
  const request = event(); request.workflow_run.event = 'pull_request'
  assert.throws(() => validateGate(request, validRun, sha, sha, repo))
  assert.throws(() => validateGate(event(), validRun, older, sha, repo))
  assert.throws(() => validateGate(event(), validRun, sha, older, repo))
  assert.throws(() => validateGate(event(), validRun, sha, sha, 'invalid'))
})

test('dry release plans an exact tag and changelog without invoking any write', t => {
  const f = fixture(t)
  assert.deepEqual(releasePlan(f.cwd), { version: '0.1.1', tag: 'foldkit-native@0.1.1', notes })
  const result = publish({ ...f, dryRun: true })
  assert.equal(result.state, 'create-tag-and-release')
  assert.equal(result.sha, sha)
  assert.equal(f.writes.length, 0)
})

test('publishes only GitHub metadata, pins tag to CI SHA, and repeats idempotently', t => {
  const f = fixture(t)
  assert.equal(publish(f).state, 'released')
  assert.equal(f.writes.length, 2)
  assert.ok(f.writes[0].args.includes(`sha=${sha}`))
  assert.ok(f.writes[0].args.includes('ref=refs/tags/foldkit-native@0.1.1'))
  const body = JSON.parse(f.writes[1].options.input)
  assert.equal(body.target_commitish, sha)
  assert.equal(body.body, notes)
  assert.equal(f.gateReads, 3)
  assert.equal(publish(f).state, 'already-released')
  assert.equal(f.writes.length, 2)
})

test('a partial tag can resume on its exact CI SHA; older incomplete tags fail', t => {
  const f = fixture(t)
  f.ref = { object: { type: 'commit', sha } }
  assert.equal(publish(f).state, 'released')
  assert.equal(f.writes.length, 1)
  const g = fixture(t); g.ref = { object: { type: 'commit', sha: older } }
  assert.throws(() => publish(g), /Incomplete older release/)
  assert.equal(g.writes.length, 0)
})

test('ordinary later commits do not retag an existing consistent ancestor release', t => {
  const f = fixture(t)
  f.ref = { object: { type: 'commit', sha: older } }
  f.release = { tag_name: 'foldkit-native@0.1.1', name: 'foldkit-native@0.1.1', body: notes, draft: false, prerelease: false }
  assert.equal(publish(f).state, 'already-released')
  assert.equal(f.writes.length, 0)
})

test('main advancing during a release is rejected before the next write', t => {
  const f = fixture(t)
  const api = (args, options) => {
    const result = f.api(args, options)
    if (args.includes('POST')) f.main = older
    return result
  }
  assert.throws(() => publish({ ...f, api }), /Stale/)
  assert.equal(f.writes.length, 1) // Tag remains honest; release was not created.
})

test('pending changesets, missing notes, unexpected versions, public packages and prereleases cannot release', t => {
  const f = fixture(t)
  const pending = resolve(f.cwd, '.changeset/pending.md')
  writeFileSync(pending, '---\n"foldkit-native": patch\n---\nnotes')
  assert.throws(() => publish(f), /Pending changesets/)
  rmSync(pending)
  writeFileSync(resolve(f.cwd, '.changeset/pre.json'), '{}')
  assert.throws(() => publish(f), /Prereleases/)
  rmSync(resolve(f.cwd, '.changeset/pre.json'))
  writeFileSync(resolve(f.cwd, 'CHANGELOG.md'), '# Empty')
  assert.throws(() => publish(f), /no changelog entry/)
  rmSync(resolve(f.cwd, 'CHANGELOG.md'))
  assert.equal(publish(f).state, 'unversioned')
  for (const change of [{ private: false }, { name: 'other' }, { workspaces: ['packages/*'] }, { version: '0.1.1-beta.1' }]) {
    writeFileSync(resolve(f.cwd, 'package.json'), JSON.stringify({ ...pkg, ...change }))
    assert.throws(() => publish(f), /topology or version/)
  }
  assert.equal(f.writes.length, 0)
})

test('bad tags, releases, dirty checkouts and non-workflow invocations fail without writes', t => {
  const f = fixture(t)
  f.ref = { object: { type: 'tag', sha } }
  assert.throws(() => publish(f), /Unexpected tag/)
  f.ref = { object: { type: 'commit', sha } }
  f.release = { tag_name: 'foldkit-native@0.1.1', name: 'foldkit-native@0.1.1', body: 'Different notes' }
  assert.throws(() => publish(f), /metadata differs/)
  assert.throws(() => publish({ ...f, execute: (file, args) => args[0] === 'status' ? ' M package.json' : f.execute(file, args) }), /clean/)
  assert.throws(() => publish({ ...f, env: { ...f.env, GITHUB_EVENT_NAME: 'push' } }), /workflow_run/)
  assert.throws(() => publish({ ...f, env: { ...f.env, GITHUB_SHA: older } }), /context SHA/)
  assert.equal(f.writes.length, 0)
})

test('a mismatched root lockfile blocks release before any GitHub mutation', t => {
  const f = fixture(t)
  writeFileSync(resolve(f.cwd, 'package-lock.json'), JSON.stringify({ name: pkg.name, version: '0.1.0', packages: { '': pkg } }))
  assert.throws(() => publish(f), /lockfile version differs/)
  assert.equal(f.writes.length, 0)
})

test('missing GitHub objects are distinct from authentication, API and transport failures', () => {
  const failure = stderr => () => { throw Object.assign(new Error('API failed'), { stderr }) }
  assert.equal(github(['missing'], {}, failure('gh: Not Found (HTTP 404)')), null)
  for (const stderr of ['(HTTP 401)', '(HTTP 403)', '(HTTP 500)', 'network timeout']) {
    assert.throws(() => github(['missing'], {}, failure(stderr)))
  }
  assert.throws(() => github(['write', '--method', 'POST'], {}, failure('(HTTP 404)')))
})

test('real Changesets consumes root-only private version metadata and keeps lock/subpackages consistent', t => {
  const cwd = mkdtempSync(resolve(tmpdir(), 'changesets-version-'))
  t.after(() => rmSync(cwd, { recursive: true, force: true }))
  // CI checkouts can be shallow and detached. Give the fixture its own Git
  // metadata so Changesets never tries to deepen the caller's local clone.
  command('git', ['init', '--quiet', cwd])
  for (const file of ['package.json', 'package-lock.json', 'scripts/release.mjs', '.changeset/config.json',
    'packages/ui/package.json', 'packages/foldkit-gpuix/package.json']) {
    mkdirSync(dirname(resolve(cwd, file)), { recursive: true })
    cpSync(resolve(root, file), resolve(cwd, file))
  }
  symlinkSync(resolve(root, 'node_modules'), resolve(cwd, 'node_modules'))
  writeFileSync(resolve(cwd, '.changeset/test-source-release.md'), '---\n"foldkit-native": patch\n---\n\nGitHub source releases test fixture.\n')
  const before = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'))
  const nextVersion = before.version.replace(/\d+$/, patch => String(Number(patch) + 1))
  const originals = ['packages/ui/package.json', 'packages/foldkit-gpuix/package.json'].map(file => readFileSync(resolve(cwd, file), 'utf8'))
  const isolatedEnv = { ...process.env, GITHUB_ACTIONS: 'false', PATH: `${dirname(process.execPath)}:${process.env.PATH}` }
  command(process.execPath, [resolve(cwd, 'scripts/release.mjs'), 'version'], { cwd, env: isolatedEnv })
  const current = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'))
  const locked = JSON.parse(readFileSync(resolve(cwd, 'package-lock.json'), 'utf8'))
  assert.equal(current.version, nextVersion)
  assert.equal(current.private, true)
  assert.equal(locked.version, current.version)
  assert.equal(locked.packages[''].version, current.version)
  assert.equal(releasePlan(cwd).tag, `foldkit-native@${nextVersion}`)
  assert.match(releasePlan(cwd).notes, /GitHub source releases/)
  assert.deepEqual(['packages/ui/package.json', 'packages/foldkit-gpuix/package.json'].map(file => readFileSync(resolve(cwd, file), 'utf8')), originals)
})

test('workflow uses the version PR action without npm publication and retains the main CI contract', () => {
  const workflow = readFileSync(resolve(root, '.github/workflows/release.yml'), 'utf8')
  assert.match(workflow, /actions: read/)
  assert.match(workflow, /version: npm run version:packages/)
  assert.match(workflow, /outputs\.hasChangesets == 'false'/)
  assert.match(workflow, /createGithubReleases: false/)
  assert.doesNotMatch(workflow, /publish:|id-token:|NPM_TOKEN|npm-production|workflow_dispatch:/)
  const source = readFileSync(resolve(root, 'scripts/release.mjs'), 'utf8')
  assert.doesNotMatch(source, /npm.*publish|changeset.*publish/)
  const ci = readFileSync(resolve(root, '.github/workflows/ci.yml'), 'utf8')
  assert.match(ci, /push:\n\s+branches: \[main\]/)
})
