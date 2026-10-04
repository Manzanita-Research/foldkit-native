// SHEET
//
// Styles without a cascade engine. A sheet is a flat list of rules whose
// selectors look at one element only: its tag, classes, attributes and state
// (`.button`, `.switch[data-checked]`, `.item:hover`, `input:disabled`). That
// is what atomic CSS (Tailwind's utilities) and data-attribute styling
// (Base UI, @foldkit/ui's `data-checked`) mostly are, and it needs no
// selector matching against ancestors, so a restyle is per element.
//
// Not supported, and reported by `sheetFromCss` as `unsupported`: descendant
// and child combinators (`.card .title`, Tailwind's `group-hover:`,
// `space-y-4`), sibling combinators, `::before`/`::after`, and `@media`
// queries other than width and hover. Custom properties are, and inherit as
// in CSS, so themes switch by changing tokens.
//
// `:hover` and `:active` become GPUI's own state styles (no round trip
// through the app). `:focus` and `:focus-visible` follow GPUI's focus (host.ts).

import type { StyleDesc } from '@gpuix/native/host'
import { boxStyle, px, resolveVars, textStyle } from 'foldkit-native/style'

import { type NativeElement, type Selector, matches, parseSelector } from './dom.ts'

export type State = 'base' | 'hover' | 'active' | 'focus' | 'focus-visible'
export type Rule = Readonly<{ source: string; selector: Selector; state: State; declarations: ReadonlyMap<string, string> }>
export type Sheet = Readonly<{ rules: ReadonlyArray<Rule>; unsupported: ReadonlyArray<string> }>

const STATES: ReadonlyArray<readonly [string, State]> = [
  [':focus-visible', 'focus-visible'], [':focus', 'focus'], [':hover', 'hover'], [':active', 'active'],
]

/** One selector → a rule's selector and state, or why it can't be one. */
const ruleSelector = (raw: string): { selector: Selector; state: State } | { unsupported: string } => {
  let source = raw.trim()
  if (source === ':root' || source === 'html') source = 'html'
  let state: State = 'base'
  for (const [pseudo, name] of STATES) {
    if (source.endsWith(pseudo)) {
      state = name
      source = source.slice(0, -pseudo.length) || '*'
      break
    }
  }
  if (/::|:(before|after|placeholder|first-line|selection)/.test(source)) return { unsupported: 'pseudo-element' }
  if (/[+~]/.test(source.replace(/\[[^\]]*\]/g, ''))) return { unsupported: 'sibling combinator' }
  const withoutBrackets = source.replace(/\[[^\]]*\]|\([^)]*\)/g, '')
  if (/\s|>/.test(withoutBrackets.trim())) return { unsupported: 'descendant combinator' }
  if (/:(hover|active|focus)/.test(source)) return { unsupported: 'state not on the element itself' }
  return { selector: parseSelector(source), state }
}

/** Declarations, `!important` dropped, shorthands expanded to the longhands
 *  the style conversion reads. */
export const declarations = (entries: Iterable<readonly [string, string]>): Map<string, string> => {
  const out = new Map<string, string>()
  for (const [rawName, rawValue] of entries) {
    const name = rawName.trim()
    const value = rawValue.replace(/\s*!important\s*$/, '').trim()
    if (name === '' || value === '') continue
    for (const [longhand, longValue] of expand(name, value)) out.set(longhand, longValue)
  }
  return out
}

/** A sheet from a plain object: `{ '.button': { padding: '8px 12px' } }`. */
export const sheetFromObject = (rules: Readonly<Record<string, Readonly<Record<string, string>>>>): Sheet => {
  const out: Array<Rule> = []
  const unsupported: Array<string> = []
  for (const [selectors, body] of Object.entries(rules)) addRule(out, unsupported, selectors, declarations(Object.entries(body)))
  return { rules: out, unsupported }
}

const addRule = (out: Array<Rule>, unsupported: Array<string>, selectors: string, body: Map<string, string>) => {
  for (const one of splitTopLevel(selectors)) {
    const parsed = ruleSelector(one)
    if ('unsupported' in parsed) unsupported.push(`${one.trim()} (${parsed.unsupported})`)
    else out.push({ source: one.trim(), selector: parsed.selector, state: parsed.state, declarations: body })
  }
}

/** A sheet from CSS text. `viewportWidth` decides width media queries. */
export const sheetFromCss = (css: string, options: { viewportWidth?: number } = {}): Sheet => {
  const rules: Array<Rule> = []
  const unsupported: Array<string> = []
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const block = (text: string) => {
    let at = 0
    while (at < text.length) {
      const open = text.indexOf('{', at)
      if (open === -1) break
      const prelude = text.slice(at, open).trim()
      let depth = 1
      let end = open + 1
      for (; end < text.length && depth > 0; end++) {
        if (text[end] === '{') depth++
        else if (text[end] === '}') depth--
      }
      const body = text.slice(open + 1, end - 1)
      at = end
      if (prelude.startsWith('@media')) {
        const media = mediaMatches(prelude.slice(6), options.viewportWidth ?? 1024)
        if (media === true) block(body)
        else if (media === undefined) unsupported.push(`${prelude} (media query)`)
      } else if (prelude.startsWith('@layer') || prelude.startsWith('@supports')) block(body)
      else if (prelude.startsWith('@')) continue
      else addRule(rules, unsupported, prelude, declarations(splitDeclarations(body)))
    }
  }
  block(source)
  return { rules, unsupported }
}

/** Whether a media query holds: true or false for hover and widths (fixed
 *  at the window's width for now), undefined for anything else. */
const mediaMatches = (query: string, width: number): boolean | undefined => {
  if (/hover\s*:\s*hover|pointer\s*:\s*fine/.test(query)) return true
  const min = /min-width\s*:\s*([\d.]+(?:px|rem|em))|width\s*>=\s*([\d.]+(?:px|rem|em))/.exec(query)
  const max = /max-width\s*:\s*([\d.]+(?:px|rem|em))|width\s*<\s*([\d.]+(?:px|rem|em))/.exec(query)
  if (min === null && max === null) return undefined
  return (min === null || width >= (px(min[1] ?? min[2]!) ?? 0)) && (max === null || width <= (px(max[1] ?? max[2]!) ?? Infinity))
}

const splitDeclarations = (body: string): Array<[string, string]> =>
  splitTopLevel(body, ';').flatMap(part => {
    const colon = part.indexOf(':')
    return colon <= 0 ? [] : [[part.slice(0, colon).trim(), part.slice(colon + 1).trim()] as [string, string]]
  })

const splitTopLevel = (value: string, separator = ','): Array<string> => {
  const parts: Array<string> = []
  let depth = 0
  let start = 0
  for (let i = 0; i < value.length; i++) {
    const char = value[i]
    if (char === '(' || char === '[') depth++
    else if (char === ')' || char === ']') depth--
    else if (char === separator && depth === 0) {
      parts.push(value.slice(start, i))
      start = i + 1
    }
  }
  parts.push(value.slice(start))
  return parts.map(part => part.trim()).filter(Boolean)
}

const SIDES = ['top', 'right', 'bottom', 'left'] as const
const CORNERS = ['top-left', 'top-right', 'bottom-right', 'bottom-left'] as const
/** `1px 2px` → the four values CSS's box shorthands mean. */
const four = (value: string): [string, string, string, string] => {
  const parts = splitTopLevel(value, ' ')
  const [a = '', b = a, c = a, d = b] = parts
  return [a, b, c, d]
}

const expand = (name: string, value: string): Array<[string, string]> => {
  switch (name) {
    case 'padding': case 'margin': {
      const values = four(value)
      return SIDES.map((side, i) => [`${name}-${side}`, values[i]!])
    }
    case 'inset': {
      const values = four(value)
      return SIDES.map((side, i) => [side, values[i]!])
    }
    case 'border-radius': {
      const values = four(value.split('/')[0]!)
      return CORNERS.map((corner, i) => [`border-${corner}-radius`, values[i]!])
    }
    case 'border-width': case 'border-color': {
      const values = four(value)
      const which = name.slice(7)
      return SIDES.map((side, i) => [`border-${side}-${which}`, values[i]!])
    }
    case 'border': case 'border-top': case 'border-right': case 'border-bottom': case 'border-left': {
      const sides = name === 'border' ? SIDES : [name.slice(7)]
      if (value === 'none' || value === '0') return sides.map(side => [`border-${side}-width`, '0'])
      const parts = splitTopLevel(value, ' ')
      const width = parts.find(part => /^[\d.]/.test(part) || /^(thin|medium|thick)$/.test(part)) ?? '1px'
      const color = parts.find(part => part !== width && !/^(solid|dashed|dotted|double|none)$/.test(part))
      return sides.flatMap(side => [
        [`border-${side}-width`, width === 'thin' ? '1px' : width === 'medium' ? '3px' : width === 'thick' ? '5px' : width] as [string, string],
        ...(color === undefined ? [] : [[`border-${side}-color`, color] as [string, string]]),
      ])
    }
    case 'gap': {
      const [row = '', column = row] = splitTopLevel(value, ' ')
      return row === column ? [['gap', row]] : [['row-gap', row], ['column-gap', column]]
    }
    case 'flex': {
      if (value === 'none') return [['flex-grow', '0'], ['flex-shrink', '0']]
      if (value === 'auto') return [['flex-grow', '1'], ['flex-shrink', '1']]
      const [grow = '0', shrink = '1'] = splitTopLevel(value, ' ')
      return [['flex-grow', grow], ['flex-shrink', /^[\d.]+$/.test(shrink) ? shrink : '1']]
    }
    case 'overflow': {
      // GPUI scrolls `scroll` only; `auto` means "scroll if it doesn't fit",
      // which is what GPUI's scroll does anyway.
      const [x = '', y = x] = splitTopLevel(value, ' ').map(scrolls)
      return [['overflow-x', x], ['overflow-y', y]]
    }
    case 'overflow-x': case 'overflow-y': return [[name, scrolls(value)]]
    case 'background':
      return /gradient\(/.test(value) ? [['background-image', value]] : [['background-color', value]]
    default:
      return [[name, value]]
  }
}
const scrolls = (value: string) => (value === 'auto' || value === 'overlay' ? 'scroll' : value)

// RESOLVED STYLE

/** Properties a child takes from its parent, as in CSS. */
export const INHERITED = [
  'color', 'font-family', 'font-size', 'font-weight', 'line-height', 'white-space',
  'text-align', 'user-select', 'text-transform', 'cursor',
] as const

/** What the browser's own stylesheet would give. */
export const userAgentSheet = sheetFromCss(`
  html { font-family: system-ui; font-size: 16px; color: #000000; }
  body { user-select: none; height: 100%; overflow-y: scroll; }
  [hidden] { display: none; }
  dialog:not([open]) { display: none; }
  h1 { font-size: 32px; font-weight: 700; }
  h2 { font-size: 24px; font-weight: 700; }
  h3 { font-size: 19px; font-weight: 700; }
  h4 { font-weight: 700; }
  strong, b { font-weight: 700; }
  button { text-align: center; }
  input, textarea { user-select: text; cursor: text; }
`)

export type Declared = Readonly<{
  /** The matching rules' declarations, in cascade order, with their state. */
  rules: ReadonlyArray<Readonly<{ state: State; declarations: ReadonlyMap<string, string> }>>
  inline: ReadonlyMap<string, string>
  /** `fold(…, ['base'])`: what applies at rest. */
  base: Map<string, string>
  has: (state: State) => boolean
}>

/** Every rule that applies to `element`, in cascade order: the user-agent
 *  sheet, then the app's sheets in order, then inline style. Rules for a
 *  state (`:hover`, `:focus`) keep their place in that order, so a later
 *  rule of the same weight wins, as in CSS. */
export const declared = (element: NativeElement, sheets: ReadonlyArray<Sheet>): Declared => {
  const rules: Array<{ state: State; declarations: ReadonlyMap<string, string> }> = []
  for (const sheet of [userAgentSheet, ...sheets]) {
    for (const rule of sheet.rules) if (matches(element, rule.selector, element)) rules.push(rule)
  }
  const inline = declarations(element.inline)
  const out = { rules, inline, has: (state: State) => rules.some(rule => rule.state === state) }
  return { ...out, base: fold(out, ['base']) }
}

/** The declarations that apply in the given states, later rules winning. */
export const fold = (own: Pick<Declared, 'rules' | 'inline'>, states: ReadonlyArray<State>): Map<string, string> => {
  const out = new Map<string, string>()
  for (const rule of own.rules) {
    if (states.includes(rule.state)) for (const [name, value] of rule.declarations) out.set(name, value)
  }
  for (const [name, value] of own.inline) out.set(name, value)
  return out
}

/** A map of declarations as the style conversion reads a computed style. */
export const computed = (values: ReadonlyMap<string, string>) => ({ getPropertyValue: (name: string) => values.get(name) ?? '' })

/** Box style and, for fields, text style, from resolved declarations. */
export const toStyle = (values: ReadonlyMap<string, string>, withText: boolean): StyleDesc => {
  const read = computed(values)
  return { ...boxStyle(read), ...(withText ? textStyle(read) : {}) } as StyleDesc
}

export { resolveVars, textStyle }
