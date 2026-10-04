// From FoldKit's examples/kanban/src/domain/card.ts, unchanged (MIT, © 2025 Devin Jameson; see examples/FOLDKIT-LICENSE).
// https://github.com/foldkit/foldkit/tree/main/examples/kanban

import { Schema } from 'effect'

export const Card = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  description: Schema.String,
  sortKey: Schema.String,
})

export type Card = typeof Card.Type
