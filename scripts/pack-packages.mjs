import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackages, packageDirectories, root } from './build-packages.mjs'

export function packPackages(destination = resolve(root, 'dist/packages')) {
  buildPackages()
  mkdirSync(destination, { recursive: true })
  const packages = packageDirectories.map(directory => {
    const cwd = resolve(root, directory)
    const [pack] = JSON.parse(execFileSync('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', destination], {
      cwd, encoding: 'utf8', timeout: 60_000,
    }))
    const manifest = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'))
    // A fresh build and a narrow allowlist, with every public target actually present.
    const files = new Set(pack.files.map(file => file.path))
    for (const conditions of Object.values(manifest.exports)) {
      for (const target of Object.values(conditions)) {
        if (!files.has(target.replace(/^\.\//, ''))) throw new Error(`${pack.name}: omitted export ${target}`)
      }
    }
    if (!files.has('LICENSE') || !files.has('README.md')) throw new Error(`${pack.name}: omitted package documentation`)
    for (const path of files) {
      if (!/^(dist\/[^/]+\.(js|d\.ts)|package\.json|LICENSE|README\.md|CAPABILITIES\.md|EVENTS\.md|MIGRATING\.md)$/.test(path)) {
        throw new Error(`${pack.name}: unexpected published file ${path}`)
      }
    }
    if (pack.bundled?.length) throw new Error(`${pack.name}: bundled dependencies`)
    console.log(`Packed ${pack.filename} (${pack.size} bytes)`)
    return { name: pack.name, version: pack.version, filename: pack.filename, size: pack.size, integrity: pack.integrity, shasum: pack.shasum }
  })
  const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  const result = { sourceSha, builtAt: new Date().toISOString(), packages }
  writeFileSync(resolve(destination, 'packages.json'), JSON.stringify(result, null, 2) + '\n')
  return result
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) packPackages(process.argv[2] && resolve(process.argv[2]))
