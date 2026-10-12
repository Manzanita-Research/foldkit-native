# @foldkit-native/ui

FoldKit components with theme tokens, stable parts and WAI-ARIA behavior.
Use them with `foldkit-gpuix`, the `foldkit-native` mirror or FoldKit on the web.

Install `foldkit-native-ui-0.1.0-test.2.tgz`, `effect@4.0.0` and
`foldkit@0.165.0` in your project. The package ships compiled ESM and
TypeScript declarations; no native binary, library build or checkout is needed.
The current test package is distributed as a tarball, with a private publication
guard, and has not been published to npm.

```ts
import { Button, paper, uiCss } from '@foldkit-native/ui'

// In a FoldKit view, using its HtmlBuilder h:
const view = (h: import('foldkit/html').HtmlBuilder<never>) =>
  Button.view({ label: 'Save' }, h)
```

`uiCss` is the complete structural/component stylesheet as a string. Pass it
as the native adapter's `css`, or install it in a web stylesheet. Pass `paper`,
`dusk`, or a theme from `defineTheme` as native `tokens`; `themeStyle` scopes
an individual view. Add your own CSS after `uiCss` to override component parts.
Native runtime and platform limits belong to the renderer; importing this
package itself does not open a window or load a native renderer.

The root export includes Button, Checkbox, Dialog, Disclosure, Input, Listbox,
Popover, RadioGroup, ScrollArea, Select, Switch, Tabs, Textarea, TextField,
Toast and VirtualList namespaces, along with themes and the `part` helper.
Effect and FoldKit remain peers so model/message/command identity is shared
with the application. All FoldKit Native distribution packages use the same
version; consumer applications may use this UI package independently.
