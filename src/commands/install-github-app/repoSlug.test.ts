import assert from 'node:assert/strict'
import test from 'node:test'

import { extractGitHubRepoSlug } from './repoSlug.ts'

test('keeps owner/repo input as-is', () => {
  assert.equal(extractGitHubRepoSlug('clpzbug/clpzcode'), 'clpzbug/clpzcode')
})

test('extracts slug from https GitHub URLs', () => {
  assert.equal(
    extractGitHubRepoSlug('https://github.com/clpzbug/clpzcode'),
    'clpzbug/clpzcode',
  )
  assert.equal(
    extractGitHubRepoSlug('https://www.github.com/clpzbug/clpzcode.git'),
    'clpzbug/clpzcode',
  )
})

test('extracts slug from ssh GitHub URLs', () => {
  assert.equal(
    extractGitHubRepoSlug('git@github.com:clpzbug/clpzcode.git'),
    'clpzbug/clpzcode',
  )
  assert.equal(
    extractGitHubRepoSlug('ssh://git@github.com/clpzbug/clpzcode'),
    'clpzbug/clpzcode',
  )
})

test('rejects malformed or non-GitHub URLs', () => {
  assert.equal(extractGitHubRepoSlug('https://gitlab.com/clpzbug/clpzcode'), null)
  assert.equal(extractGitHubRepoSlug('https://github.com/clpzbug'), null)
  assert.equal(extractGitHubRepoSlug('not actually github.com/clpzbug/clpzcode'), null)
  assert.equal(
    extractGitHubRepoSlug('https://evil.example/?next=github.com/clpzbug/clpzcode'),
    null,
  )
  assert.equal(
    extractGitHubRepoSlug('https://github.com.evil.example/clpzbug/clpzcode'),
    null,
  )
  assert.equal(
    extractGitHubRepoSlug('https://example.com/github.com/clpzbug/clpzcode'),
    null,
  )
})
