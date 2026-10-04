// From FoldKit's examples/kanban/src/subscription.ts at commit 0b2a4fd (the commit npm's foldkit 0.165.0
// was published from), unchanged (MIT, © 2025 Devin Jameson; see examples/FOLDKIT-LICENSE). At 0ec94a1
// this file uses Subscription.lift's `read`, which came after 0.165.0 (FoldKit #1518).
// https://github.com/foldkit/foldkit/tree/main/examples/kanban

import { Subscription } from 'foldkit'

import { DragAndDrop } from '@foldkit/ui'

import { Message } from './message'
import type { Model } from './model'

export const subscriptions = Subscription.lift({
  dragPointer: DragAndDrop.subscriptions.documentPointer,
  dragEscape: DragAndDrop.subscriptions.documentEscape,
  dragKeyboard: DragAndDrop.subscriptions.documentKeyboard,
  autoScroll: DragAndDrop.subscriptions.autoScroll,
})<Model, Message>({
  toChildModel: model => model.dragAndDrop,
  toParentMessage: message => Message.GotDragAndDropMessage({ message }),
})
