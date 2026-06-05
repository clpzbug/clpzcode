import { execFile } from 'child_process'
import { promisify } from 'util'
import { createHash, randomBytes } from 'crypto'
import { mkdtemp, rm, writeFile, readFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { CRYPTO_TOOL_NAME } from './constants.js'
import { DESCRIPTION, PROMPT } from './prompt.js'
import { renderToolResultMessage, renderToolUseProgressMessage } from './UI.js'

const execFileAsync = promisify(execFile)

const OPERATIONS = [
  'hash', 'encode_base64', 'decode_base64', 'encode_hex', 'decode_hex',
  'encrypt_aes', 'decrypt_aes', 'gen_rsa_key', 'gen_self_signed_cert',
  'parse_cert', 'random_bytes',
] as const

const HASH_ALGOS = ['md5', 'sha1', 'sha256', 'sha512'] as const

const inputSchema = lazySchema(() =>
  z.strictObject({
    operation: z.enum(OPERATIONS).describe('Crypto operation to perform'),
    data: z.string().optional().describe('Input data as string'),
    data_file: z.string().optional().describe('Absolute path to input file'),
    algorithm: z
      .string()
      .optional()
      .describe('Hash algorithm (md5/sha1/sha256/sha512) or cipher (aes-256-cbc)'),
    key: z.string().optional().describe('Encryption key (hex string) or PEM content'),
    password: z.string().optional().describe('Passphrase for AES encrypt/decrypt (alternative to key)'),
    iv: z.string().optional().describe('Initialization vector (hex, 16 bytes for AES)'),
    bits: z.number().int().min(512).max(4096).default(2048).describe('Key size for gen_rsa_key'),
    count: z.number().int().min(1).max(1024).default(32).describe('Byte count for random_bytes'),
    subject: z
      .string()
      .optional()
      .describe('Certificate subject for gen_self_signed_cert (e.g. "/CN=localhost")'),
    days: z
      .number()
      .int()
      .min(1)
      .max(3650)
      .default(365)
      .describe('Certificate validity days'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    operation: z.string(),
    result: z.string(),
    algorithm: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

async function withTmpDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
  const dir = await mkdtemp(join(tmpdir(), 'crypto-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

async function opensslWithFile(args: string[], inputData?: string): Promise<string> {
  if (inputData === undefined) {
    const { stdout } = await execFileAsync('/usr/bin/openssl', args, {
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024,
    })
    return stdout
  }
  return withTmpDir(async dir => {
    const inFile = join(dir, 'input.bin')
    await writeFile(inFile, inputData, 'utf8')
    const { stdout } = await execFileAsync('/usr/bin/openssl', [...args, '-in', inFile], {
      timeout: 30_000,
      maxBuffer: 5 * 1024 * 1024,
    })
    return stdout
  })
}

async function runCrypto(input: z.infer<InputSchema>): Promise<Output> {
  const getData = async (): Promise<string> => {
    if (input.data_file) return readFile(input.data_file, 'utf8')
    return input.data ?? ''
  }

  try {
    switch (input.operation) {
      case 'hash': {
        const algo = input.algorithm ?? 'sha256'
        if (!HASH_ALGOS.includes(algo as typeof HASH_ALGOS[number])) {
          throw new Error(`Unsupported hash algorithm: ${algo}. Use: ${HASH_ALGOS.join(', ')}`)
        }
        const data = await getData()
        const hash = createHash(algo).update(data).digest('hex')
        return { operation: 'hash', result: hash, algorithm: algo }
      }

      case 'encode_base64': {
        const data = await getData()
        return { operation: 'encode_base64', result: Buffer.from(data).toString('base64') }
      }

      case 'decode_base64': {
        const data = (await getData()).trim().replace(/\s+/g, '')
        return { operation: 'decode_base64', result: Buffer.from(data, 'base64').toString('utf8') }
      }

      case 'encode_hex': {
        const data = await getData()
        const hex = Buffer.from(data).toString('hex')
        return { operation: 'encode_hex', result: hex }
      }

      case 'decode_hex': {
        const data = (await getData()).trim().replace(/\s+/g, '')
        const result = Buffer.from(data, 'hex').toString('utf8')
        return { operation: 'decode_hex', result }
      }

      case 'encrypt_aes': {
        const data = await getData()
        return await withTmpDir(async dir => {
          const inFile = join(dir, 'in.txt')
          const outFile = join(dir, 'out.enc')
          await writeFile(inFile, data)
          const args = ['enc', '-aes-256-cbc', '-pbkdf2', '-in', inFile, '-out', outFile, '-base64']
          if (input.key) {
            args.push('-K', input.key)
          } else if (input.password) {
            args.push('-pass', `pass:${input.password}`)
          } else {
            throw new Error('AES encrypt requires key (hex) or password')
          }
          if (input.iv) args.push('-iv', input.iv)
          await execFileAsync('/usr/bin/openssl', args, { timeout: 10_000 })
          const encrypted = await readFile(outFile, 'utf8')
          return { operation: 'encrypt_aes', result: encrypted.trim(), algorithm: 'aes-256-cbc' }
        })
      }

      case 'decrypt_aes': {
        const data = await getData()
        return await withTmpDir(async dir => {
          const inFile = join(dir, 'in.enc')
          const outFile = join(dir, 'out.txt')
          await writeFile(inFile, data)
          const args = ['enc', '-d', '-aes-256-cbc', '-pbkdf2', '-in', inFile, '-out', outFile, '-base64']
          if (input.key) {
            args.push('-K', input.key)
          } else if (input.password) {
            args.push('-pass', `pass:${input.password}`)
          } else {
            throw new Error('AES decrypt requires key (hex) or password')
          }
          if (input.iv) args.push('-iv', input.iv)
          await execFileAsync('/usr/bin/openssl', args, { timeout: 10_000 })
          const decrypted = await readFile(outFile, 'utf8')
          return { operation: 'decrypt_aes', result: decrypted, algorithm: 'aes-256-cbc' }
        })
      }

      case 'gen_rsa_key': {
        const result = await opensslWithFile(['genrsa', String(input.bits ?? 2048)])
        return { operation: 'gen_rsa_key', result: result.trim(), algorithm: `RSA-${input.bits}` }
      }

      case 'gen_self_signed_cert': {
        const keyPem = await getData()
        return await withTmpDir(async dir => {
          const keyFile = join(dir, 'key.pem')
          const certFile = join(dir, 'cert.pem')
          await writeFile(keyFile, keyPem)
          const subject = input.subject ?? '/CN=localhost'
          await execFileAsync('/usr/bin/openssl', [
            'req', '-new', '-x509', '-key', keyFile, '-out', certFile,
            '-days', String(input.days ?? 365),
            '-subj', subject,
          ], { timeout: 15_000 })
          const cert = await readFile(certFile, 'utf8')
          return { operation: 'gen_self_signed_cert', result: cert.trim() }
        })
      }

      case 'parse_cert': {
        const certPem = await getData()
        const result = await opensslWithFile(['x509', '-noout', '-text'], certPem)
        return { operation: 'parse_cert', result: result.trim() }
      }

      case 'random_bytes': {
        const hex = randomBytes(input.count ?? 32).toString('hex')
        return { operation: 'random_bytes', result: hex }
      }
    }
  } catch (err) {
    return {
      operation: input.operation,
      result: '',
      error: String(err),
    }
  }
}

export const CryptoTool = buildTool({
  name: CRYPTO_TOOL_NAME,
  searchHint: 'crypto — hashing, base64/hex encoding, AES encryption, RSA key generation, certificate operations',
  maxResultSizeChars: 100_000,
  async description(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `Crypto: ${i.operation ?? 'operation'}`
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
    return i?.operation ? `Crypto:${i.operation}` : 'Crypto'
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return `crypto ${input.operation ?? ''} ${input.algorithm ?? ''}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Authorized pentest engagement tool' },
    }
  },
  getActivityDescription(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `Crypto ${i?.operation ?? '?'}`
  },
  renderToolUseProgressMessage,
  renderToolUseMessage(input) {
    const i = input as Partial<z.infer<InputSchema>>
    return `${i.operation ?? '?'}`
  },
  renderToolResultMessage,
  async call(input) {
    const result = await runCrypto(input)
    return { data: result }
  },
  mapToolResultToToolResultBlockParam(content: Output, toolUseID) {
    if (content.error) {
      return { tool_use_id: toolUseID, type: 'tool_result', content: `Crypto error (${content.operation}): ${content.error}` }
    }
    const algo = content.algorithm ? ` [${content.algorithm}]` : ''
    const header = `[${content.operation}${algo}]\n\n`
    return { tool_use_id: toolUseID, type: 'tool_result', content: header + content.result }
  },
} satisfies ToolDef<InputSchema, Output>)
