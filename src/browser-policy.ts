import { createMiddleware } from 'hono/factory'
import { cors } from 'hono/cors'
import { ApiError } from './protocol'

type BrowserBindings = { ALLOWED_ORIGINS: string }

function origins(value: string): string[] {
  try {
    const list: unknown = JSON.parse(value)
    if (!Array.isArray(list) || list.length > 16 || list.some(origin => {
      if (typeof origin !== 'string') return true
      const url = new URL(origin)
      return !['http:', 'https:'].includes(url.protocol) || url.origin !== origin
    })) throw new Error()
    return list
  } catch {
    throw new ApiError(503, 'SERVICE_UNAVAILABLE', 'The service is temporarily unavailable.')
  }
}

export const browserPolicy = createMiddleware<{ Bindings: BrowserBindings }>(async (c, next) => {
  c.header('Vary', 'Origin')
  const allowed = origins(c.env.ALLOWED_ORIGINS)
  const origin = c.req.header('Origin')
  if (origin && origin !== new URL(c.req.url).origin && !allowed.includes(origin)) {
    return c.json({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Browser origin is not allowed.' } }, 403)
  }
  if (origin && c.req.method === 'OPTIONS') {
    const method = c.req.header('Access-Control-Request-Method')
    const headers = c.req.header('Access-Control-Request-Headers')?.split(',').map(header => header.trim().toLowerCase()) || []
    if ((method && method !== 'POST') || headers.some(header => header !== 'content-type')) {
      return c.json({ error: { code: 'PREFLIGHT_NOT_ALLOWED', message: 'Preflight request is not allowed.' } }, 403)
    }
  }
  return cors({
    origin: origin || '',
    allowMethods: ['POST', 'OPTIONS'],
    allowHeaders: ['Content-Type'],
    exposeHeaders: ['Retry-After'],
    credentials: false,
    maxAge: 0,
  })(c, next)
})
