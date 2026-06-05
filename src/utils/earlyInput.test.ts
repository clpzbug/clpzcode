// src/utils/earlyInput.test.ts
//
// Regression guard for the kitty capability-response leak: when OpenTUI (the
// default renderer) fires its startup capability queries, the terminal floods
// replies (OSC 10/11, XTVERSION DCS, DECRQM, kitty kbd/graphics, OSC 99, DA1,
// CPR, window size). Early-input capture must DISCARD those escape sequences,
// never buffer their payloads as "typed" prompt text. The old single-pass skip
// treated the CSI/OSC/DCS introducer as the terminator and leaked the rest.
import { afterEach, describe, expect, test } from 'bun:test'
import { PassThrough } from 'stream'
import {
  startCapturingEarlyInput,
  consumeEarlyInput,
  stopCapturingEarlyInput,
} from './earlyInput.js'

const ESC = '\x1b'
const ST = ESC + '\\'
// The exact reply burst kitty 0.46.2 sends back (decoded from the bug report).
const SEQS = [
  ESC + ']10;rgb:eaea/d3d3/dbdb' + ST,
  ESC + ']11;rgb:1b1b/1a1a/2020' + ST,
  ESC + 'P>|kitty(0.46.2)' + ST,
  ESC + '[19;1R',
  ESC + '[?1016;2$y',
  ESC + '[?2027;0$y',
  ESC + '[?2031;1$y',
  ESC + '[?1004;2$y',
  ESC + '[?2004;2$y',
  ESC + '[?2026;2$y',
  ESC + '[?0u',
  ESC +
    ']99;i=opentui-notifications:p=?;a=focus,report:o=always,unfocused,invisible:u=0,1,2:p=title,body,?,close,icon,alive,buttons:c=1:w=1:s=system,silent,error,info,question,warn,warning' +
    ST,
  ESC + '[1;2R',
  ESC + '[1;3R',
  ESC + '[4;900;1773t',
  ESC + '_Gi=31337;OK' + ST,
  ESC + '[?62;52;c',
]
const BURST = SEQS.join('')

const realStdin = process.stdin
function fakeTtyStdin() {
  const s = new PassThrough() as unknown as NodeJS.ReadStream & PassThrough
  // earlyInput requires a TTY and calls setRawMode/ref before reading.
  Object.defineProperty(s, 'isTTY', { value: true, configurable: true })
  ;(s as unknown as { setRawMode: () => unknown }).setRawMode = () => s
  ;(s as unknown as { ref: () => unknown }).ref = () => s
  Object.defineProperty(process, 'stdin', { value: s, configurable: true })
  return s
}
const tick = () => new Promise(r => setImmediate(r))

afterEach(() => {
  stopCapturingEarlyInput()
  consumeEarlyInput() // drain buffer between tests
  Object.defineProperty(process, 'stdin', { value: realStdin, configurable: true })
})

// Feed `writes` (each a separate stdin read) through a fresh capture session and
// return what consumeEarlyInput() yields.
async function capture(writes: string[]): Promise<string> {
  const s = fakeTtyStdin()
  startCapturingEarlyInput()
  for (const w of writes) {
    s.write(w)
    await tick()
  }
  await tick()
  return consumeEarlyInput()
}

describe('earlyInput capability-response leak', () => {
  test('the whole capability burst arriving as one read leaks NOTHING', async () => {
    expect(await capture([BURST])).toBe('')
  })

  test('each reply as a separate read leaks nothing', async () => {
    expect(await capture(SEQS)).toBe('')
  })

  test('replies split mid-sequence across reads leak nothing (cross-chunk state)', async () => {
    const halves: string[] = []
    for (const s of SEQS) {
      const mid = Math.max(1, Math.floor(s.length / 2))
      halves.push(s.slice(0, mid), s.slice(mid))
    }
    expect(await capture(halves)).toBe('')
  })

  test('16-byte reads cutting across sequence boundaries leak nothing', async () => {
    const chunks: string[] = []
    for (let i = 0; i < BURST.length; i += 16) chunks.push(BURST.slice(i, i + 16))
    expect(await capture(chunks)).toBe('')
  })

  test('genuinely-typed text interleaved with the burst keeps only the text', async () => {
    expect(await capture([SEQS[0]!, 'fix the ', SEQS[3]!, 'bug', SEQS[8]!])).toBe('fix the bug')
  })
})

describe('earlyInput normal keystroke handling (unchanged behavior)', () => {
  test('plain typed text is buffered verbatim', async () => {
    expect(await capture(['hello world'])).toBe('hello world')
  })

  test('arrow / cursor keys are skipped, not buffered as letters', async () => {
    // ESC[A ESC[B ESC[C ESC[D — the old skip would have left "ABCD".
    expect(await capture([ESC + '[A' + ESC + '[B' + ESC + '[C' + ESC + '[D'])).toBe('')
  })

  test('arrow keys interleaved with text keep only the text', async () => {
    expect(await capture(['ab' + ESC + '[A' + 'cd'])).toBe('abcd')
  })

  test('backspace removes the previous character', async () => {
    expect(await capture(['abc\x7f'])).toBe('ab')
  })

  test('carriage return becomes a newline', async () => {
    expect(await capture(['a\rb'])).toBe('a\nb')
  })

  test('SS3 function-key sequences (ESC O P) are skipped', async () => {
    expect(await capture([ESC + 'OP' + 'x'])).toBe('x')
  })
})
