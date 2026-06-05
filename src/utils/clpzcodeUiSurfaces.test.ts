import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { homedir } from 'os'
import { join } from 'path'
import {
  acquireSharedMutationLock,
  releaseSharedMutationLock,
} from '../test/sharedMutationLock.js'

import { isInGlobalClaudeFolder } from '../components/permissions/FilePermissionDialog/permissionOptions.tsx'
import { optionForPermissionSaveDestination } from '../components/permissions/rules/AddPermissionRules.tsx'
import {
  getClaudeSkillScope,
  isClaudeSettingsPath,
} from './permissions/filesystem.ts'
import { getValidationTip } from './settings/validationTips.ts'

const originalConfigDir = process.env.CLAUDE_CONFIG_DIR

beforeEach(async () => {
  await acquireSharedMutationLock('clpzcodeUiSurfaces.test.ts')
})

afterEach(() => {
  try {
    if (originalConfigDir === undefined) {
      delete process.env.CLAUDE_CONFIG_DIR
    } else {
      process.env.CLAUDE_CONFIG_DIR = originalConfigDir
    }
  } finally {
    releaseSharedMutationLock()
  }
})

describe('clpzcode settings path surfaces', () => {
  test('isClaudeSettingsPath recognizes project .clpzcode settings files', () => {
    expect(
      isClaudeSettingsPath(
        join(process.cwd(), '.clpzcode', 'settings.json'),
      ),
    ).toBe(true)

    expect(
      isClaudeSettingsPath(
        join(process.cwd(), '.clpzcode', 'settings.local.json'),
      ),
    ).toBe(true)
  })

  test('permission save destinations point user settings to ~/.clpzcode', () => {
    expect(optionForPermissionSaveDestination('userSettings')).toEqual({
      label: 'User settings',
      description: 'Saved in ~/.clpzcode/settings.json',
      value: 'userSettings',
    })
  })

  test('permission save destinations point project settings to .clpzcode', () => {
    expect(optionForPermissionSaveDestination('projectSettings')).toEqual({
      label: 'Project settings',
      description: 'Checked in at .clpzcode/settings.json',
      value: 'projectSettings',
    })

    expect(optionForPermissionSaveDestination('localSettings')).toEqual({
      label: 'Project settings (local)',
      description: 'Saved in .clpzcode/settings.local.json',
      value: 'localSettings',
    })
  })

  test('permission dialog treats ~/.clpzcode as the global Claude folder', () => {
    process.env.CLAUDE_CONFIG_DIR = join(homedir(), '.clpzcode')

    expect(
      isInGlobalClaudeFolder(
        join(homedir(), '.clpzcode', 'settings.json'),
      ),
    ).toBe(true)
    expect(
      isInGlobalClaudeFolder(join(homedir(), '.claude', 'settings.json')),
    ).toBe(true)
  })

  test('permission dialog does not treat arbitrary CLAUDE_CONFIG_DIR as the global Claude folder', () => {
    process.env.CLAUDE_CONFIG_DIR = join(homedir(), 'custom-clpzcode')

    expect(
      isInGlobalClaudeFolder(
        join(homedir(), 'custom-clpzcode', 'settings.json'),
      ),
    ).toBe(false)
  })

  test('global skill scope recognizes ~/.clpzcode and legacy ~/.claude skills', () => {
    process.env.CLAUDE_CONFIG_DIR = join(homedir(), '.clpzcode')

    expect(
      getClaudeSkillScope(
        join(homedir(), '.clpzcode', 'skills', 'demo', 'SKILL.md'),
      ),
    ).toEqual({
      skillName: 'demo',
      pattern: '~/.clpzcode/skills/demo/**',
    })

    expect(
      getClaudeSkillScope(
        join(homedir(), '.claude', 'skills', 'legacy', 'SKILL.md'),
      ),
    ).toEqual({
      skillName: 'legacy',
      pattern: '~/.claude/skills/legacy/**',
    })
  })

  test('global skill scope does not emit fixed rules for arbitrary CLAUDE_CONFIG_DIR skills', () => {
    process.env.CLAUDE_CONFIG_DIR = join(homedir(), 'custom-clpzcode')

    expect(
      getClaudeSkillScope(
        join(homedir(), 'custom-clpzcode', 'skills', 'demo', 'SKILL.md'),
      ),
    ).toBe(null)
  })
})

describe('clpzcode validation tips', () => {
  test('permissions.defaultMode invalid value keeps suggestion but no Claude docs link', () => {
    const tip = getValidationTip({
      path: 'permissions.defaultMode',
      code: 'invalid_value',
      enumValues: [
        'acceptEdits',
        'bypassPermissions',
        'default',
        'dontAsk',
        'plan',
      ],
    })

    expect(tip).toEqual({
      suggestion:
        'Valid modes: "acceptEdits" (ask before file changes), "plan" (analysis only), "bypassPermissions" (auto-accept all), or "default" (standard behavior)',
    })
  })
})
