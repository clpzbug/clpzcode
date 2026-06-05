// scripts/lib/pty-drive.mjs
//
// Renderer-agnostic PTY driver + ANSI screen emulator for clpzcode self-verify.
// PLAIN JS / NODE-NATIVE ON PURPOSE.
//
// WHY .mjs AND WHY NODE
// ---------------------
// node-pty is a native addon compiled against node's ABI. Under `bun`, pty.spawn()
// returns immediately with exit 0 and ZERO output — it simply does not work in the
// bun runtime (verified). The self-verify orchestrator runs under `bun run` (repo
// convention), so it cannot drive the PTY itself. Instead it shells out to THIS
// helper under real node:  `node scripts/lib/pty-drive.mjs '<jsonOpts>'`.
// Keeping it dependency-light .mjs means node can execute it directly (no TS loader).
//
// WHAT IT DOES
// ------------
// Drives the REAL binary (node dist/cli.mjs) inside a pseudo-terminal so isatty()
// is true and the TUI renders exactly as a user sees it — then reconstructs the
// visible screen from the raw ANSI stream via a minimal terminal-grid emulator.
// This is the same node-pty primitive used in src/utils/ptyExec.ts; the difference
// is we keep the laid-out frame (a cols×rows char matrix) instead of strip-ansi'ing
// the stream, so we can assert on what's actually painted. It is renderer-agnostic:
// it drives the binary, not the React tree, so it works for today's Ink and a
// future OpenTUI (CLPZCODE_RENDERER=opentui) unchanged.
//
// PROTOCOL
// --------
// argv[2] is a JSON string: { command, args, cwd, cols, rows, env, readySubstrings,
//   timeoutMs, idleMs }. On stdout it prints exactly one JSON line:
//   { snapshot, raw, reason, exitCode }. Exit code is always 0 (the result is the
//   JSON); only an internal failure exits non-zero with an error JSON on stderr.

import * as pty from 'node-pty'
import { readdirSync, readFileSync } from 'node:fs'

// node-pty kills only the PTY leader; the bare CLI re-execs itself under bun and
// spawns MCP servers, all of which would orphan (PPID=1) and leak RAM across
// self-verify runs. Find every process whose environ carries this run's token —
// immune to re-exec timing and reparenting since env is inherited by the tree.
function collectByToken(token) {
  const out = []
  let pids
  try {
    pids = readdirSync('/proc').filter(d => /^\d+$/.test(d))
  } catch {
    return out
  }
  const self = String(process.pid)
  const needle = `CLPZCODE_PTYDRIVE_TOKEN=${token}`
  for (const pid of pids) {
    if (pid === self) continue
    try {
      const environ = readFileSync(`/proc/${pid}/environ`, 'utf8')
      if (environ.split('\0').includes(needle)) out.push(Number(pid))
    } catch {
      // process gone or not ours — skip
    }
  }
  return out
}

// ── ANSI screen-grid emulator ──────────────────────────────────────────────
// Handles cursor motion (CUP/CUU/CUD/CUF/CUB/CNL/CPL/CHA/VPA), erase (ED/EL),
// CR/LF/BS/TAB and printable chars. Sequences that neither move the cursor nor
// paint cells (SGR colors, mode toggles, OSC titles, DCS) are parsed & ignored,
// so they cannot affect the snapshot text. A partial escape at a chunk boundary
// is buffered and retried on the next write(). This is a deliberate subset of a
// real VT — enough to faithfully reproduce a static frame, not to run a game.
function createScreen(cols, rows) {
  let grid
  let cx = 0
  let cy = 0
  let pending = ''

  const blank = () => Array.from({ length: rows }, () => Array(cols).fill(' '))
  grid = blank()

  const clampX = () => {
    if (cx < 0) cx = 0
    if (cx >= cols) cx = cols - 1
  }
  const clampY = () => {
    if (cy < 0) cy = 0
    if (cy >= rows) cy = rows - 1
  }
  const eraseLineFrom = x => {
    for (let i = x; i < cols; i++) grid[cy][i] = ' '
  }
  const eraseLineTo = x => {
    for (let i = 0; i <= x && i < cols; i++) grid[cy][i] = ' '
  }
  const eraseWholeLine = () => {
    for (let i = 0; i < cols; i++) grid[cy][i] = ' '
  }
  const clearAll = () => {
    grid = blank()
  }

  function putChar(ch) {
    if (cy >= 0 && cy < rows && cx >= 0 && cx < cols) grid[cy][cx] = ch
    cx++
    if (cx >= cols) cx = cols - 1 // clamp; no autowrap (Ink positions explicitly)
  }

  function write(data) {
    const s = pending + data
    pending = ''
    let i = 0
    while (i < s.length) {
      const ch = s[i]

      if (ch === '\x1b') {
        const next = s[i + 1]
        if (next === undefined) {
          pending = s.slice(i) // escape at end of chunk — wait for more
          return
        }

        if (next === '[') {
          // CSI: ESC [ <params/intermediates 0x20-0x3f> <final 0x40-0x7e>
          let j = i + 2
          while (j < s.length && s[j] >= '\x20' && s[j] <= '\x3f') j++
          if (j >= s.length) {
            pending = s.slice(i) // incomplete CSI
            return
          }
          const cmd = s[j]
          const raw = s.slice(i + 2, j).replace(/[?<>=!]/g, '')
          const nums = raw.split(';').map(n => (n === '' ? undefined : parseInt(n, 10)))
          const n0 = nums[0]
          switch (cmd) {
            case 'H':
            case 'f':
              cy = (nums[0] || 1) - 1
              cx = (nums[1] || 1) - 1
              clampY()
              clampX()
              break
            case 'A':
              cy -= n0 || 1
              clampY()
              break
            case 'B':
              cy += n0 || 1
              clampY()
              break
            case 'C':
              cx += n0 || 1
              clampX()
              break
            case 'D':
              cx -= n0 || 1
              clampX()
              break
            case 'E':
              cy += n0 || 1
              cx = 0
              clampY()
              break
            case 'F':
              cy -= n0 || 1
              cx = 0
              clampY()
              break
            case 'G':
              cx = (n0 || 1) - 1
              clampX()
              break
            case 'd':
              cy = (n0 || 1) - 1
              clampY()
              break
            case 'J':
              if (n0 === 2 || n0 === 3) {
                clearAll()
                cx = 0
                cy = 0
              } else if (n0 === 1) {
                for (let y = 0; y < cy; y++) for (let x = 0; x < cols; x++) grid[y][x] = ' '
                eraseLineTo(cx)
              } else {
                eraseLineFrom(cx)
                for (let y = cy + 1; y < rows; y++) for (let x = 0; x < cols; x++) grid[y][x] = ' '
              }
              break
            case 'K':
              if (!n0 || n0 === 0) eraseLineFrom(cx)
              else if (n0 === 1) eraseLineTo(cx)
              else eraseWholeLine()
              break
            default:
              break // SGR/mode/DSR/scroll/etc. — no snapshot effect
          }
          i = j + 1
          continue
        }

        if (next === ']' || next === 'P' || next === 'X' || next === '^' || next === '_') {
          // OSC/DCS/SOS/PM/APC string: terminated by BEL or ST (ESC \)
          let j = i + 2
          let terminated = false
          while (j < s.length) {
            if (s[j] === '\x07') {
              j++
              terminated = true
              break
            }
            if (s[j] === '\x1b' && s[j + 1] === '\\') {
              j += 2
              terminated = true
              break
            }
            j++
          }
          if (!terminated) {
            pending = s.slice(i) // unterminated — wait for more
            return
          }
          i = j
          continue
        }

        i += 2 // ESC + single byte (charset/RIS/etc.)
        continue
      }

      if (ch === '\r') cx = 0
      else if (ch === '\n') {
        cy++
        if (cy >= rows) cy = rows - 1 // no scrollback; clamp at bottom
      } else if (ch === '\b') {
        cx--
        clampX()
      } else if (ch === '\t') {
        cx = Math.min(cols - 1, (Math.floor(cx / 8) + 1) * 8)
      } else if (ch >= ' ') {
        putChar(ch)
      }
      i++
    }
  }

  function snapshot() {
    return grid
      .map(row => row.join('').replace(/\s+$/u, ''))
      .join('\n')
      .replace(/\n+$/u, '')
  }

  return { write, snapshot }
}

// ── PTY driver ──────────────────────────────────────────────────────────────

function driveTui(opts) {
  const cols = opts.cols ?? 100
  const rows = opts.rows ?? 30
  const timeoutMs = opts.timeoutMs ?? 8000
  const idleMs = opts.idleMs ?? 1200
  const readySubstrings = opts.readySubstrings ?? []
  // Optional scripted input: once the ready substrings appear, send these
  // keystrokes to the PTY (each { data, delayMs }), then finish on idle. Lets the
  // harness prove INTERACTION (composer typing/submit), not just first render.
  // With no steps, behavior is unchanged (finish on ready).
  const steps = opts.steps ?? []

  const screen = createScreen(cols, rows)
  let raw = ''

  const mergedEnv = {}
  for (const [k, v] of Object.entries({ ...process.env, ...(opts.env ?? {}) })) {
    if (v !== undefined) mergedEnv[k] = v
  }
  // Unique token tagged onto the whole spawned tree. The bare launcher re-execs
  // itself under bun (spawnSync) and spawns MCP servers; all inherit this env,
  // so a /proc environ sweep reaps the entire tree at teardown regardless of
  // re-exec timing or reparenting — node-pty's proc.kill only hits the leader.
  const leakToken = `PTYDRIVE_${process.pid}_${Date.now()}`
  mergedEnv.CLPZCODE_PTYDRIVE_TOKEN = leakToken

  const proc = pty.spawn(opts.command ?? process.execPath, opts.args, {
    name: 'xterm-256color',
    cols,
    rows,
    cwd: opts.cwd,
    env: mergedEnv,
  })

  const isReady = snap => readySubstrings.length > 0 && readySubstrings.every(sub => snap.includes(sub))

  return new Promise(res => {
    let settled = false
    let exitCode = null
    let idleTimer = null

    const finish = reason => {
      if (settled) return
      settled = true
      if (idleTimer) clearTimeout(idleTimer)
      clearTimeout(hardTimer)
      dataDisp.dispose()
      exitDisp.dispose()
      // Reap SYNCHRONOUSLY here: mainCli calls process.exit(0) right after this
      // promise resolves, which would race (and skip) any setTimeout/unref'd
      // backstop. proc.kill only hits the PTY leader; the bare launcher re-execs
      // under bun (spawnSync) and spawns MCP servers that survive. SIGKILL every
      // process still carrying this run's unique token — the whole tree.
      const doomed =
        process.platform !== 'win32' ? collectByToken(leakToken) : []
      try {
        proc.kill('SIGKILL')
      } catch {}
      for (const pid of doomed) {
        try {
          process.kill(pid, 'SIGKILL')
        } catch {}
      }
      res({ snapshot: screen.snapshot(), raw, reason, exitCode })
    }

    const bumpIdle = () => {
      if (idleTimer) clearTimeout(idleTimer)
      idleTimer = setTimeout(() => finish('idle'), idleMs)
      idleTimer.unref?.()
    }

    let stepsStarted = false
    const runSteps = async () => {
      for (const s of steps) {
        await new Promise(r => {
          const t = setTimeout(r, s.delayMs ?? 250)
          t.unref?.()
        })
        if (settled) return
        try {
          proc.write(s.data)
        } catch {}
      }
      bumpIdle()
    }

    const dataDisp = proc.onData(d => {
      raw += d
      screen.write(d)
      if (isReady(screen.snapshot())) {
        if (steps.length > 0) {
          // Drive the scripted keystrokes once, then finish on idle.
          if (!stepsStarted) {
            stepsStarted = true
            runSteps()
          }
          return
        }
        finish('ready')
        return
      }
      bumpIdle()
    })

    const exitDisp = proc.onExit(({ exitCode: code, signal }) => {
      exitCode = code ?? (signal ? 128 + signal : null)
      finish('exit')
    })

    const hardTimer = setTimeout(() => finish('timeout'), timeoutMs)
    hardTimer.unref?.()
  })
}

// ── CLI entry: read opts JSON from argv, print result JSON on stdout ──────────

async function mainCli() {
  const arg = process.argv[2]
  if (!arg) {
    process.stderr.write(JSON.stringify({ error: 'missing JSON opts argument' }) + '\n')
    process.exit(2)
  }
  let opts
  try {
    opts = JSON.parse(arg)
  } catch (e) {
    process.stderr.write(JSON.stringify({ error: `bad JSON opts: ${String(e)}` }) + '\n')
    process.exit(2)
  }
  try {
    const result = await driveTui(opts)
    process.stdout.write(JSON.stringify(result) + '\n')
    process.exit(0)
  } catch (e) {
    process.stderr.write(JSON.stringify({ error: `drive failed: ${String(e?.stack ?? e)}` }) + '\n')
    process.exit(2)
  }
}

mainCli()
