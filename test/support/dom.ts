// `bun test` preload: a DOM before any test file loads, as FoldKit's own tests
// get from Vitest's `environment: 'happy-dom'`. FoldKit's story and scene
// tests import the app, and an app can name `document` at module scope.
import { installDom } from '../../src/dom.ts'

installDom()
