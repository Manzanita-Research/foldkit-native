// MEDIA QUERIES, for the sheet's @media rules and window.matchMedia alike.

/** "640px" → 640, "40rem"/"40em" → 640 (16px), anything else → NaN. */
const length = (value: string) => {
  const match = /^(-?[\d.]+)(px|r?em)?$/.exec(value.trim())
  return match === null ? NaN : Number(match[1]) * (match[2] === 'rem' || match[2] === 'em' ? 16 : 1)
}

export type Viewport = Readonly<{ width: number; height: number }>

/** Whether a media query holds in a window this size: sizes (`min-width`,
 *  `width >= …`), hover and a fine pointer (a desktop), orientation, and no
 *  reduced-motion or dark preference. undefined for a feature it doesn't
 *  know, so the rule is reported rather than guessed. */
export const mediaQueryMatches = (query: string, { width, height }: Viewport): boolean | undefined => {
  let unknown = false
  const one = (part: string): boolean => {
    let text = part.trim().replace(/^only\s+/, '')
    const negated = /^not\s+/.test(text)
    text = text.replace(/^not\s+/, '').replace(/^(screen|all)\s*(and\s*)?/, '')
    if (/^print\b/.test(text)) return negated
    if (text === '') return !negated
    const holds = text.split(/\s+and\s+/).every(feature => {
      const range = /^\(\s*(width|height)\s*(>=|<=|>|<)\s*([\d.]+(?:px|r?em))\s*\)$/.exec(feature.trim())
      if (range !== null) {
        const actual = range[1] === 'width' ? width : height
        const limit = length(range[3]!)
        return range[2] === '>=' ? actual >= limit : range[2] === '<=' ? actual <= limit : range[2] === '>' ? actual > limit : actual < limit
      }
      const match = /^\(\s*([a-z-]+)\s*(?::\s*([^)]+?))?\s*\)$/.exec(feature.trim())
      if (match === null) {
        unknown = true
        return false
      }
      const value = match[2]?.trim()
      const size = value === undefined ? NaN : length(value)
      switch (match[1]) {
        case 'min-width': return width >= size
        case 'max-width': return width <= size
        case 'min-height': return height >= size
        case 'max-height': return height <= size
        case 'hover': case 'any-hover': return value === undefined || value === 'hover'
        case 'pointer': case 'any-pointer': return value === undefined || value === 'fine'
        case 'orientation': return value === (width >= height ? 'landscape' : 'portrait')
        case 'prefers-reduced-motion': return value === 'no-preference'
        case 'prefers-color-scheme': return value === 'light'
        default:
          unknown = true
          return false
      }
    })
    return negated ? !holds : holds
  }
  const result = query.split(',').some(one)
  return unknown ? undefined : result
}

