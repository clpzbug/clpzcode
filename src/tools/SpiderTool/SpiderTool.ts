import { writeFile, unlink, mkdir } from 'fs/promises'
import { join } from 'path'
import { tmpdir, homedir } from 'os'
import { z } from 'zod/v4'
import { buildTool, type ToolDef, type ToolUseContext } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { runNativeWithTask } from '../../utils/task/nativeTaskRunner.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

export const SPIDER_TOOL_NAME = 'Spider'

const TARGETS_ROOT = join(homedir(), 'Targets')

// Python Playwright spider script template
function buildSpiderScript(baseUrl: string, depth: number, maxPages: number, scope: string, stealth: boolean): string {
  const SPIDER_BODY = `
    visited = set()
    queue = [(base_url, 0)]
    endpoints = []
    forms = []
    api_calls = []
    js_routes = set()

    # Intercept XHR/fetch for API discovery
    def handle_request(request):
        if request.resource_type in ('xhr', 'fetch', 'websocket'):
            url = request.url
            if scope in url:
                entry = f"{request.method} {url}"
                if entry not in api_calls:
                    api_calls.append(entry)

    while queue and len(visited) < max_pages:
        url, current_depth = queue.pop(0)
        url = url.split('#')[0].rstrip('/')
        if url in visited or not url.startswith('http'):
            continue
        if scope and scope not in url:
            continue
        visited.add(url)

        page = await context.new_page()
        page.on('request', handle_request)
        try:
            await page.goto(url, wait_until='domcontentloaded', timeout=15000)
            endpoints.append(url)

            # Extract forms + fields
            form_handles = await page.query_selector_all('form')
            for form in form_handles:
                try:
                    action = await form.get_attribute('action') or ''
                    method = (await form.get_attribute('method') or 'GET').upper()
                    inp_handles = await form.query_selector_all('input, select, textarea, button[type=submit]')
                    fields = []
                    for inp in inp_handles:
                        name = await inp.get_attribute('name') or await inp.get_attribute('id') or ''
                        inp_type = await inp.get_attribute('type') or 'text'
                        if name:
                            fields.append({'name': name, 'type': inp_type})
                    full_action = urljoin(url, action) if action else url
                    forms.append({
                        'page': url,
                        'action': full_action,
                        'method': method,
                        'fields': fields,
                    })
                except Exception:
                    pass

            # Collect JS-inferred routes from window.__routes or react/vue router
            try:
                routes = await page.evaluate("""() => {
                    const r = [];
                    // React Router v6
                    try { const m = window.__reactRouterDomData; if (m) r.push(...Object.keys(m)); } catch(_) {}
                    // href attributes on buttons/links
                    document.querySelectorAll('[href]').forEach(el => r.push(el.getAttribute('href') || ''));
                    document.querySelectorAll('[data-url],[data-href],[data-link]').forEach(el => {
                        const v = el.dataset.url || el.dataset.href || el.dataset.link;
                        if (v) r.push(v);
                    });
                    return r;
                }""")
                for route in routes:
                    if route and (route.startswith('/') or scope in route):
                        js_routes.add(route)
            except Exception:
                pass

            # Follow links within scope
            if current_depth < depth_limit:
                try:
                    links = await page.eval_on_selector_all(
                        'a[href]',
                        'els => els.map(el => el.href || "").filter(Boolean)',
                    )
                    for link in links:
                        clean = link.split('#')[0].rstrip('/')
                        parsed = urlparse(clean)
                        if scope in (parsed.netloc or ''):
                            queue.append((clean, current_depth + 1))
                except Exception:
                    pass
        except Exception as e:
            pass
        finally:
            await page.close()

    await browser.close()

    print(json.dumps({
        'success': True,
        'pages_visited': len(visited),
        'endpoints': sorted(list(visited)),
        'forms': forms,
        'api_calls': sorted(list(set(api_calls))),
        'js_routes': sorted(list(js_routes)),
    }))

asyncio.run(spider())
`

  const COMMON_HEADER = `import asyncio, json, sys
from urllib.parse import urlparse, urljoin

async def spider():
    base_url = ${JSON.stringify(baseUrl)}
    depth_limit = ${depth}
    max_pages = ${maxPages}
    scope = ${JSON.stringify(scope)}
`

  // stealth=true: playwright with anti-detection args (disable automation flags, realistic UA, viewport)
  const launchArgs = stealth
    ? [
        '--no-sandbox', '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-web-security',
        '--window-size=1366,768',
      ]
    : ['--no-sandbox', '--disable-dev-shm-usage']

  const userAgent = stealth
    ? 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
    : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'

  return `${COMMON_HEADER}
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        browser = await p.chromium.launch(
            headless=True,
            executable_path='/usr/bin/chromium',
            args=${JSON.stringify(launchArgs)},
        )
        context = await browser.new_context(
            user_agent=${JSON.stringify(userAgent)},
            viewport={'width': 1366, 'height': 768},
            java_script_enabled=True,
        )
        ${stealth ? "# Stealth: mask navigator.webdriver flag\n        await context.add_init_script(\"Object.defineProperty(navigator, 'webdriver', {get: () => undefined})\")" : ''}
${SPIDER_BODY.replace(/^/gm, '    ')}`
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().describe('Starting URL to crawl (e.g. "https://example.com")'),
    depth: z.number().int().min(1).max(5).default(2).describe('Max crawl depth (default: 2)'),
    max_pages: z.number().int().min(1).max(200).default(50).describe('Max pages to visit (default: 50)'),
    scope: z
      .string()
      .optional()
      .describe('Domain scope filter (default: derived from starting URL). Only follow links containing this string.'),
    timeout_secs: z.number().int().min(30).max(600).default(120).describe('Total timeout in seconds (default: 120)'),
    stealth: z
      .boolean()
      .default(false)
      .describe(
        'Enable anti-detection mode: disables AutomationControlled flag, uses realistic viewport/UA, masks navigator.webdriver. Helps bypass basic bot detection on Cloudflare/Imperva.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    success: z.boolean(),
    base_url: z.string(),
    pages_visited: z.number(),
    endpoints: z.array(z.string()),
    forms: z.array(z.unknown()),
    api_calls: z.array(z.string()),
    js_routes: z.array(z.string()),
    output_file: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

async function runSpider(input: z.infer<InputSchema>, context: ToolUseContext): Promise<Output> {
  const { hostname } = new URL(input.url)
  const scope = input.scope ?? hostname
  const outputDir = join(TARGETS_ROOT, hostname, 'recon')
  await mkdir(outputDir, { recursive: true })

  const script = buildSpiderScript(input.url, input.depth, input.max_pages, scope, input.stealth ?? false)
  const scriptPath = join(tmpdir(), `spider-${Date.now()}.py`)
  await writeFile(scriptPath, script, 'utf8')

  const outputFile = join(outputDir, 'spider.json')

  try {
    const { stdout, stderr, code } = await runNativeWithTask({
      binary: '/usr/sbin/python3',
      args: [scriptPath],
      description: `Spider: ${input.url} (depth ${input.depth}, max ${input.max_pages} pages)`,
      command: `python3 ${scriptPath}`,
      timeoutMs: input.timeout_secs * 1000,
      setAppState: context.setAppStateForTasks ?? context.setAppState,
      agentId: context.agentId,
      abortSignal: context.abortController.signal,
    })

    if (code !== 0) {
      return {
        success: false,
        base_url: input.url,
        pages_visited: 0,
        endpoints: [],
        forms: [],
        api_calls: [],
        js_routes: [],
        error: stderr.slice(0, 2000) || `Exit code ${code}`,
      }
    }

    let parsed: Output
    try {
      parsed = JSON.parse(stdout.trim()) as Output
    } catch {
      return {
        success: false,
        base_url: input.url,
        pages_visited: 0,
        endpoints: [],
        forms: [],
        api_calls: [],
        js_routes: [],
        error: `Failed to parse spider output: ${stdout.slice(0, 500)}`,
      }
    }

    // Save JSON output
    const { writeFile: wf } = await import('fs/promises')
    await wf(outputFile, JSON.stringify(parsed, null, 2), 'utf8')

    return { ...parsed, base_url: input.url, output_file: outputFile }
  } finally {
    await unlink(scriptPath).catch(() => {})
  }
}

export const SpiderTool = buildTool({
  name: SPIDER_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'spider — deep web application crawl with Playwright: endpoint discovery, form parameter extraction, XHR/fetch API interception, JavaScript route enumeration',
  maxResultSizeChars: 30_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    if (i.url) return `Spider: ${i.url} (depth ${i.depth ?? 2})`
    return 'Web application spider'
  },
  async prompt() {
    return `Deep web application crawler using headless Chromium. Use during recon after discovering a web target to map its full attack surface:
- Crawls all pages within scope up to the specified depth
- Extracts forms with their action URLs, HTTP methods, and input field names
- Intercepts XHR/fetch requests to discover API endpoints the frontend calls
- Extracts data-href/data-url attributes and JS route hints

### ESCALATION RULE — Spider output feeds directly into exploitation:
1. endpoints → ReconTool action=classify_endpoints → identify SSTI/SSRF/SQLi/file-upload candidates
2. forms with file inputs → test for webshell upload (file-upload chain)
3. api_calls with ?url= or /proxy/ params → test with SSRFTool action=scan
4. api_calls to /admin/* or /internal/* paths → test for auth bypass (JWT forgery, missing auth)
5. forms with hidden fields (CSRF token patterns) → check if anti-CSRF is enforced (DiffTool reflection)
6. Multiple endpoints matching SSTI patterns → SSTITool action=detect in parallel

Output saved to ~/Targets/<hostname>/recon/spider.json. Use after NmapTool port scan confirms a web service is running.`
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName(input) {
    const i = input as Partial<z.infer<InputSchema>>
    if (!i?.url) return 'Spider'
    return `Spider:${i.url.replace(/^https?:\/\//, '').slice(0, 30)}`
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `spider ${i?.url ?? ''} depth=${i?.depth ?? 2}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Authorized pentest engagement tool' },
    }
  },
  async call(input, context) {
    const result = await runSpider(input as z.infer<InputSchema>, context)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(data: Output, toolUseID) {
    if (!data.success) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result' as const,
        content: `Spider error: ${data.error}`,
      }
    }
    const lines: string[] = [
      `Spider: ${data.base_url} — ${data.pages_visited} pages visited`,
      data.output_file ? `Output: ${data.output_file}` : '',
      '',
      `Endpoints (${data.endpoints.length}):`,
      ...data.endpoints.slice(0, 100).map(e => `  ${e}`),
      data.endpoints.length > 100 ? `  ... +${data.endpoints.length - 100} more (see output_file)` : '',
    ]
    if (data.forms.length > 0) {
      lines.push('', `Forms (${data.forms.length}):`)
      for (const f of data.forms as Array<{ page: string; action: string; method: string; fields: Array<{name: string; type: string}> }>) {
        lines.push(`  [${f.method}] ${f.action}`)
        lines.push(`    page: ${f.page}`)
        lines.push(`    fields: ${f.fields.map(fi => `${fi.name}(${fi.type})`).join(', ')}`)
      }
    }
    if (data.api_calls.length > 0) {
      lines.push('', `API calls intercepted (${data.api_calls.length}):`)
      data.api_calls.slice(0, 50).forEach(a => lines.push(`  ${a}`))
    }
    if (data.js_routes.length > 0) {
      lines.push('', `JS routes (${data.js_routes.length}):`)
      data.js_routes.slice(0, 30).forEach(r => lines.push(`  ${r}`))
    }
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: lines.filter(l => l !== '').join('\n'),
    }
  },
  getActivityDescription(input) {
    const url = (input as Partial<z.infer<InputSchema>>)?.url ?? ''
    return url ? `Spidering ${url}` : 'Spider crawl'
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return i.url ?? 'spider'
  },
  renderToolResultMessage,
} satisfies ToolDef<InputSchema, Output>)
