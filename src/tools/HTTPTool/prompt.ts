export const HTTP_TOOL_NAME = 'HTTP'

export const DESCRIPTION = `
- Makes HTTP requests (GET, POST, PUT, PATCH, DELETE, HEAD) to any URL
- Full control over headers, request body, authentication, and query parameters
- Returns status code, response headers, response body, and timing
- Use this for API development, testing endpoints, and system integrations

Parameters:
  - method: HTTP method (GET, POST, PUT, PATCH, DELETE, HEAD)
  - url: The URL to request
  - headers: Key-value map of request headers (optional)
  - body: Request body — string, JSON object, or form data (optional)
  - json: When true, sets Content-Type: application/json and serializes body (default: true for POST/PUT/PATCH)
  - timeout_ms: Request timeout in milliseconds (default: 30000)
  - follow_redirects: Whether to follow HTTP redirects (default: true)

Usage notes:
  - For REST API development, test endpoints directly without leaving clpzcode
  - Use for webhook testing, OAuth flows, GraphQL queries
  - For authentication: pass Authorization header (Bearer token, Basic auth, API keys)
  - Response body is truncated to 50KB to avoid context overflow
  - Do not use this for web scraping — use WebFetch instead
  - Do not use this for searching the web — use WebSearch instead
`
