import { z } from 'zod/v4'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { buildTool, type ToolDef } from '../../Tool.js'
import { getCwd } from '../../utils/cwd.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { DESCRIPTION, SCAFFOLD_TOOL_NAME } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'
import { TEMPLATES } from './templates/index.js'

export type ScaffoldOutput = {
  template: string
  name: string
  project_path: string
  files_written: number
  dev_cmd: string
  default_port: number
  message: string
}

const TEMPLATE_NAMES = Object.keys(TEMPLATES) as [string, ...string[]]

const inputSchema = lazySchema(() =>
  z.strictObject({
    template: z
      .enum(TEMPLATE_NAMES as [string, ...string[]])
      .describe(
        'Template to use: next-app, react-vite, api-hono, api-fastapi, landing',
      ),
    name: z.string().min(1).describe('Project name (used as directory name)'),
    path: z
      .string()
      .optional()
      .describe('Parent directory (optional, defaults to current directory)'),
    install: z
      .boolean()
      .default(true)
      .describe('Install dependencies after scaffolding (default: true)'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    template: z.string(),
    name: z.string(),
    project_path: z.string(),
    files_written: z.number(),
    dev_cmd: z.string(),
    default_port: z.number(),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>

export const ScaffoldTool = buildTool({
  name: SCAFFOLD_TOOL_NAME,
  searchHint:
    'create a new project from a template — next-app, react-vite, api-hono, api-fastapi, landing',
  maxResultSizeChars: 10_000,
  shouldDefer: false,
  async description(input) {
    const { template, name } = input as { template: string; name: string }
    return `Create ${template} project "${name}"`
  },
  userFacingName() {
    return 'Scaffold'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const s = getToolUseSummary(input)
    return s ? `Scaffolding ${s}` : 'Scaffolding project'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  toAutoClassifierInput(input) {
    return `${input.template} ${input.name}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Project scaffolding' },
    }
  },
  async prompt() {
    return DESCRIPTION
  },
  async validateInput(input) {
    const { template } = input
    if (!TEMPLATES[template]) {
      return {
        result: false,
        message: `Unknown template "${template}". Available: ${Object.keys(TEMPLATES).join(', ')}`,
        meta: { reason: 'unknown_template' },
        errorCode: 1,
      }
    }
    return { result: true }
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  async call(input, { abortController }) {
    const { template: templateName, name, path: basePath, install } = input
    const tmpl = TEMPLATES[templateName]!
    const projectPath = join(basePath ?? getCwd(), name)

    const files = tmpl.files(name)

    for (const file of files) {
      abortController.signal.throwIfAborted()
      const fullPath = join(projectPath, file.path)
      await mkdir(dirname(fullPath), { recursive: true })
      await writeFile(fullPath, file.content, 'utf8')
    }

    if (install !== false && tmpl.installCmd) {
      abortController.signal.throwIfAborted()
      const { execa } = await import('execa')
      try {
        await execa('zsh', ['-c', tmpl.installCmd], {
          cwd: projectPath,
          timeout: 120000,
        })
      } catch {
        // Non-fatal — project files are written, just deps not installed
      }
    }

    const result: ScaffoldOutput = {
      template: templateName,
      name,
      project_path: projectPath,
      files_written: files.length,
      dev_cmd: tmpl.devCmd,
      default_port: tmpl.defaultPort,
      message: `Project "${name}" created at ${projectPath}. Run: ${tmpl.devCmd}`,
    }

    return { data: result }
  },
  mapToolResultToToolResultBlockParam(result: ScaffoldOutput, toolUseID) {
    const text = [
      `Project "${result.name}" scaffolded from template "${result.template}"`,
      `Path: ${result.project_path}`,
      `Files written: ${result.files_written}`,
      `Dev command: ${result.dev_cmd}`,
      `Default port: ${result.default_port}`,
      '',
      'Next steps:',
      `1. Use Process(action=start, name="${result.name}", cmd="${result.dev_cmd}", cwd="${result.project_path}", port=${result.default_port}) to start the dev server`,
      `2. Use Screenshot(url="http://localhost:${result.default_port}") to see the result`,
    ].join('\n')

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: text,
    }
  },
} satisfies ToolDef<InputSchema, ScaffoldOutput>)
