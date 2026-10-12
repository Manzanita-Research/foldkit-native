import { execFileSync } from 'node:child_process'
import { cpSync, lstatSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { root } from './build-packages.mjs'
import { packPackages } from './pack-packages.mjs'

export function checkPackages(destination, keep = false) {
  const consumer = mkdtempSync(join(tmpdir(), 'foldkit-package-consumer-'))
  const environment = { ...process.env }
  delete environment.NODE_PATH
  delete environment.NODE_OPTIONS
  delete environment.BUN_OPTIONS
  delete environment.TS_NODE_PROJECT
  const execute = (file, args) => execFileSync(file, args, {
    cwd: consumer, env: environment, encoding: 'utf8', timeout: 120_000, stdio: ['ignore', 'pipe', 'pipe'],
  })
  try {
    const packed = packPackages(destination)
    const artifacts = destination ?? resolve(root, 'dist/packages')
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'foldkit-package-consumer', private: true, type: 'module' }))
    execute('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund',
      ...packed.packages.map(pkg => join(artifacts, pkg.filename)),
      'effect@4.0.0', 'foldkit@0.165.0', 'typescript@5.9.3', '@types/node@25.9.9'])
    // No workspace links: all installed packages must be real files from the tarballs.
    const inspect = directory => {
      for (const name of readdirSync(directory)) {
        const path = join(directory, name)
        const stat = lstatSync(path)
        if (stat.isSymbolicLink() && name !== '.bin' && !directory.endsWith('/.bin')) throw new Error(`Consumer contains a symlink: ${path}`)
        if (stat.isDirectory() && name !== '.bin') inspect(path)
      }
    }
    inspect(join(consumer, 'node_modules'))
    for (const filename of ['runtime.mjs', 'types.ts', 'lazy.mjs']) cpSync(join(root, 'test/package-consumer', filename), join(consumer, filename))
    writeFileSync(join(consumer, 'fake-gpui.js'), ts.transpileModule(readFileSync(join(root, 'test/support/fake-gpui.ts'), 'utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
    }).outputText)
    const results = []
    for (const resolution of ['NodeNext', 'Bundler']) {
      const config = { compilerOptions: {
        target: 'ES2023', module: resolution === 'NodeNext' ? 'NodeNext' : 'ESNext', moduleResolution: resolution,
        strict: true, noEmit: true, skipLibCheck: false, types: ['node'], lib: ['ES2023', 'DOM', 'DOM.Iterable'],
      }, files: ['types.ts'] }
      const filename = `tsconfig.${resolution.toLowerCase()}.json`
      writeFileSync(join(consumer, filename), JSON.stringify(config, null, 2))
      execute(process.execPath, ['node_modules/typescript/bin/tsc', '-p', filename])
      results.push(`TypeScript ${resolution}: passed`)
    }
    for (const runtime of [process.execPath, 'bun']) {
      results.push(`${runtime}: ${execute(runtime, ['runtime.mjs']).trim()}`)
    }
    // Import-only use of the adapter and UI must remain lazy about native startup.
    const platformPackages = readdirSync(join(consumer, 'node_modules/@gpuix')).filter(name => name.startsWith('native-'))
    for (const name of platformPackages) renameSync(join(consumer, 'node_modules/@gpuix', name), join(consumer, `hidden-${name}`))
    try {
      for (const runtime of [process.execPath, 'bun']) results.push(`${runtime}: ${execute(runtime, ['lazy.mjs']).trim()}`)
    } finally {
      for (const name of platformPackages) renameSync(join(consumer, `hidden-${name}`), join(consumer, 'node_modules/@gpuix', name))
    }
    execute('npm', ['ls', 'effect', 'foldkit', 'foldkit-native', 'foldkit-gpuix', '@foldkit-native/ui', '@gpuix/native'])
    const report = { checkedAt: new Date().toISOString(), consumer, sourceSha: packed.sourceSha, packages: packed.packages, results }
    writeFileSync(join(artifacts, 'consumer-check.json'), JSON.stringify(report, null, 2) + '\n')
    console.log(JSON.stringify(report, null, 2))
    return report
  } catch (error) {
    console.error(`Consumer check failed in ${consumer}`)
    if (error.stdout) console.error(String(error.stdout))
    if (error.stderr) console.error(String(error.stderr))
    throw error
  } finally {
    if (!keep) rmSync(consumer, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkPackages(process.argv[2] && !process.argv[2].startsWith('--') ? resolve(process.argv[2]) : undefined, process.argv.includes('--keep'))
}
