// KEYBOARD
//
// Arrow-key movement shared by the composite widgets with a roving tabindex
// (RadioGroup, Tabs), as @foldkit/ui's: next and previous wrap and skip
// disabled items; Home/Page Up and End/Page Down go to the first and last
// enabled ones. Any other key stays where it is.

const wrap = (index: number, length: number) => ((index % length) + length) % length

/** The first enabled index from `start`, stepping by `direction` and
 *  wrapping; `fallback` when every item is disabled. */
const firstEnabled = (count: number, fallback: number, isDisabled: (index: number) => boolean) =>
  (start: number, direction: 1 | -1): number => {
    for (let step = 0; step < count; step++) {
      const index = wrap(start + step * direction, count)
      if (!isDisabled(index)) return index
    }
    return fallback
  }

/** Where `key` moves from `current`. */
export const keyToIndex = (
  nextKey: string,
  previousKey: string,
  count: number,
  current: number,
  isDisabled: (index: number) => boolean,
) => {
  const find = firstEnabled(count, current, isDisabled)
  return (key: string): number => {
    if (key === nextKey) return find(current + 1, 1)
    if (key === previousKey) return find(current - 1, -1)
    if (key === 'Home' || key === 'PageUp') return find(0, 1)
    if (key === 'End' || key === 'PageDown') return find(count - 1, -1)
    return current
  }
}
