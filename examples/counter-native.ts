// The only native-specific part of the counter: open the window and get a container.
import { mountNative } from '../src/index.ts'

const css = `
  body { margin: 0; height: 100%; background-color: #1d1d21; }
  .app { display: flex; flex-direction: column; gap: 16px; padding: 40px; height: 100%; }
  .title { margin: 0; font-size: 40px; color: #f2f2f2; }
  .count { margin: 0; font-size: 22px; color: #c9c9d1; }
  .row { display: flex; flex-direction: row; gap: 12px; }
  .button { padding: 10px 18px; border-radius: 10px; background-color: #3b82f6; color: #ffffff;
            font-size: 16px; cursor: pointer; border-width: 0; }
  .button:hover { background-color: #2563eb; }
  .button:active { background-color: #1d4ed8; }
  .ghost { background-color: transparent; color: #f2f2f2; border: 1px solid #ffffff33; }
`
export const native = mountNative({ title: 'FoldKit Native', width: 720, height: 420, appId: 'foldkit-native-counter', css })
