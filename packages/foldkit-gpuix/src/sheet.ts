// SHEET
//
// Styles without a cascade engine. A sheet is a list of rules; a rule's
// selector is matched against the element and, for descendant and child
// combinators, its ancestors (`.row[data-selected] .cell`, `.list > li`).
// That needs no more than the host already does: any attribute change
// restyles the element's whole subtree, so a child follows its ancestor's
// state. What a restyle can't follow isn't supported, and `sheetFromCss`
// reports it as `unsupported`:
// - sibling combinators (`+`, `~`) and structural pseudo-classes, which
//   depend on siblings that a change doesn't restyle;
// - a state on an ancestor (`.group:hover .x`, Tailwind's `group-hover:`);
// - pseudo-elements (`::before`, `::placeholder`);
// - media features other than sizes, hover, pointer and orientation.
//
// Custom properties are supported, and inherit as in CSS, so themes switch
// by changing tokens. `@media` rules are matched against the window as it is
// now (the host restyles when the window resizes). `@supports` conditions
// are evaluated against what this sheet can draw.
//
// `:hover` and `:active` become GPUI's own state styles (no round trip
// through the app). `:focus` and `:focus-visible` follow GPUI's focus (host.ts).

import type { StyleDesc } from '@gpuix/native/host'
import { boxStyle, px, resolveVars, textStyle } from 'foldkit-native/style'

import { type NativeElement, type Selector, matches, parseSelector } from './dom.ts'
import { type Viewport, mediaQueryMatches } from './media.ts'

export { type Viewport, mediaQueryMatches }

export type State = 'base' | 'hover' | 'active' | 'focus' | 'focus-visible'
export type Rule = Readonly<{
  source: string
  selector: Selector
  state: State
  /** CSS specificity (ids, classes and attributes and pseudo-classes, types). */
  specificity: number
  declarations: ReadonlyMap<string, string>
  /** `!important` declarations: they beat inline style, as in CSS. */
  important: ReadonlyMap<string, string>
  /** The `@media` conditions the rule sits in, all of which must hold. */
  media?: ReadonlyArray<string>
}>
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
  // Escaped characters are part of a name (Tailwind's `.md\:hover\:x`).
  const plain = source.replace(/\\./g, 'x')
  if (/::|:(before|after|placeholder|first-line|first-letter|selection|marker)/.test(plain)) return { unsupported: 'pseudo-element' }
  if (/[+~]/.test(plain.replace(/\[[^\]]*\]|\([^)]*\)/g, ''))) return { unsupported: 'sibling combinator' }
  if (/:(first|last|nth|only)-(child|of-type)|:empty/.test(plain)) return { unsupported: 'structural pseudo-class' }
  if (/:(hover|active|focus)/.test(plain)) return { unsupported: 'state on an ancestor' }
  try {
    return { selector: parseSelector(source), state }
  } catch {
    return { unsupported: 'selector' }
  }
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
  for (const [selectors, body] of Object.entries(rules)) addRule(out, unsupported, selectors, Object.entries(body))
  return { rules: out, unsupported }
}

/** Specificity as one comparable number: ids, then classes, attributes and
 *  pseudo-classes, then types (each part capped well below the next). */
const specificityOf = (selector: Selector): number => {
  const complex = selector[0] ?? []
  let ids = 0
  let classes = 0
  let types = 0
  for (const { compound } of complex) {
    ids += compound.ids.length
    classes += compound.classes.length + compound.attributes.length + compound.pseudo.filter(name => !name.startsWith('is:')).length
    types += compound.tag === undefined ? 0 : 1
    for (const not of compound.not) {
      const inner = specificityOf(not)
      ids += Math.floor(inner / 10_000)
      classes += Math.floor(inner / 100) % 100
      types += inner % 100
    }
  }
  return ids * 10_000 + classes * 100 + types
}

/** Splits `!important` declarations from the rest. */
const byImportance = (entries: Iterable<readonly [string, string]>) => {
  const normal: Array<[string, string]> = []
  const important: Array<[string, string]> = []
  for (const [name, value] of entries) (/!important\s*$/.test(value) ? important : normal).push([name, value])
  return { normal: declarations(normal), important: declarations(important) }
}

const addRule = (out: Array<Rule>, unsupported: Array<string>, selectors: string, entries: Iterable<readonly [string, string]>, media: ReadonlyArray<string> = []) => {
  const { normal, important } = byImportance(entries)
  for (const one of splitTopLevel(selectors)) {
    const parsed = ruleSelector(one)
    if ('unsupported' in parsed) unsupported.push(`${one.trim()} (${parsed.unsupported})`)
    else {
      out.push({
        source: one.trim(), selector: parsed.selector, state: parsed.state,
        specificity: specificityOf(parsed.selector) + (parsed.state === 'base' ? 0 : 100),
        declarations: normal, important, ...(media.length === 0 ? {} : { media }),
      })
    }
  }
}

/** A sheet from CSS text. `@media` rules keep their conditions and are
 *  matched against the window when an element is styled. */
export const sheetFromCss = (css: string): Sheet => {
  const rules: Array<Rule> = []
  const unsupported: Array<string> = []
  const source = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const block = (text: string, media: ReadonlyArray<string>) => {
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
        const query = prelude.slice(6).trim()
        if (mediaQueryMatches(query, { width: 1024, height: 768 }) === undefined) unsupported.push(`${prelude} (media query)`)
        else block(body, [...media, query])
      } else if (prelude.startsWith('@supports')) {
        if (supports(prelude.slice(9).trim())) block(body, media)
      } else if (prelude.startsWith('@layer')) block(body, media)
      else if (prelude.startsWith('@')) continue
      else addRule(rules, unsupported, prelude, splitDeclarations(body), media)
    }
  }
  block(source, [])
  return { rules, unsupported }
}

/** Whether an `@supports` condition holds for this sheet. A colour holds if
 *  it's one the style conversion can draw; `selector(…)` if the sheet can
 *  match it. Any other declaration holds: one the conversion doesn't read is
 *  ignored where it's used. (Tailwind 4 sniffs for engines without
 *  `@property` with vendor properties, and this is one: its fallback block of
 *  `--tw-*` defaults is what borders and shadows need.) */
const supports = (condition: string): boolean => {
  const text = condition.trim()
  const split = (separator: 'and' | 'or') => {
    const out: Array<string> = []
    let depth = 0
    let start = 0
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '(') depth++
      else if (text[i] === ')') depth--
      else if (depth === 0 && text.startsWith(` ${separator} `, i)) {
        out.push(text.slice(start, i))
        start = i + separator.length + 2
      }
    }
    out.push(text.slice(start))
    return out.length > 1 ? out : undefined
  }
  const or = split('or')
  if (or !== undefined) return or.some(supports)
  const and = split('and')
  if (and !== undefined) return and.every(supports)
  if (/^not\s/.test(text)) return !supports(text.slice(4))
  if (text.startsWith('selector(')) return !('unsupported' in ruleSelector(text.slice(9, -1)))
  if (text.startsWith('(') && text.endsWith(')')) {
    const inner = text.slice(1, -1).trim()
    if (inner.startsWith('(') || /^not\s/.test(inner) || inner.startsWith('selector(')) return supports(inner)
    const colon = inner.indexOf(':')
    if (colon <= 0) return false
    const name = inner.slice(0, colon).trim()
    const value = inner.slice(colon + 1).trim()
    return /color$/.test(name) ? isColorValue(value) : true
  }
  return false
}
/** A colour the style conversion can draw: hex, rgb(a), hsl(a), named, and
 *  oklch/oklab (Tailwind 4's palette); not color-mix() or relative colours. */
const isColorValue = (value: string) =>
  /^(#[0-9a-f]{3,8}|(rgba?|hsla?|oklch|oklab)\([^()]*\)|[a-z]+)$/i.test(value.trim()) &&
  !/^(inherit|initial|unset|revert)$/i.test(value.trim()) && !/\(\s*from\s/.test(value)

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
  /** The matching rules, in cascade order: specificity, then source order. */
  rules: ReadonlyArray<Rule>
  inline: ReadonlyMap<string, string>
  /** `fold(…, ['base'])`: what applies at rest. */
  base: Map<string, string>
  has: (state: State) => boolean
}>

/** Every rule that applies to `element`, in cascade order: the user-agent
 *  sheet, then the app's sheets, ordered by specificity and then source
 *  order, then inline style, then `!important`. Rules for a state (`:hover`,
 *  `:focus`) keep their place in that order, so the stronger rule wins
 *  whatever state it's for, as in CSS. */
export const declared = (element: NativeElement, sheets: ReadonlyArray<Sheet>, viewport: Viewport = { width: 1024, height: 768 }): Declared => {
  const holds = (rule: Rule) => rule.media === undefined || rule.media.every(query => mediaQueryMatches(query, viewport) === true)
  const matching = (sheet: Sheet) => sheet.rules.filter(rule => holds(rule) && matches(element, rule.selector, element))
  // The user agent's rules come before the app's, whatever their weight.
  const app = sheets.flatMap(matching)
    .map((rule, index) => ({ rule, index }))
    .sort((a, b) => a.rule.specificity - b.rule.specificity || a.index - b.index)
    .map(({ rule }) => rule)
  const rules = [...matching(userAgentSheet), ...app]
  const inline = declarations(element.inline)
  const out = { rules, inline, has: (state: State) => rules.some(rule => rule.state === state) }
  return { ...out, base: fold(out, ['base']) }
}

/** The declarations that apply in the given states, stronger rules winning. */
export const fold = (own: Pick<Declared, 'rules' | 'inline'>, states: ReadonlyArray<State>): Map<string, string> => {
  const out = new Map<string, string>()
  for (const rule of own.rules) {
    if (states.includes(rule.state)) for (const [name, value] of rule.declarations) out.set(name, value)
  }
  for (const [name, value] of own.inline) out.set(name, value)
  for (const rule of own.rules) {
    if (states.includes(rule.state)) for (const [name, value] of rule.important) out.set(name, value)
  }
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
