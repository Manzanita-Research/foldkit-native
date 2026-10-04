// From FoldKit's examples/snake/src/domain/direction.ts, unchanged (MIT, © 2025 Devin Jameson; see examples/FOLDKIT-LICENSE).
// https://github.com/foldkit/foldkit/tree/main/examples/snake

import { Match, Schema } from 'effect'

export const Direction = Schema.Literals(['Up', 'Down', 'Left', 'Right'])
export type Direction = typeof Direction.Type

export const opposite = (direction: Direction): Direction =>
  Match.value(direction).pipe(
    Match.withReturnType<Direction>(),
    Match.when('Up', () => 'Down'),
    Match.when('Down', () => 'Up'),
    Match.when('Left', () => 'Right'),
    Match.when('Right', () => 'Left'),
    Match.exhaustive,
  )

export const isOpposite = (a: Direction, b: Direction): boolean =>
  opposite(a) === b
