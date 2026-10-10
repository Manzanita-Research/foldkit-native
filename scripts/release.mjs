import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, existsSync, realpathSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const shaPattern = /^[a-f0-9]{40}$/
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/

export function command(file, args, options = {}) {
  return (execFileSync(file, args, { encoding: 'utf8', ...options }) ?? '').trim()
}

export function github(args, options = {}, execute = command) {
  try {
    const result = execute('gh', ['api', ...args], options)
    return result ? JSON.parse(result) : null
  } catch (error) {
    // A missing ref/release is expected; auth, transport and API errors are not.
    if (args.length === 1 && /\(HTTP 404\)/.test(String(error.stderr))) return null
    throw error
  }
}

export function validateGate(event, run, main, checkout, repository) {
  const requested = event?.workflow_run
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !shaPattern.test(checkout ?? '')) {
    throw new Error('Invalid repository or checkout identity')
  }
  for (const record of [requested, run]) {
    if (record?.name !== 'CI' || record.status !== 'completed' || record.conclusion !== 'success' ||
        record.event !== 'push' || record.head_branch !== 'main' ||
        !Number.isSafeInteger(record.run_attempt) || record.run_attempt <= 0 ||
        record.head_repository?.full_name !== repository || !shaPattern.test(record.head_sha ?? '')) {
      throw new Error('Release requires successful same-repository main push CI')
    }
  }
  if (event.repository?.full_name !== repository || run.repository?.full_name !== repository ||
      run.path !== '.github/workflows/ci.yml' || !Number.isSafeInteger(requested.id) ||
      requested.id !== run.id || requested.run_attempt !== run.run_attempt ||
      requested.head_sha !== run.head_sha || checkout !== run.head_sha || main !== checkout) {
    throw new Error('Stale or unrelated CI run, or checkout mismatch')
  }
  return checkout
}

export function gate({ env = process.env, cwd = process.cwd(), api = github, execute = command } = {}) {
  if (env.GITHUB_EVENT_NAME !== 'workflow_run') throw new Error('Only workflow_run may release')
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'))
  const repository = env.GITHUB_REPOSITORY
  const id = event.workflow_run?.id
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid CI run ID')
  const run = api([`repos/${repository}/actions/runs/${id}`])
  const main = api([`repos/${repository}/git/ref/heads/main`])?.object?.sha
  const checkout = execute('git', ['rev-parse', 'HEAD'], { cwd })
  validateGate(event, run, main, checkout, repository)
  // Changesets/action uses github.context.sha when preparing its version branch.
  if (env.GITHUB_SHA !== checkout) throw new Error('Workflow context SHA differs from gated checkout')
  return { sha: checkout, repository, runId: id }
}

export function changelogNotes(changelog, version) {
  const escaped = version.replaceAll('.', '\\.')
  const section = changelog.match(new RegExp(`^## ${escaped}\\r?\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm'))
  if (!section?.[1].trim()) throw new Error('Current version has no changelog entry')
  return section[1].trim()
}

export function releasePlan(cwd = process.cwd()) {
  const pkg = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'))
  if (pkg.name !== 'foldkit-native' || pkg.private !== true || pkg.workspaces ||
      !versionPattern.test(pkg.version)) throw new Error('Unexpected source-release topology or version')
  const lock = JSON.parse(readFileSync(resolve(cwd, 'package-lock.json'), 'utf8'))
  if (lock.name !== pkg.name || lock.version !== pkg.version ||
      lock.packages?.['']?.version !== pkg.version) throw new Error('Root lockfile version differs')
  const changesets = readdirSync(resolve(cwd, '.changeset'))
    .filter(name => name.endsWith('.md') && name !== 'README.md')
  if (changesets.length) throw new Error('Pending changesets must be consumed in a version PR')
  if (existsSync(resolve(cwd, '.changeset/pre.json'))) throw new Error('Prereleases are not enabled')
  const path = resolve(cwd, 'CHANGELOG.md')
  if (!existsSync(path)) return null // Initial setup is not itself a versioned release.
  const changelog = readFileSync(path, 'utf8')
  return { version: pkg.version, tag: `${pkg.name}@${pkg.version}`, notes: changelogNotes(changelog, pkg.version) }
}

export function publish({ cwd = process.cwd(), env = process.env, api = github,
  execute = command, dryRun = false } = {}) {
  const check = () => gate({ cwd, env, api, execute })
  const identity = check()
  if (execute('git', ['status', '--porcelain'], { cwd })) throw new Error('Release checkout must be clean')
  const plan = releasePlan(cwd)
  if (!plan) return { state: 'unversioned' }
  const prefix = `repos/${identity.repository}`
  const reference = `${prefix}/git/ref/tags/${encodeURIComponent(plan.tag)}`
  const releasePath = `${prefix}/releases/tags/${encodeURIComponent(plan.tag)}`
  const ref = api([reference])
  const release = api([releasePath])
  if (release && !ref) throw new Error('Release has no matching tag')
  if (ref) {
    // Only lightweight source-release tags owned by this flow are accepted.
    if (ref.object.type !== 'commit' || !shaPattern.test(ref.object.sha)) throw new Error('Unexpected tag target')
    const tagged = ref.object.sha
    execute('git', ['merge-base', '--is-ancestor', tagged, identity.sha], { cwd })
    const oldPkg = JSON.parse(execute('git', ['show', `${tagged}:package.json`], { cwd }))
    if (oldPkg.name !== 'foldkit-native' || oldPkg.version !== plan.version || oldPkg.private !== true) {
      throw new Error('Tag version does not match the release')
    }
    const oldLog = execute('git', ['show', `${tagged}:CHANGELOG.md`], { cwd })
    if (changelogNotes(oldLog, plan.version) !== plan.notes) throw new Error('Tagged changelog differs')
    if (release) {
      if (release.draft || release.prerelease || release.tag_name !== plan.tag ||
          release.name !== plan.tag || release.body !== plan.notes) throw new Error('Existing release metadata differs')
      return { state: 'already-released', ...plan, sha: tagged }
    }
    if (tagged !== identity.sha) throw new Error('Incomplete older release needs explicit recovery')
  }
  if (dryRun) return { state: ref ? 'create-release' : 'create-tag-and-release', ...plan, ...identity }
  if (!ref) {
    check() // Re-read current main and successful CI immediately before each write.
    api([`${prefix}/git/refs`, '--method', 'POST', '-f', `ref=refs/tags/${plan.tag}`, '-f', `sha=${identity.sha}`])
  }
  check()
  api([`${prefix}/releases`, '--method', 'POST', '--input', '-'], {
    input: JSON.stringify({ tag_name: plan.tag, target_commitish: identity.sha,
      name: plan.tag, body: plan.notes, draft: false, prerelease: false, make_latest: 'true' }),
  })
  return { state: 'released', ...plan, ...identity }
}

export function version({ cwd = process.cwd(), env = process.env, execute = command } = {}) {
  if (env.GITHUB_ACTIONS === 'true') gate({ cwd, env, execute })
  execute(process.execPath, [resolve(cwd, 'node_modules/@changesets/cli/bin.js'), 'version'], { cwd, stdio: 'inherit' })
  execute('npm', ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd, stdio: 'inherit' })
}

if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href) {
  const mode = process.argv[2]
  if (mode === 'version') version()
  else if (mode === 'check') {
    const identity = gate()
    console.log(JSON.stringify(identity))
  } else if (mode === 'publish') console.log(JSON.stringify(publish({ dryRun: process.argv.includes('--dry-run') })))
  else throw new Error('Use check, version, or publish [--dry-run]')
}
