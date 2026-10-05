// The components' Commands (FoldKit's Dom.focus, and the components' own
// focus and scroll Commands) on FoldKit on gpuix, in a process with no
// happy-dom: `bun test` preloads one (test/support/dom.ts), so
// commands.test.ts runs this file on its own. Headless, on the fake GPUI.
// Prints one JSON line per check, then the happy-dom modules loaded.
import { Chooser, Picker, Plans, Settings, Sidebar } from './apps.ts'
import { headless } from './run.ts'

const loaded = () => Object.keys(require.cache).filter(path => path.includes('happy-dom')).length
const say = (check: string, value: unknown) => console.log(JSON.stringify({ check, value }))

say('happy-dom before', loaded())

{
  const app = await headless(Plans)
  await app.press('tab')
  await app.press('down')
  say('RadioGroup FocusOption (Dom.focus)', [app.document.activeElement?.getAttribute('id'), app.gpuiFocus()?.getAttribute('id'), app.model().chosen])
  app.close()
}
{
  const app = await headless(Settings)
  await app.press('tab')
  await app.press('right')
  say('Tabs FocusTab (Dom.focus), Automatic', [app.document.activeElement?.getAttribute('id'), app.gpuiFocus()?.getAttribute('id'), app.model().section])
  app.close()
}
{
  const app = await headless(Sidebar)
  await app.press('tab')
  await app.press('down')
  say('Tabs FocusTab (Dom.focus), Manual', [app.document.activeElement?.getAttribute('id'), app.gpuiFocus()?.getAttribute('id'), app.model().section])
  app.close()
}
{
  const app = await headless(Picker)
  await app.press('tab')
  await app.press('end')
  say('Listbox ScrollIntoView', app.fake.scrolledIntoView.map(id => app.elementFor(id)?.getAttribute('id') ?? null))
  app.close()
}
{
  const app = await headless(Chooser)
  app.document.getElementById('fruit-trigger')!.focus()
  await app.press('down')
  const opened = app.document.activeElement?.getAttribute('id')
  await app.press('escape')
  say('Select FocusAfterCommit', [opened, app.document.activeElement?.getAttribute('id')])
  app.close()
}

say('happy-dom after', loaded())
process.exit(0)
