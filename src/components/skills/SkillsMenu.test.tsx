import { afterAll, expect, mock, test } from 'bun:test'
import React from 'react'
import { Box } from '../../ink.js'

import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../../test/sharedMutationLock.js'
import { renderToString } from '../../utils/staticRender.js'

await acquireSharedMutationLock('components/skills/SkillsMenu.test.tsx')

// Mock Dialog to render children directly (avoids keybinding context requirement)
mock.module('../design-system/Dialog.js', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <Box>{children}</Box>,
}))

mock.module('../ConfigurableShortcutHint.js', () => ({
  ConfigurableShortcutHint: () => null,
}))

mock.module('../../skills/loadSkillsDir.js', () => ({
  estimateSkillFrontmatterTokens: () => 1500,
  getSkillsPath: () => '/home/user/.claude/skills',
}))

mock.module('../../utils/file.js', () => ({
  getDisplayPath: (p: string) => p,
}))

mock.module('../../utils/settings/constants.js', () => ({
  getSettingSourceName: (source: string) => source,
}))

const { SkillsMenu } = await import('./SkillsMenu.js')

afterAll(() => releaseSharedMutationLock())

function makeSkill(name: string, source = 'userSettings') {
  return {
    type: 'prompt' as const,
    name,
    description: `${name} skill`,
    source,
    loadedFrom: 'skills' as const,
    progressMessage: 'Running...',
    contentLength: 3000,
    getPromptForCommand: async () => [],
  }
}

test('renders skill name in list', async () => {
  const commands = [makeSkill('my-skill')]
  const output = await renderToString(
    <SkillsMenu onExit={() => {}} commands={commands as any} />,
    120,
  )
  expect(output).toContain('my-skill')
})

test('renders token count as trailing element', async () => {
  const commands = [makeSkill('my-skill')]
  const output = await renderToString(
    <SkillsMenu onExit={() => {}} commands={commands as any} />,
    120,
  )
  // estimateSkillFrontmatterTokens returns 1500 → formatTokens → "1.5k"
  expect(output).toContain('~1.5k')
})

test('renders multiple skills from different sources', async () => {
  const commands = [
    makeSkill('user-skill', 'userSettings'),
    makeSkill('project-skill', 'projectSettings'),
  ]
  const output = await renderToString(
    <SkillsMenu onExit={() => {}} commands={commands as any} />,
    120,
  )
  expect(output).toContain('user-skill')
  expect(output).toContain('project-skill')
})

test('renders empty state message when no skills', async () => {
  const output = await renderToString(
    <SkillsMenu onExit={() => {}} commands={[]} />,
    120,
  )
  // Empty state shows instructions for creating skills
  expect(output).toContain('.claude/skills/')
})

test('renders token count for each skill (trailing pattern)', async () => {
  const commands = [makeSkill('skill-a'), makeSkill('skill-b')]
  const output = await renderToString(
    <SkillsMenu onExit={() => {}} commands={commands as any} />,
    120,
  )
  // Both skills should have token count trailing — count occurrences
  const matches = output.match(/~1\.5k/g)
  expect(matches?.length).toBe(2)
})
