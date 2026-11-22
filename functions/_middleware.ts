interface Env {
  FRAME_ANCESTORS?: string
}

/** Overrides the static CSP so frame-ancestors can be a domain list. */
export async function onRequest(context: {
  env: Env
  next: () => Promise<Response>
}): Promise<Response> {
  const response = await context.next()
  const ancestors = (context.env.FRAME_ANCESTORS || '*').trim() || '*'
  const headers = new Headers(response.headers)
  headers.set('Content-Security-Policy', `frame-ancestors ${ancestors}`)
  headers.delete('X-Frame-Options')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
