import { expect, test } from 'bun:test'
import { z } from 'zod/v4'
import { getEmptyToolPermissionContext, type Tool, type Tools } from '../Tool.js'
import { SkillTool } from '../tools/SkillTool/SkillTool.js'
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '../constants/prompts.js'
import { splitSysPromptPrefix, toolToAPISchema } from './api.js'

test('toolToAPISchema preserves provider-specific schema keywords in input_schema', async () => {
  const schema = await toolToAPISchema(
    {
      name: 'WebFetch',
      inputSchema: z.strictObject({}),
      inputJSONSchema: {
        type: 'object',
        properties: {
          url: {
            type: 'string',
            format: 'uri',
            description: 'Public HTTP or HTTPS URL',
          },
          metadata: {
            type: 'object',
            propertyNames: {
              pattern: '^[a-z]+$',
            },
            properties: {
              callback: {
                type: 'string',
                format: 'uri-reference',
              },
            },
          },
        },
      },
      prompt: async () => 'Fetch a URL',
    } as unknown as Tool,
    {
      getToolPermissionContext: async () => getEmptyToolPermissionContext(),
      tools: [] as unknown as Tools,
      agents: [],
    },
  )

  expect(schema).toMatchObject({
    input_schema: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          format: 'uri',
          description: 'Public HTTP or HTTPS URL',
        },
        metadata: {
          type: 'object',
          propertyNames: {
            pattern: '^[a-z]+$',
          },
          properties: {
            callback: {
              type: 'string',
              format: 'uri-reference',
            },
          },
        },
      },
    },
  })
})

test('toolToAPISchema keeps skill required for SkillTool', async () => {
  const schema = await toolToAPISchema(SkillTool, {
    getToolPermissionContext: async () => getEmptyToolPermissionContext(),
    tools: [] as unknown as Tools,
    agents: [],
  })

  expect((schema as { input_schema: unknown }).input_schema).toMatchObject({
    type: 'object',
    required: ['skill'],
  })
})

test('toolToAPISchema removes extra required keys not in properties (MCP schema sanitization)', async () => {
  const schema = await toolToAPISchema(
    {
      name: 'mcp__test__create_object',
      inputSchema: z.strictObject({}),
      inputJSONSchema: {
        type: 'object',
        properties: {
          name: { type: 'string' },
        },
        required: ['name', 'attributes'],
      },
      prompt: async () => 'Create an object',
    } as unknown as Tool,
    {
      getToolPermissionContext: async () => getEmptyToolPermissionContext(),
      tools: [] as unknown as Tools,
      agents: [],
    },
  )

  const inputSchema = (schema as { input_schema: { required?: string[] } }).input_schema
  expect(inputSchema.required).toEqual(['name'])
})

test('splitSysPromptPrefix keeps dynamic content out of the cached prefix + strips the boundary', () => {
  const blocks = splitSysPromptPrefix([
    'STATIC_A',
    'STATIC_B',
    SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
    'DYNAMIC_ENV',
  ] as unknown as Parameters<typeof splitSysPromptPrefix>[0])
  // The boundary marker is internal — it must never reach the API.
  for (const b of blocks) expect(b.text).not.toContain(SYSTEM_PROMPT_DYNAMIC_BOUNDARY)
  // Static content lives in a CACHED block ('org' or 'global').
  const staticBlock = blocks.find(b => b.text.includes('STATIC_A'))
  expect(staticBlock).toBeDefined()
  expect(staticBlock!.cacheScope === 'org' || staticBlock!.cacheScope === 'global').toBe(true)
  // Dynamic content lives in an UNCACHED block (cacheScope null), so an env/git
  // change can't invalidate the cached static prefix — and they are separate blocks.
  const dynBlock = blocks.find(b => b.text.includes('DYNAMIC_ENV'))
  expect(dynBlock).toBeDefined()
  expect(dynBlock!.cacheScope).toBeNull()
  expect(staticBlock).not.toBe(dynBlock)
})
