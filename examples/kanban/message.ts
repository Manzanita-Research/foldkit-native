// From FoldKit's examples/kanban/src/message.ts, unchanged (MIT, © 2025 Devin Jameson; see examples/FOLDKIT-LICENSE).
// https://github.com/foldkit/foldkit/tree/main/examples/kanban

import { Schema } from 'effect'
import { defineMessageUnion } from 'foldkit/message'

import { DragAndDrop } from '@foldkit/ui'

export const Message = defineMessageUnion({
  GotDragAndDropMessage: { message: DragAndDrop.Message },
  ClickedAddCard: { columnId: Schema.String },
  ChangedNewCardTitle: { value: Schema.String },
  SubmittedNewCard: {},
  CancelledNewCard: {},
  CompletedGenerateCardId: {
    cardId: Schema.String,
    columnId: Schema.String,
    title: Schema.String,
  },
  CompletedSaveBoard: {},
  CompletedFocusAddCardInput: {},
})

export type Message = typeof Message.Type
