import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const METHODS = ['GET', 'POST'] as const
const DBMS_TYPES = ['mysql', 'mssql', 'oracle', 'postgresql', 'sqlite', 'access'] as const
const ACTIONS = ['detect_only', 'dump_dbs', 'dump_tables', 'dump_data'] as const

const schema = z.strictObject({
  url: z.string(),
  method: z.enum(METHODS).default('GET'),
  data: z.string().optional(),
  cookie: z.string().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  technique: z.string().default('BEUSTQ'),
  level: z.number().int().min(1).max(5).default(1),
  risk: z.number().int().min(1).max(3).default(1),
  dbms: z.enum(DBMS_TYPES).optional(),
  action: z.enum(ACTIONS).default('detect_only'),
  db: z.string().optional(),
  table: z.string().optional(),
  columns: z.array(z.string()).optional(),
  extra_args: z.string().optional(),
  timeout_secs: z.number().int().min(30).max(3600).default(300),
})

describe('SQLiTool schema', () => {
  test('aceita URL mínima', () => {
    const r = schema.safeParse({ url: 'http://target/page.php?id=1' })
    expect(r.success).toBe(true)
  })

  test('defaults: method=GET, technique=BEUSTQ, level=1, risk=1, action=detect_only', () => {
    const r = schema.safeParse({ url: 'http://target/page.php?id=1' })
    if (r.success) {
      expect(r.data.method).toBe('GET')
      expect(r.data.technique).toBe('BEUSTQ')
      expect(r.data.level).toBe(1)
      expect(r.data.risk).toBe(1)
      expect(r.data.action).toBe('detect_only')
    }
  })

  test('default timeout_secs=300', () => {
    const r = schema.safeParse({ url: 'http://target/page.php?id=1' })
    if (r.success) expect(r.data.timeout_secs).toBe(300)
  })

  test('aceita POST com data', () => {
    const r = schema.safeParse({
      url: 'http://target/login',
      method: 'POST',
      data: 'user=test&pass=test',
    })
    expect(r.success).toBe(true)
  })

  test('aceita todos os DBMS', () => {
    for (const dbms of DBMS_TYPES) {
      const r = schema.safeParse({ url: 'http://target/page?id=1', dbms })
      expect(r.success).toBe(true)
    }
  })

  test('aceita todas as actions', () => {
    for (const action of ACTIONS) {
      const r = schema.safeParse({ url: 'http://target/page?id=1', action })
      expect(r.success).toBe(true)
    }
  })

  test('aceita dump_data com db, table e columns', () => {
    const r = schema.safeParse({
      url: 'http://target/page?id=1',
      action: 'dump_data',
      db: 'myapp',
      table: 'users',
      columns: ['id', 'username', 'password'],
    })
    expect(r.success).toBe(true)
  })

  test('aceita cookie de sessão', () => {
    const r = schema.safeParse({
      url: 'http://target/page?id=1',
      cookie: 'PHPSESSID=abc123; auth=token',
    })
    expect(r.success).toBe(true)
  })

  test('aceita headers customizados', () => {
    const r = schema.safeParse({
      url: 'http://target/page?id=1',
      headers: { Authorization: 'Bearer token' },
    })
    expect(r.success).toBe(true)
  })

  test('aceita técnica customizada', () => {
    const r = schema.safeParse({
      url: 'http://target/page?id=1',
      technique: 'BT',
    })
    expect(r.success).toBe(true)
  })

  test('aceita extra_args', () => {
    const r = schema.safeParse({
      url: 'http://target/page?id=1',
      extra_args: '--tamper=space2comment',
    })
    expect(r.success).toBe(true)
  })

  test('aceita level máximo (5)', () => {
    const r = schema.safeParse({ url: 'http://target/page?id=1', level: 5 })
    expect(r.success).toBe(true)
  })

  test('aceita risk máximo (3)', () => {
    const r = schema.safeParse({ url: 'http://target/page?id=1', risk: 3 })
    expect(r.success).toBe(true)
  })

  test('rejeita level acima do máximo (5)', () => {
    const r = schema.safeParse({ url: 'http://target/page?id=1', level: 6 })
    expect(r.success).toBe(false)
  })

  test('rejeita risk acima do máximo (3)', () => {
    const r = schema.safeParse({ url: 'http://target/page?id=1', risk: 4 })
    expect(r.success).toBe(false)
  })

  test('rejeita dbms inválido', () => {
    const r = schema.safeParse({ url: 'http://target/page?id=1', dbms: 'mongodb' })
    expect(r.success).toBe(false)
  })

  test('rejeita action inválida', () => {
    const r = schema.safeParse({ url: 'http://target/page?id=1', action: 'dump_all' })
    expect(r.success).toBe(false)
  })

  test('rejeita sem url', () => {
    const r = schema.safeParse({ method: 'GET', action: 'detect_only' })
    expect(r.success).toBe(false)
  })

  test('rejeita timeout_secs abaixo do mínimo (30)', () => {
    const r = schema.safeParse({ url: 'http://target/page?id=1', timeout_secs: 29 })
    expect(r.success).toBe(false)
  })
})

// =============================================================================
// SQLiTool pentest scenarios
// =============================================================================

describe('SQLiTool — pentest escalation scenarios', () => {
  test('OS shell via extra_args (MySQL xp_cmdshell bypass)', () => {
    const r = schema.safeParse({
      url: 'http://target/page?id=1',
      action: 'detect_only',
      dbms: 'mysql',
      extra_args: '--os-shell --batch',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.extra_args).toContain('--os-shell')
      expect(r.data.dbms).toBe('mysql')
    }
  })

  test('file write webshell via extra_args', () => {
    const r = schema.safeParse({
      url: 'http://target/page?id=1',
      extra_args: '--file-write /tmp/shell.php --file-dest /var/www/html/uploads/shell.php --batch',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.extra_args).toContain('--file-write')
  })

  test('WAF bypass with tamper scripts', () => {
    const r = schema.safeParse({
      url: 'http://target/page?id=1',
      action: 'detect_only',
      extra_args: '--tamper=space2comment,between',
    })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.extra_args).toContain('--tamper')
  })

  test('MySQL credential dump via sql-query extra_arg', () => {
    const r = schema.safeParse({
      url: 'http://target/page?id=1',
      action: 'detect_only',
      dbms: 'mysql',
      extra_args: "--technique=S --sql-query='SELECT user,password FROM mysql.user'",
    })
    expect(r.success).toBe(true)
  })

  test('POST-based injection with session cookie', () => {
    const r = schema.safeParse({
      url: 'http://target/api/login',
      method: 'POST',
      data: 'username=admin&password=test',
      cookie: 'PHPSESSID=abc123; csrf_token=xyz789',
      action: 'detect_only',
    })
    expect(r.success).toBe(true)
    if (r.success) {
      expect(r.data.method).toBe('POST')
      expect(r.data.cookie).toContain('PHPSESSID')
    }
  })
})
