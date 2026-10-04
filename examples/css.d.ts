// Bun imports stylesheets as text with `with { type: 'text' }`.
declare module '*.css' {
  const text: string
  export default text
}
