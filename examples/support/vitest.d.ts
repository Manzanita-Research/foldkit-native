// FoldKit's example tests import `vitest`. Under `bun test` that import is
// Bun's own runner (Bun maps it), so FoldKit's test files run unchanged; this
// tells TypeScript the same.
declare module 'vitest' {
  export * from 'bun:test'
}
