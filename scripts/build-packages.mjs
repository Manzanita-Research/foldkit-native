import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const packageDirectories = ['.', 'packages/foldkit-gpuix', 'packages/ui']

// Keep declarations portable too: TypeScript's extension rewrite only affects JS.
const declarationImports = context => source => {
  const specifier = node => ts.isStringLiteral(node) && /^\.\.?\/.+\.ts$/.test(node.text)
    ? context.factory.createStringLiteral(node.text.replace(/\.ts$/, '.js')) : node
  const visit = node => {
    if (ts.isImportDeclaration(node)) return context.factory.updateImportDeclaration(
      node, node.modifiers, node.importClause, specifier(node.moduleSpecifier), node.attributes)
    if (ts.isExportDeclaration(node)) return context.factory.updateExportDeclaration(
      node, node.modifiers, node.isTypeOnly, node.exportClause,
      node.moduleSpecifier && specifier(node.moduleSpecifier), node.attributes)
    if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) return context.factory.updateImportTypeNode(
      node, context.factory.updateLiteralTypeNode(node.argument, specifier(node.argument.literal)),
      node.attributes, node.qualifier, node.typeArguments, node.isTypeOf)
    return ts.visitEachChild(node, visit, context)
  }
  return ts.visitNode(source, visit)
}

export function buildPackages() {
  for (const directory of packageDirectories) {
    const cwd = resolve(root, directory)
    const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
    const source = join(cwd, 'src')
    const output = join(cwd, 'dist')
    rmSync(output, { recursive: true, force: true })
    const program = ts.createProgram(readdirSync(source).filter(file => file.endsWith('.ts')).map(file => join(source, file)), {
      target: ts.ScriptTarget.ES2023,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      skipLibCheck: true,
      declaration: true,
      noEmitOnError: true,
      rewriteRelativeImportExtensions: true,
      rootDir: source,
      outDir: output,
      lib: ['lib.es2023.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'],
      types: ['bun'],
      // Only the adapter needs the root's public style API. Never emit a sibling's source.
      paths: { 'foldkit-native/style': [join(root, 'dist/style.d.ts')] },
    })
    const diagnostics = ts.getPreEmitDiagnostics(program)
    if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: name => name, getCurrentDirectory: () => root, getNewLine: () => '\n',
    }))
    const result = program.emit(undefined, undefined, undefined, undefined, { afterDeclarations: [declarationImports] })
    if (result.emitSkipped || result.diagnostics.length) throw new Error(`Could not emit ${manifest.name}`)
    console.log(`Built ${manifest.name}@${manifest.version}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) buildPackages()
