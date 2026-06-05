import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'

const TEMPLATES = ['next-app', 'react-vite', 'api-hono', 'api-fastapi', 'landing'] as const

const schema = z.strictObject({
  template: z.enum(TEMPLATES),
  name: z.string().min(1),
  path: z.string().optional(),
  install: z.boolean().default(true),
})

describe('ScaffoldTool schema', () => {
  test('aceita next-app com nome', () => {
    const r = schema.safeParse({ template: 'next-app', name: 'my-app' })
    expect(r.success).toBe(true)
  })

  test('default install=true', () => {
    const r = schema.safeParse({ template: 'next-app', name: 'my-app' })
    if (r.success) expect(r.data.install).toBe(true)
  })

  test('aceita todos os templates', () => {
    for (const template of TEMPLATES) {
      const r = schema.safeParse({ template, name: 'test-project' })
      expect(r.success).toBe(true)
    }
  })

  test('aceita path customizado', () => {
    const r = schema.safeParse({
      template: 'api-hono',
      name: 'my-api',
      path: '/home/user/projects',
    })
    expect(r.success).toBe(true)
  })

  test('aceita install=false', () => {
    const r = schema.safeParse({ template: 'react-vite', name: 'app', install: false })
    if (r.success) expect(r.data.install).toBe(false)
  })

  test('aceita api-fastapi sem path', () => {
    const r = schema.safeParse({ template: 'api-fastapi', name: 'backend' })
    expect(r.success).toBe(true)
  })

  test('aceita landing page', () => {
    const r = schema.safeParse({ template: 'landing', name: 'landing-page' })
    expect(r.success).toBe(true)
  })

  test('rejeita sem template', () => {
    const r = schema.safeParse({ name: 'my-app' })
    expect(r.success).toBe(false)
  })

  test('rejeita sem name', () => {
    const r = schema.safeParse({ template: 'next-app' })
    expect(r.success).toBe(false)
  })

  test('rejeita name vazio', () => {
    const r = schema.safeParse({ template: 'next-app', name: '' })
    expect(r.success).toBe(false)
  })

  test('rejeita template inválido', () => {
    const r = schema.safeParse({ template: 'express-app', name: 'my-app' })
    expect(r.success).toBe(false)
  })
})
