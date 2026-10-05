// Selectors the engine can't read, parsed in a process of their own for
// selector.test.ts, so a parser that loops can be killed instead of hanging
// the test run. Prints one JSON line: what the sheet reports for each, and
// what querySelector throws.
import { NativeDocument, sheetFromCss } from '../src/index.ts'

const document = new NativeDocument()
const results = JSON.parse(process.argv[2]!).map((selector: string) => {
  const reported = sheetFromCss(`${selector} { color: red }`).unsupported
  let thrown: string | undefined
  try {
    document.querySelector(selector)
  } catch (error) {
    thrown = (error as Error).name
  }
  return { selector, reported, thrown }
})
console.log(JSON.stringify(results))
