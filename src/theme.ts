// THEME
//
// Semantic tokens, resolved at render time. A token is a name like
// `color.surface` or `space.3`; it becomes the CSS custom property
// `--fn-color-surface`, and anything (primitives, a UI library, an app's CSS)
// refers to it with `var(--fn-color-surface)` or `token('color.surface')`.
// Setting new tokens restyles the native tree on the next frame, without a
// restart. FoldKit Native ships no theme: tokens come from the app or a UI
// library.

/** Token name → CSS value. Numbers are pixels. */
export type Tokens = Readonly<Record<string, string | number>>

const property = (name: string) => `--fn-${name.replace(/[^a-zA-Z0-9-]/g, '-')}`

/** `token('space.3')` → `var(--fn-space-3)`, with an optional fallback. */
export const token = (name: string, fallback?: string): string =>
  fallback === undefined ? `var(${property(name)})` : `var(${property(name)}, ${fallback})`

/** Tokens as a CSS rule, e.g. for a scoped sub-theme: `tokensToCss(t, '[data-theme="night"]')`. */
export const tokensToCss = (tokens: Tokens, selector = ':root'): string =>
  `${selector} {\n${Object.entries(tokens)
    .map(([name, value]) => `  ${property(name)}: ${typeof value === 'number' ? `${value}px` : value};`)
    .join('\n')}\n}`

/** Installs (or replaces) the document's tokens. The native tree is restyled
 *  automatically because a stylesheet changed. */
export const setTokens = (document: Document, tokens: Tokens, selector = ':root'): void => {
  const id = `fn-tokens-${selector.replace(/[^a-zA-Z0-9]/g, '') || 'root'}`
  let style = document.getElementById(id) as HTMLStyleElement | null
  if (style === null) {
    style = document.createElement('style')
    style.id = id
    document.head.appendChild(style)
  }
  style.textContent = tokensToCss(tokens, selector)
}
