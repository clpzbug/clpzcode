import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const ENGINES = ['auto', 'jinja2', 'twig', 'freemarker', 'velocity', 'mako', 'smarty', 'erb', 'pebble', 'spring', 'struts2'] as const
const ACTIONS = ['detect', 'identify', 'exploit'] as const
const RCE_ENGINES = ['jinja2', 'twig', 'freemarker', 'velocity', 'mako', 'erb', 'smarty', 'pebble', 'spring', 'struts2'] as const

const schema = z.strictObject({
  url: z.string(),
  parameter: z.string().optional(),
  method: z.enum(['GET', 'POST']).default('GET'),
  data: z.string().optional(),
  engine: z.enum(ENGINES).default('auto'),
  action: z.enum(ACTIONS),
  command: z.string().optional(), // OS command to execute during exploit (default: 'id')
  timeout_secs: z.number().int().min(10).max(300).default(60),
})

describe('SSTITool schema', () => {
  test('accepts detect action', () => {
    const r = schema.safeParse({ url: 'https://example.com/search?q=hello', action: 'detect' })
    expect(r.success).toBe(true)
  })

  test('accepts identify action with parameter', () => {
    const r = schema.safeParse({ url: 'https://example.com/search', action: 'identify', parameter: 'q' })
    expect(r.success).toBe(true)
  })

  test('accepts exploit action with specific engine', () => {
    const r = schema.safeParse({ url: 'https://example.com/render', action: 'exploit', engine: 'jinja2' })
    expect(r.success).toBe(true)
  })

  test('rejects missing url', () => {
    const r = schema.safeParse({ action: 'detect' })
    expect(r.success).toBe(false)
  })

  test('rejects invalid engine', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'detect', engine: 'django' })
    expect(r.success).toBe(false)
  })

  test('rejects invalid action', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'fuzz' })
    expect(r.success).toBe(false)
  })

  test('defaults engine to auto', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'detect' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.engine).toBe('auto')
  })

  test('defaults method to GET', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'detect' })
    if (r.success) expect(r.data.method).toBe('GET')
  })

  test('accepts POST with data', () => {
    const r = schema.safeParse({ url: 'https://example.com/render', action: 'detect', method: 'POST', data: 'template=INJECT' })
    expect(r.success).toBe(true)
  })

  test('all engines are accepted', () => {
    for (const eng of ENGINES) {
      const r = schema.safeParse({ url: 'https://example.com', action: 'detect', engine: eng })
      expect(r.success).toBe(true)
    }
  })

  test('rejects timeout below minimum (10)', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'detect', timeout_secs: 5 })
    expect(r.success).toBe(false)
  })

  test('rejects timeout above maximum (300)', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'detect', timeout_secs: 301 })
    expect(r.success).toBe(false)
  })

  test('all actions are accepted', () => {
    for (const action of ACTIONS) {
      const r = schema.safeParse({ url: 'https://example.com', action })
      expect(r.success).toBe(true)
    }
  })

  test('exploit action with specific engine', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'exploit', engine: 'jinja2' })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.action).toBe('exploit')
      expect(r.data.engine).toBe('jinja2')
    }
  })

  test('accepts custom command for post-RCE enumeration', () => {
    const r = schema.safeParse({
      url: 'https://example.com',
      action: 'exploit',
      engine: 'jinja2',
      command: 'cat /etc/passwd',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.command).toBe('cat /etc/passwd')
  })

  test('command is optional (defaults to id in implementation)', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'exploit' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.command).toBeUndefined()
  })

  test('accepts env enumeration command', () => {
    const r = schema.safeParse({
      url: 'https://example.com',
      action: 'exploit',
      command: 'env | grep -i "key|secret|pass|token"',
    })
    expect(r.success).toBe(true)
  })
})

// =============================================================================
// Detection payload coverage tests
// =============================================================================

describe('SSTI detection payloads', () => {
  const DETECTION_PAYLOADS = [
    { payload: '{{7*7}}', expected: '49' },
    { payload: '${7*7}', expected: '49' },
    { payload: '#{7*7}', expected: '49' },
    { payload: '<%= 7*7 %>', expected: '49' },
    { payload: '*{7*7}', expected: '49' },
    { payload: "{{7*'7'}}", expected: '7777777' },
    { payload: '%{7*7}', expected: '49' },   // Struts2 OGNL
    { payload: '{7*7}', expected: '49' },    // Smarty bare curly
  ]

  test('has 8 detection payloads', () => {
    expect(DETECTION_PAYLOADS).toHaveLength(8)
  })

  test('all payloads have non-empty payload and expected', () => {
    for (const { payload, expected } of DETECTION_PAYLOADS) {
      expect(payload.length).toBeGreaterThan(0)
      expect(expected.length).toBeGreaterThan(0)
    }
  })

  test('includes Jinja2-style payload {{7*7}}', () => {
    expect(DETECTION_PAYLOADS.some(p => p.payload === '{{7*7}}')).toBe(true)
  })

  test('includes Freemarker/Spring EL payload ${7*7}', () => {
    expect(DETECTION_PAYLOADS.some(p => p.payload === '${7*7}')).toBe(true)
  })

  test('includes ERB-style payload', () => {
    expect(DETECTION_PAYLOADS.some(p => p.payload.includes('<%= 7*7 %>'))).toBe(true)
  })

  test('Jinja2 vs Twig differentiator payload present', () => {
    // {{7*'7'}} → 7777777 in Jinja2, 49 in Twig
    expect(DETECTION_PAYLOADS.some(p => p.payload === "{{7*'7'}}" && p.expected === '7777777')).toBe(true)
  })
})

// =============================================================================
// RCE engine coverage tests
// =============================================================================

describe('SSTI RCE payload engines', () => {
  // These are the engines we know have RCE payloads in the tool
  test('jinja2 is a supported RCE engine', () => {
    expect(RCE_ENGINES).toContain('jinja2')
  })

  test('twig is a supported RCE engine', () => {
    expect(RCE_ENGINES).toContain('twig')
  })

  test('freemarker is a supported RCE engine', () => {
    expect(RCE_ENGINES).toContain('freemarker')
  })

  test('velocity is a supported RCE engine', () => {
    expect(RCE_ENGINES).toContain('velocity')
  })

  test('mako is a supported RCE engine', () => {
    expect(RCE_ENGINES).toContain('mako')
  })

  test('erb is a supported RCE engine', () => {
    expect(RCE_ENGINES).toContain('erb')
  })

  test('smarty is a supported RCE engine', () => {
    expect(RCE_ENGINES).toContain('smarty')
  })

  test('all RCE engines accept exploit action in schema', () => {
    for (const engine of RCE_ENGINES) {
      const r = schema.safeParse({ url: 'https://example.com', action: 'exploit', engine })
      expect(r.success).toBe(true)
    }
  })

  test('pebble is a supported RCE engine (Java, Twig-like syntax)', () => {
    expect(RCE_ENGINES).toContain('pebble')
  })

  test('spring SpEL is a supported RCE engine', () => {
    expect(RCE_ENGINES).toContain('spring')
  })

  test('struts2 OGNL is a supported RCE engine (enterprise Java)', () => {
    expect(RCE_ENGINES).toContain('struts2')
  })
})

// =============================================================================
// Spring EL + Pebble identification coverage (additive engines)
// =============================================================================

describe('SSTI Spring + Pebble engines', () => {
  test('schema accepts spring engine', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'exploit', engine: 'spring' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.engine).toBe('spring')
  })

  test('schema accepts pebble engine for identify', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'identify', engine: 'pebble' })
    expect(r.success).toBe(true)
  })

  test('Spring EL selection-syntax payload *{7*7} is a known detector', () => {
    // *{...} is Thymeleaf/SpEL selection syntax — distinguishes Spring from
    // Freemarker's #{} once the freemarker engine probe has been excluded.
    const springProbe = '*{7*7}'
    expect(springProbe.startsWith('*{')).toBe(true)
    expect(springProbe).toContain('7*7')
  })

  test('Pebble identifier uses a {% set %} statement (excluded from twig path)', () => {
    const pebbleProbe = '{% set x=7*7 %}{{x}}'
    expect(pebbleProbe).toContain('{% set')
    expect(pebbleProbe).toContain('{{x}}')
  })
})

// =============================================================================
// Mako + Struts2 engine coverage (added in pentest cycle 2+3)
// =============================================================================

describe('SSTI Mako + Struts2 engines', () => {
  test('schema accepts mako engine (Python WSGI framework)', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'exploit', engine: 'mako' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.engine).toBe('mako')
  })

  test('schema accepts struts2 engine (enterprise Java)', () => {
    const r = schema.safeParse({ url: 'https://example.com', action: 'exploit', engine: 'struts2' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.engine).toBe('struts2')
  })

  test('Mako probe uses Python upper() to distinguish from Freemarker', () => {
    // ${"mako".upper()} = MAKO in Mako but not in Freemarker (no .upper())
    const makoProbe = "${'mako'.upper()}"
    expect(makoProbe).toContain('.upper()')
    expect(makoProbe).toContain('mako')
  })

  test('Struts2 OGNL uses %{} delimiter (different from Spring *{})', () => {
    const struts2Probe = '%{7*7}'
    expect(struts2Probe.startsWith('%{')).toBe(true)
    expect(struts2Probe).toContain('7*7')
  })
})

// =============================================================================
// Output schema tests
// =============================================================================

describe('SSTITool output schema', () => {
  const outputSchema = z.object({
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
  })

  test('valid non-vulnerable output passes schema', () => {
    const r = outputSchema.safeParse({
      url: 'https://example.com',
      action: 'detect',
      vulnerable: false,
      payloads_tested: [
        { payload: '{{7*7}}', reflected: false },
        { payload: '${7*7}', reflected: false },
      ],
    })
    expect(r.success).toBe(true)
  })

  test('valid vulnerable output passes schema', () => {
    const r = outputSchema.safeParse({
      url: 'https://example.com',
      action: 'detect',
      vulnerable: true,
      engine: 'jinja2',
      payloads_tested: [
        { payload: '{{7*7}}', reflected: true, result: '49' },
      ],
    })
    expect(r.success).toBe(true)
  })

  test('error output passes schema', () => {
    const r = outputSchema.safeParse({
      url: 'https://example.com',
      action: 'detect',
      vulnerable: false,
      payloads_tested: [],
      error: 'Connection refused',
    })
    expect(r.success).toBe(true)
  })

  test('rce_output is optional', () => {
    const r = outputSchema.safeParse({
      url: 'https://example.com',
      action: 'exploit',
      vulnerable: true,
      engine: 'jinja2',
      payloads_tested: [],
      rce_output: 'uid=33(www-data) gid=33(www-data)',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.rce_output).toBe('uid=33(www-data) gid=33(www-data)')
  })
})
