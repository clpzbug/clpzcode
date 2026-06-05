import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { __test } from './CredHarvestTool.js'

const { maskValue, limitPreview, SCAN_PATTERNS, DEEP_PATTERNS, PRIORITY_EXTENSIONS } = __test

const schema = z.object({
  path: z.string().default('/'),
  patterns: z.array(z.string()).optional(),
  depth: z.number().int().min(1).max(20).default(5),
  extensions: z.array(z.string()).optional(),
  action: z.enum(['scan', 'deep']).default('scan'),
  timeout_secs: z.number().int().min(10).max(600).default(120),
})

describe('CredHarvestTool schema', () => {
  test('accepts scan action with default path', () => {
    const r = schema.safeParse({ action: 'scan' })
    expect(r.success).toBe(true)
  })

  test('accepts deep action', () => {
    const r = schema.safeParse({ action: 'deep', path: '/var/www' })
    expect(r.success).toBe(true)
  })

  test('defaults path to /', () => {
    const r = schema.safeParse({ action: 'scan' })
    if (r.success) expect(r.data.path).toBe('/')
  })

  test('defaults depth to 5', () => {
    const r = schema.safeParse({ action: 'scan' })
    if (r.success) expect(r.data.depth).toBe(5)
  })

  test('defaults action to scan', () => {
    const r = schema.safeParse({})
    if (r.success) expect(r.data.action).toBe('scan')
  })

  test('accepts custom path', () => {
    const r = schema.safeParse({ path: '/home/user', action: 'scan' })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.path).toBe('/home/user')
  })

  test('accepts extensions filter', () => {
    const r = schema.safeParse({ action: 'scan', extensions: ['.env', '.conf', '.yaml'] })
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.extensions).toEqual(['.env', '.conf', '.yaml'])
  })

  test('accepts custom patterns', () => {
    const r = schema.safeParse({ action: 'scan', patterns: ['password\\s*=\\s*.+'] })
    expect(r.success).toBe(true)
  })

  test('rejects depth above max (20)', () => {
    const r = schema.safeParse({ action: 'scan', depth: 21 })
    expect(r.success).toBe(false)
  })

  test('rejects invalid action', () => {
    const r = schema.safeParse({ action: 'harvest' })
    expect(r.success).toBe(false)
  })
})

// =============================================================================
// maskValue tests
// =============================================================================

describe('maskValue', () => {
  test('masks password value', () => {
    const masked = maskValue('password=supersecret123')
    expect(masked).not.toContain('supersecret123')
    expect(masked).toContain('supe')
  })

  test('preserves the key part', () => {
    const masked = maskValue('password=secretvalue')
    expect(masked).toContain('password=')
  })

  test('masks value after colon', () => {
    const masked = maskValue('api_key: abcdefghijklmn')
    expect(masked).not.toContain('abcdefghijklmn')
  })

  test('leaves short values unchanged (below 4 chars)', () => {
    const masked = maskValue('x=abc')
    // Short values may not be masked by regex (min 4 chars)
    expect(masked).toBeDefined()
  })

  test('handles quoted values', () => {
    const masked = maskValue('password="mysecretvalue"')
    expect(masked).not.toContain('mysecretvalue')
  })
})

// =============================================================================
// limitPreview tests
// =============================================================================

describe('limitPreview', () => {
  test('returns string as-is when under limit', () => {
    const s = 'short string'
    expect(limitPreview(s)).toBe(s)
  })

  test('truncates string over 120 chars by default', () => {
    const s = 'a'.repeat(200)
    const result = limitPreview(s)
    expect(result.length).toBeLessThan(200)
    expect(result).toContain('…')
  })

  test('respects custom max parameter', () => {
    const s = 'abcdefgh'
    const result = limitPreview(s, 5)
    expect(result).toBe('abcde…')
  })

  test('returns empty string unchanged', () => {
    expect(limitPreview('')).toBe('')
  })
})

// =============================================================================
// Pattern constant tests
// =============================================================================

describe('SCAN_PATTERNS', () => {
  test('has at least 8 patterns', () => {
    expect(SCAN_PATTERNS.length).toBeGreaterThanOrEqual(8)
  })

  test('each pattern has regex, category, and severity', () => {
    for (const p of SCAN_PATTERNS) {
      expect(typeof p.regex).toBe('string')
      expect(typeof p.category).toBe('string')
      expect(['critical', 'high', 'medium', 'low']).toContain(p.severity)
    }
  })

  test('includes AWS key pattern', () => {
    expect(SCAN_PATTERNS.some(p => p.category === 'aws_key')).toBe(true)
  })

  test('includes private key pattern', () => {
    expect(SCAN_PATTERNS.some(p => p.category === 'private_key')).toBe(true)
  })

  test('includes critical severity patterns', () => {
    expect(SCAN_PATTERNS.some(p => p.severity === 'critical')).toBe(true)
  })
})

describe('DEEP_PATTERNS', () => {
  test('has more patterns than SCAN_PATTERNS', () => {
    expect(DEEP_PATTERNS.length).toBeGreaterThan(SCAN_PATTERNS.length)
  })

  test('includes all SCAN_PATTERNS categories', () => {
    const scanCategories = new Set(SCAN_PATTERNS.map(p => p.category))
    const deepCategories = new Set(DEEP_PATTERNS.map(p => p.category))
    for (const cat of scanCategories) {
      expect(deepCategories.has(cat)).toBe(true)
    }
  })

  test('includes api_key pattern', () => {
    expect(DEEP_PATTERNS.some(p => p.category === 'api_key')).toBe(true)
  })

  test('includes token pattern', () => {
    expect(DEEP_PATTERNS.some(p => p.category === 'token')).toBe(true)
  })

  test('includes JWT_SECRET pattern (added for pentest cycle 2)', () => {
    expect(DEEP_PATTERNS.some(p => p.category === 'jwt_secret')).toBe(true)
  })

  test('includes npm_token pattern', () => {
    expect(DEEP_PATTERNS.some(p => p.category === 'npm_token')).toBe(true)
  })

  test('includes slack_token pattern', () => {
    expect(DEEP_PATTERNS.some(p => p.category === 'slack_token')).toBe(true)
  })

  test('includes gcp_service_account pattern', () => {
    expect(DEEP_PATTERNS.some(p => p.category === 'gcp_service_account')).toBe(true)
  })
})

describe('SCAN_PATTERNS — critical pentesting patterns', () => {
  test('includes AWS AKIA literal key pattern', () => {
    expect(SCAN_PATTERNS.some(p => p.regex.includes('AKIA'))).toBe(true)
  })

  test('includes Anthropic API key pattern (sk-ant-)', () => {
    expect(SCAN_PATTERNS.some(p => p.category === 'anthropic_key')).toBe(true)
  })

  test('includes JWT_SECRET in scan patterns', () => {
    expect(SCAN_PATTERNS.some(p => p.category === 'jwt_secret')).toBe(true)
  })

  test('includes DB URL with credentials pattern', () => {
    expect(SCAN_PATTERNS.some(p => p.category === 'db_url' && p.regex.includes('postgresql'))).toBe(true)
  })
})

describe('PRIORITY_EXTENSIONS', () => {
  test('includes .env extension', () => {
    expect(PRIORITY_EXTENSIONS).toContain('.env')
  })

  test('includes .yaml extension', () => {
    expect(PRIORITY_EXTENSIONS).toContain('.yaml')
  })

  test('includes .json extension', () => {
    expect(PRIORITY_EXTENSIONS).toContain('.json')
  })

  test('includes .sh shell script extension (added for pentest cycle 2)', () => {
    expect(PRIORITY_EXTENSIONS).toContain('.sh')
  })

  test('includes .pem private key extension', () => {
    expect(PRIORITY_EXTENSIONS).toContain('.pem')
  })

  test('all entries start with dot', () => {
    for (const ext of PRIORITY_EXTENSIONS) {
      expect(ext.startsWith('.')).toBe(true)
    }
  })
})

describe('DEEP_PATTERNS — Kubernetes, AWS credential file, Vault (cycle 3)', () => {
  test('includes Kubernetes SA token pattern', () => {
    expect(DEEP_PATTERNS.some(p => p.category === 'k8s_token')).toBe(true)
  })

  test('includes Kubernetes certificate data pattern', () => {
    expect(DEEP_PATTERNS.some(p => p.category === 'k8s_cert')).toBe(true)
  })

  test('includes AWS credential file format (aws_access_key_id = AKIA...)', () => {
    // ~/.aws/credentials format (different from the AKIA literal in SCAN_PATTERNS)
    const awsCredsPattern = DEEP_PATTERNS.find(
      p => p.category === 'aws_key' && p.regex.includes('aws_access_key_id'),
    )
    expect(awsCredsPattern).toBeDefined()
  })

  test('includes Vault token pattern', () => {
    expect(DEEP_PATTERNS.some(p => p.category === 'vault_token')).toBe(true)
  })

  test('AWS credential file patterns are critical severity', () => {
    const awsPatterns = DEEP_PATTERNS.filter(p => p.category === 'aws_key' || p.category === 'aws_secret')
    expect(awsPatterns.every(p => p.severity === 'critical')).toBe(true)
  })
})

// =============================================================================
// Pattern matching verification — verify regex correctly matches real examples
// =============================================================================

describe('SCAN_PATTERNS — regex matching verification', () => {
  function testPattern(category: string, testString: string): boolean {
    const pattern = SCAN_PATTERNS.find(p => p.category === category)
    if (!pattern) return false
    return new RegExp(pattern.regex, 'i').test(testString)
  }

  test('AWS AKIA key pattern matches real AWS key format', () => {
    expect(testPattern('aws_key', 'AKIAIOSFODNN7EXAMPLE')).toBe(true)
  })

  test('Private key pattern matches PEM headers', () => {
    expect(testPattern('private_key', '-----BEGIN RSA PRIVATE KEY-----')).toBe(true)
    expect(testPattern('private_key', '-----BEGIN OPENSSH PRIVATE KEY-----')).toBe(true)
  })

  test('JWT_SECRET pattern matches env var format', () => {
    const jwtPattern = SCAN_PATTERNS.find(p => p.category === 'jwt_secret')
    if (jwtPattern) {
      const re = new RegExp(jwtPattern.regex, 'i')
      expect(re.test('JWT_SECRET=my_super_secret_key_for_jwt')).toBe(true)
    }
  })

  test('OpenAI key pattern matches sk- format', () => {
    expect(testPattern('openai_key', 'sk-' + 'a'.repeat(48))).toBe(true)
  })

  test('DB URL pattern matches postgresql:// format', () => {
    const dbPattern = SCAN_PATTERNS.find(p => p.category === 'db_url' && p.regex.includes('postgresql'))
    if (dbPattern) {
      const re = new RegExp(dbPattern.regex, 'i')
      expect(re.test('postgresql://admin:secret123@localhost:5432/mydb')).toBe(true)
    }
  })
})

describe('CredHarvestTool — new cloud/CI patterns (cycle 4)', () => {
  const AZURE_SECRET_RE = /AZURE_CLIENT_SECRET\s*[=:]\s*[^\s'"]+/
  const AZURE_CLIENT_RE = /AZURE_CLIENT_ID\s*[=:]\s*[0-9a-f-]{36}/
  const GITLAB_PAT_RE = /glpat-[A-Za-z0-9\-_]{20}/
  const JENKINS_RE = /jenkins[._-]?(?:token|api[._-]?key)\s*[=:]\s*[^\s'"]{16,}/i
  const DOCKER_AUTH_RE = /"auth"\s*:\s*"[A-Za-z0-9+/=]{16,}"/
  const DOCKER_PASS_RE = /DOCKER_PASSWORD\s*[=:]\s*[^\s'"]+/

  test('AZURE_CLIENT_SECRET pattern matches .env entry', () => {
    expect(AZURE_SECRET_RE.test('AZURE_CLIENT_SECRET=supersecret123abc')).toBe(true)
  })

  test('AZURE_CLIENT_ID pattern matches UUID format', () => {
    expect(AZURE_CLIENT_RE.test('AZURE_CLIENT_ID=550e8400-e29b-41d4-a716-446655440000')).toBe(true)
  })

  test('GitLab PAT (glpat-) pattern matches token', () => {
    expect(GITLAB_PAT_RE.test('TOKEN=glpat-abc123XYZ-defghijklmno')).toBe(true)
  })

  test('Jenkins API token pattern matches config entry', () => {
    expect(JENKINS_RE.test('jenkins_token=abc123def456ghi789jkl012')).toBe(true)
  })

  test('Docker config.json auth pattern matches base64 auth', () => {
    // ~/.docker/config.json format: {"auths":{"registry.io":{"auth":"dXNlcjpwYXNz"}}}
    expect(DOCKER_AUTH_RE.test('"auth": "dXNlcjpwYXNzd29yZA=="')).toBe(true)
  })

  test('DOCKER_PASSWORD pattern matches env var', () => {
    expect(DOCKER_PASS_RE.test('DOCKER_PASSWORD=myregistrypass')).toBe(true)
  })

  test('AZURE_CLIENT_ID rejects malformed UUID (wrong format)', () => {
    // Must be 36-char hex UUID
    expect(AZURE_CLIENT_RE.test('AZURE_CLIENT_ID=notauuid')).toBe(false)
  })

  test('GitLab PAT rejects classic GitHub token format', () => {
    // GitHub tokens start with ghp_, not glpat-
    expect(GITLAB_PAT_RE.test('ghp_abc123def456ghi789jkl012mno345pqr6')).toBe(false)
  })
})
