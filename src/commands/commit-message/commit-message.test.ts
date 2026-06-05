import { describe, expect, it } from 'bun:test'
import {
  formatCoAuthorTrailer,
  parseCoAuthor,
  stripMatchingQuotes,
  USAGE,
} from './commit-message.js'

describe('commit-message command helpers', () => {
  it('parses quoted co-author names with a plain email', () => {
    expect(parseCoAuthor('"GPT 5.5" noreply@clpzcode.dev')).toEqual({
      name: 'GPT 5.5',
      email: 'noreply@clpzcode.dev',
    })
  })

  it('parses co-author trailers with angle-bracket emails', () => {
    expect(parseCoAuthor('clpzcode (gpt-5.5) <noreply@clpzcode.dev>')).toEqual(
      {
        name: 'clpzcode (gpt-5.5)',
        email: 'noreply@clpzcode.dev',
      },
    )
  })

  it('rejects co-author trailers with empty sanitized names', () => {
    expect(parseCoAuthor('"  " noreply@clpzcode.dev')).toBeNull()
    expect(parseCoAuthor('"  " <noreply@clpzcode.dev>')).toBeNull()
  })

  it('strips one pair of matching quotes from custom attribution text', () => {
    expect(stripMatchingQuotes('"Generated with clpzcode"')).toBe(
      'Generated with clpzcode',
    )
    expect(stripMatchingQuotes("'Generated with clpzcode'")).toBe(
      'Generated with clpzcode',
    )
    expect(stripMatchingQuotes('"Generated with clpzcode')).toBe(
      '"Generated with clpzcode',
    )
  })

  it('formats a sanitized co-author trailer', () => {
    expect(
      formatCoAuthorTrailer('clpzcode <gpt>\n', '<noreply@clpzcode.dev>'),
    ).toBe('Co-Authored-By: clpzcode gpt <noreply@clpzcode.dev>')
  })

  it('makes set scope explicit with example text', () => {
    expect(USAGE).toContain(
      'Controls only the attribution text appended after /commit messages.',
    )
    expect(USAGE).toContain(
      '/commit-message set "Generated with clpzcode using GPT-5.5"',
    )
    expect(USAGE).not.toContain('/commit-message set-attribution')
  })
})
