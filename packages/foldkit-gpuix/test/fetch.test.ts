import { afterEach, expect, test } from 'bun:test'
import { type Server, createServer } from 'node:http'
import { attachGpuix } from '../src/index.ts'
import { createFocusableFake } from './support.ts'

const apps: Array<{ detach(): void }> = []
const servers: Array<Server> = []
afterEach(async () => {
  for (const app of apps.splice(0).reverse()) app.detach()
  await Promise.all(servers.splice(0).map(server => new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections()
  })))
})

const endpoint = async () => {
  const seen: Array<{ url: string; method: string; header: string | undefined; body: string }> = []
  const server = createServer(async (request, response) => {
    let body = ''
    for await (const chunk of request) body += chunk
    seen.push({ url: request.url!, method: request.method!, header: request.headers['x-test'] as string | undefined, body })
    if (request.url === '/redirect') {
      response.writeHead(302, { location: '/final' })
      response.end()
    } else {
      response.writeHead(request.url === '/missing' ? 404 : 201, { 'content-type': 'text/plain', 'x-real-server': 'yes' })
      response.end('real response')
    }
  })
  servers.push(server)
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Expected TCP listener')
  return { origin: `http://127.0.0.1:${address.port}`, seen }
}
const attach = () => {
  const app = attachGpuix(createFocusableFake().renderer)
  apps.push(app)
  return app.window
}

test('public attachGpuix fetch resolves strings against its current location and preserves URL inputs', async () => {
  const { origin, seen } = await endpoint()
  const window = attach()
  window.location.href = `${origin}/first/page`
  const fetch = window.fetch
  const response = await fetch('../relative?x=1')
  expect(response).toBeInstanceOf(Response)
  expect(response.status).toBe(201)
  expect(response.headers.get('x-real-server')).toBe('yes')
  expect(await response.text()).toBe('real response')
  window.history.replaceState(null, '', `${origin}/second/page`)
  await fetch('child')
  await fetch(`${origin}/absolute`)
  await fetch(new URL(`${origin}/url`))
  expect(seen.map(request => request.url)).toEqual(['/relative?x=1', '/second/child', '/absolute', '/url'])
})

test('Request body, headers and init overrides reach the actual server', async () => {
  const { origin, seen } = await endpoint()
  const window = attach()
  const request = new Request(`${origin}/request`, { method: 'POST', headers: { 'x-test': 'original' }, body: 'request body' })
  await window.fetch(request)
  expect(request.bodyUsed).toBe(true)
  await window.fetch(new Request(`${origin}/override`, { method: 'POST', body: 'old' }), {
    method: 'PUT', headers: { 'x-test': 'override' }, body: 'new',
  })
  expect(seen).toEqual([
    { url: '/request', method: 'POST', header: 'original', body: 'request body' },
    { url: '/override', method: 'PUT', header: 'override', body: 'new' },
  ])
  await expect(window.fetch(request)).rejects.toBeInstanceOf(TypeError)
})

test('HTTP errors and redirects retain host Response semantics', async () => {
  const { origin } = await endpoint()
  const window = attach()
  const missing = await window.fetch(`${origin}/missing`)
  expect(missing.status).toBe(404)
  expect(missing.ok).toBe(false)
  expect(await missing.text()).toBe('real response')
  const redirected = await window.fetch(`${origin}/redirect`)
  expect(redirected.redirected).toBe(true)
  expect(redirected.url).toBe(`${origin}/final`)
  expect(await redirected.text()).toBe('real response')
})

test('invalid URLs and aborts reject without sending requests', async () => {
  const { origin, seen } = await endpoint()
  const window = attach()
  await expect(window.fetch('http://[')).rejects.toBeInstanceOf(TypeError)
  const controller = new AbortController()
  const reason = new Error('cancelled by caller')
  controller.abort(reason)
  await expect(window.fetch(new Request(`${origin}/abort`, { signal: controller.signal }))).rejects.toBe(reason)
  await expect(window.fetch(`${origin}/abort-init`, { signal: controller.signal })).rejects.toBe(reason)
  expect(seen).toEqual([])
})
