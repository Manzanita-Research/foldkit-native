// Run from the repository root: bun scripts/repro-devtools-shadow.ts
// Reduced from @foldkit/devtools 0.165.0 createShadowContainer().
// No app server, credentials, GPU, or modified boot configuration required.
import { NativeDocument } from '../packages/foldkit-gpuix/src/index.ts'

const document = new NativeDocument()
const host = document.createElement('div')
host.setAttribute('id', 'foldkit-devtools')
document.body.appendChild(host)

// FoldKit's browser-facing consumer uses this DOM operation with these options.
const shadow = (host as unknown as HTMLElement).attachShadow({ mode: 'open' })
const style = document.createElement('style')
style.textContent = ':host { color: #cdd6f4; } button { color: #a6e3a1; }'
shadow.appendChild(style as unknown as HTMLStyleElement)
shadow.appendChild(document.createElement('div') as unknown as HTMLElement)
