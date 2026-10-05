// The host owns HTTP transport; only string URL resolution belongs to the
// window. In particular, do not stringify Requests or reconstruct Responses.
export const windowFetch = (location: { readonly href: string }) => {
  const transport = globalThis.fetch.bind(globalThis)
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> =>
    transport(typeof input === 'string' ? new URL(input, location.href) : input, init)
}
