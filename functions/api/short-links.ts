interface LinkStore {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

interface Env {
  SHORT_LINKS_ENABLED?: string
  LINKS?: LinkStore
}

function enabled(env: Env): env is Env & { LINKS: LinkStore } {
  return env.SHORT_LINKS_ENABLED === 'true' && typeof env.LINKS !== 'undefined'
}

function disabled(): Response {
  return Response.json(
    {
      error: 'short_links_disabled',
      message: 'Short links are off. Set SHORT_LINKS_ENABLED=true and bind the LINKS KV namespace.',
    },
    { status: 501 },
  )
}

export async function onRequestPost(context: { request: Request; env: Env }): Promise<Response> {
  if (!enabled(context.env)) return disabled()
  let body: unknown
  try {
    body = await context.request.json()
  } catch {
    return Response.json({ error: 'invalid_json' }, { status: 400 })
  }
  const code = crypto.randomUUID().slice(0, 8)
  await context.env.LINKS.put(`link:${code}`, JSON.stringify(body), { expirationTtl: 60 * 60 * 24 * 90 })
  const url = new URL(context.request.url)
  return Response.json({ code, url: `${url.origin}/s/${code}` })
}

export async function onRequestGet(context: { request: Request; env: Env }): Promise<Response> {
  if (!enabled(context.env)) return disabled()
  const code = new URL(context.request.url).searchParams.get('code')
  if (!code) return Response.json({ error: 'missing_code' }, { status: 400 })
  const raw = await context.env.LINKS.get(`link:${code}`)
  if (!raw) return Response.json({ error: 'not_found' }, { status: 404 })
  return new Response(raw, { headers: { 'content-type': 'application/json; charset=utf-8' } })
}
