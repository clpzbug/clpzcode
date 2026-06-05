export type HTTPMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD'

export type HTTPRequest = {
  method: HTTPMethod
  url: string
  headers?: Record<string, string>
  body?: unknown
  json?: boolean
  timeout_ms?: number
  follow_redirects?: boolean
}

export type HTTPResponse = {
  status: number
  status_text: string
  headers: Record<string, string>
  body: string
  body_bytes: number
  truncated: boolean
  duration_ms: number
  url: string
  redirected: boolean
}

const MAX_BODY_BYTES = 50 * 1024

export async function makeRequest(
  req: HTTPRequest,
  signal: AbortSignal,
): Promise<HTTPResponse> {
  const start = Date.now()
  const timeoutMs = req.timeout_ms ?? 30000

  const timeoutController = new AbortController()
  const timeoutId = setTimeout(() => timeoutController.abort(), timeoutMs)
  const combined = AbortSignal.any([signal, timeoutController.signal])

  const headers: Record<string, string> = { ...req.headers }
  let bodyStr: string | undefined

  const methodUsesBody = ['POST', 'PUT', 'PATCH'].includes(req.method)
  const autoJson = req.json !== false && methodUsesBody

  if (req.body !== undefined) {
    if (autoJson && typeof req.body !== 'string') {
      bodyStr = JSON.stringify(req.body)
      if (!headers['Content-Type'] && !headers['content-type']) {
        headers['Content-Type'] = 'application/json'
      }
    } else {
      bodyStr = typeof req.body === 'string' ? req.body : JSON.stringify(req.body)
    }
  } else if (req.json === true && methodUsesBody) {
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json'
    }
  }

  try {
    const response = await fetch(req.url, {
      method: req.method,
      headers,
      body: bodyStr,
      signal: combined,
      redirect: req.follow_redirects === false ? 'manual' : 'follow',
    })

    clearTimeout(timeoutId)

    const responseHeaders: Record<string, string> = {}
    response.headers.forEach((v, k) => {
      responseHeaders[k] = v
    })

    const bodyBuf = await response.arrayBuffer()
    const bodyBytes = bodyBuf.byteLength
    const truncated = bodyBytes > MAX_BODY_BYTES
    const slice = truncated ? bodyBuf.slice(0, MAX_BODY_BYTES) : bodyBuf
    const bodyText = new TextDecoder().decode(slice)

    return {
      status: response.status,
      status_text: response.statusText,
      headers: responseHeaders,
      body: bodyText,
      body_bytes: bodyBytes,
      truncated,
      duration_ms: Date.now() - start,
      url: response.url || req.url,
      redirected: response.redirected,
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

export function formatBody(body: string, contentType: string | undefined): string {
  if (contentType?.includes('application/json')) {
    try {
      return JSON.stringify(JSON.parse(body), null, 2)
    } catch {
      // fall through
    }
  }
  return body
}
