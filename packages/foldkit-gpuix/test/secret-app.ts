// A real window with two fields, for automation.test.ts: a name, and a
// one-time code (`autocomplete="one-time-code"`, a secret). Automation is
// on only if the environment asks (FOLDKIT_NATIVE_AUTOMATION=1).
//
//   FOLDKIT_NATIVE_AUTOMATION=1 bun packages/foldkit-gpuix/test/secret-app.ts
import { mountGpuix } from '../src/index.ts'

const app = mountGpuix({ title: 'secret-app', width: 320, height: 160 })
const field = (id: string, value: string, autocomplete?: string) => {
  const input = app.document.createElement('input')
  input.setAttribute('id', id)
  if (autocomplete !== undefined) input.setAttribute('autocomplete', autocomplete)
  input.value = value
  return input
}
app.document.body.append(field('name', 'Ada Lovelace'), field('code', '424242', 'one-time-code'))
