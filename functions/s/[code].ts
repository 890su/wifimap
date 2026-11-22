interface Env {
  SHORT_LINKS_ENABLED?: string
}

export async function onRequestGet(context: { request: Request; env: Env; params: { code?: string } }): Promise<Response> {
  const home = new URL('/', context.request.url)
  if (context.env.SHORT_LINKS_ENABLED !== 'true') return Response.redirect(home, 302)
  const code = context.params.code
  if (!code) return Response.redirect(home, 302)
  return Response.redirect(new URL(`/?link=${encodeURIComponent(code)}`, context.request.url), 302)
}
