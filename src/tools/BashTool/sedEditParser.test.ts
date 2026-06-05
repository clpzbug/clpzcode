import { expect, test } from 'bun:test'

import { applySedSubstitution, type SedEditInfo } from './sedEditParser.js'

function sedInfo(pattern: string, replacement: string, extendedRegex = false): SedEditInfo {
  return {
    filePath: 'example.txt',
    pattern,
    replacement,
    flags: 'g',
    extendedRegex,
  }
}

test('BRE mode keeps unescaped plus literal', () => {
  const result = applySedSubstitution(
    'a+b and aaab',
    sedInfo('a+b', 'literal-plus'),
  )

  expect(result).toBe('literal-plus and aaab')
})

test('BRE mode treats escaped plus as one-or-more', () => {
  const result = applySedSubstitution(
    'abbb and a+b',
    sedInfo('ab\\+', 'one-or-more'),
  )

  expect(result).toBe('one-or-more and a+b')
})

test('BRE mode preserves escaped backslashes', () => {
  const result = applySedSubstitution(
    String.raw`foo\bar foo/bar`,
    sedInfo(String.raw`foo\\bar`, 'backslash-match'),
  )

  expect(result).toBe('backslash-match foo/bar')
})

// Replacement-side fidelity vs GNU sed (regression for silent edit corruption).
test('literal $1 in the replacement stays literal (sed does not interpret $N)', () => {
  expect(applySedSubstitution('xab', sedInfo(String.raw`\(a\)b`, '$1'))).toBe('x$1')
})

test('sed backreference \\1 expands to the captured group', () => {
  expect(applySedSubstitution('xab', sedInfo(String.raw`\(a\)b`, String.raw`\1`))).toBe('xa')
})

test('replacement with $` and $\' stays literal (not JS pre/post-match)', () => {
  expect(applySedSubstitution('xab', sedInfo('ab', '[$`]'))).toBe('x[$`]')
})

test('& expands to the whole match; \\& is a literal ampersand', () => {
  expect(applySedSubstitution('xab', sedInfo('ab', '[&]'))).toBe('x[ab]')
  expect(applySedSubstitution('xab', sedInfo('ab', String.raw`\&`))).toBe('x&')
})

test('BRE interval \\{n\\} is converted to a quantifier', () => {
  expect(applySedSubstitution('aaa', sedInfo(String.raw`a\{2\}`, 'X'))).toBe('Xa')
})
