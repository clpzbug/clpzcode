// scripts/selfverify.ts
//
// SINGLE self-verification gate for clpzcode. Run this before any commit/milestone:
//
//     bun run scripts/selfverify.ts
//
// It runs eight gates in sequence and prints a structured PASS/FAIL summary. The
// process exit code is 0 only if every gate passes — so it works as a CI/commit
// gate with no human in the loop. OpenTUI is the DEFAULT renderer; legacy Ink is the
// CLPZCODE_RENDERER=ink fallback.
//
//   1. typecheck       — `tsc --noEmit`. Zero errors allowed; fails on ANY diagnostic.
//   2. build           — `bun run build` (default = OpenTUI) must succeed.
//   3. test            — fast targeted `bun test` of stable leaf suites (--all).
//   4. launch          — `bun dist/cli.mjs --help` loads the full command tree (incl.
//                        externalized react-reconciler) + exits 0, no crash.
//   5. boot-render-bun — drive the default (OpenTUI) bundle in a PTY under BUN (its
//                        production runtime) and assert the Zen boot frame renders.
//   6. fullscreen-welcome — boot under Bun with fullscreen forced and assert the
//                        "clpzcode" wordmark + welcome constellation render.
//   7. boot-launcher   — drive the REAL launcher `node bin/clpzcode`, which reads the
//                        dist/renderer marker and re-execs under Bun for OpenTUI —
//                        proves the node→bun production entry path.
//   8. ink-legacy      — build CLPZCODE_RENDERER=ink + boot under NODE + restore the
//                        default (OpenTUI). Keeps the node-renderable fallback green.
//
// Renderer-agnostic by design: the boot gates drive the actual binary through a PTY and
// reconstruct the screen from ANSI (see scripts/lib/ptyScreen.ts), so the same frame
// assertions hold for OpenTUI (default) and the Ink fallback alike.
//
// Flags:
//   --all       run the FULL `bun test` suite in gate 3 (slow) instead of the
//               fast targeted subset.
//   --verbose   print captured stdout/stderr/snapshots for every gate, not just
//               failures.

import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const PTY_DRIVE = join(ROOT, 'scripts', 'lib', 'pty-drive.mjs')

// node-pty is a native node addon and DOES NOT WORK under bun (pty.spawn exits
// immediately with 0 bytes — verified). This orchestrator runs under `bun run`,
// so the PTY boot-render gate is delegated to scripts/lib/pty-drive.mjs run under
// real node. Resolve the node binary here. (dist/cli.mjs is also a node bundle
// and the real launcher bin/clpzcode runs it under node, so this matches reality.)
function resolveNodeBin(): string {
  const r = spawnSync('node', ['-e', 'process.stdout.write(process.execPath)'], {
    encoding: 'utf8',
  })
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim()
  if (/\bnode$/.test(process.execPath) || process.argv0 === 'node') return process.execPath
  return 'node'
}
const NODE_BIN = resolveNodeBin()

// Production runtime is Bun (OpenTUI is Bun-only). The PTY driver itself stays
// under node (node-pty captures 0 bytes under bun), but it can spawn `bun
// dist/cli.mjs` as the CHILD inside the PTY — the broken-pty-under-bun issue
// only applies when node-pty runs IN the bun process, not when bun is the child.
function resolveBunBin(): string {
  const r = spawnSync('bun', ['-e', 'process.stdout.write(process.execPath)'], {
    encoding: 'utf8',
  })
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim()
  return 'bun'
}
const BUN_BIN = resolveBunBin()

const ARGV = process.argv.slice(2)
const RUN_ALL_TESTS = ARGV.includes('--all')
const VERBOSE = ARGV.includes('--verbose') || ARGV.includes('-v')

// ── typecheck baseline ──────────────────────────────────────────────────────
// Zero tsc errors allowed. (The two long-standing Spinner.tsx errors were fixed by
// casting Object.values(s.tasks) to TaskState[].) Any diagnostic now fails the gate.
const ALLOWED_TS_ERRORS: readonly string[] = []

// Fast, stable, leaf-level suites: no network, no API keys, quick. Gate 3 default.
const FAST_TEST_TARGETS = [
  'src/utils/clpzcodePaths.test.ts',
  'src/screens/REPL.eviction.test.ts',
  'src/screens/REPL.submit.test.ts',
  'scripts/feature-flags-source-guard.test.ts',
] as const

// ── result model ────────────────────────────────────────────────────────────

type GateResult = {
  name: string
  ok: boolean
  /** One-line headline for the summary table. */
  summary: string
  /** Detail shown on failure (or always, with --verbose). */
  detail?: string
}

const C = {
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
}

function runCmd(
  cmd: string,
  args: string[],
  opts: { timeoutMs?: number; env?: Record<string, string> } = {},
): { code: number | null; stdout: string; stderr: string; timedOut: boolean } {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: opts.timeoutMs ?? 300_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, CI: '1', FORCE_COLOR: '0', ...opts.env },
  })
  const timedOut = r.error?.message?.includes('ETIMEDOUT') === true || r.signal === 'SIGTERM'
  return {
    code: r.status,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    timedOut,
  }
}

// ── gate 1: typecheck ────────────────────────────────────────────────────────

function gateTypecheck(): GateResult {
  const name = 'typecheck'
  const r = runCmd('npx', ['tsc', '--noEmit'], { timeoutMs: 180_000 })
  const out = `${r.stdout}\n${r.stderr}`
  const errorLines = out
    .split('\n')
    .map(l => l.trim())
    .filter(l => /\.tsx?\(\d+,\d+\): error TS/.test(l))

  const unexpected = errorLines.filter(
    line => !ALLOWED_TS_ERRORS.some(allowed => line.includes(allowed)),
  )
  const missingKnown = ALLOWED_TS_ERRORS.filter(
    allowed => !errorLines.some(line => line.includes(allowed)),
  )

  if (r.timedOut) {
    return { name, ok: false, summary: 'tsc timed out', detail: out.slice(-2000) }
  }
  if (unexpected.length > 0) {
    return {
      name,
      ok: false,
      summary: `${unexpected.length} TS error(s) (zero allowed)`,
      detail: unexpected.join('\n'),
    }
  }
  // If a "known" error vanished, the baseline drifted — surface it but don't fail:
  // fewer errors is good. We only FAIL on NEW errors.
  const note =
    missingKnown.length > 0
      ? ` (note: known baseline error(s) no longer present: ${missingKnown.join(', ')} — update ALLOWED_TS_ERRORS)`
      : ''
  return {
    name,
    ok: true,
    summary: errorLines.length === 0 ? 'no TS errors' : `${errorLines.length} whitelisted error(s)${note}`,
    detail: VERBOSE ? errorLines.join('\n') : undefined,
  }
}

// ── gate 2: build ────────────────────────────────────────────────────────────

function gateBuild(): GateResult {
  const name = 'build'
  // Force the DEFAULT (opentui) build regardless of any CLPZCODE_RENDERER exported in
  // the parent env, so this gate (and the boot gates that run its output) can't be
  // silently mislabeled by a stray `export CLPZCODE_RENDERER=ink`.
  const r = runCmd('bun', ['run', 'build'], { timeoutMs: 300_000, env: { CLPZCODE_RENDERER: '' } })
  if (r.timedOut) {
    return { name, ok: false, summary: 'build timed out', detail: (r.stdout + r.stderr).slice(-2000) }
  }
  if (r.code !== 0) {
    return {
      name,
      ok: false,
      summary: `build exited ${r.code}`,
      detail: (r.stdout + '\n' + r.stderr).slice(-3000),
    }
  }
  return {
    name,
    ok: true,
    summary: 'bun run build succeeded',
    detail: VERBOSE ? r.stdout.slice(-1500) : undefined,
  }
}

// ── gate 3: tests ─────────────────────────────────────────────────────────────

function gateTest(): GateResult {
  const name = 'test'
  const args = RUN_ALL_TESTS ? ['test'] : ['test', ...FAST_TEST_TARGETS]
  const r = runCmd('bun', args, { timeoutMs: RUN_ALL_TESTS ? 600_000 : 120_000 })
  const out = `${r.stdout}\n${r.stderr}`
  if (r.timedOut) {
    return { name, ok: false, summary: 'bun test timed out', detail: out.slice(-2000) }
  }
  // bun test prints "N fail" and exits non-zero on failure.
  const failMatch = out.match(/(\d+)\s+fail/)
  const passMatch = out.match(/(\d+)\s+pass/)
  const failCount = failMatch ? parseInt(failMatch[1], 10) : r.code === 0 ? 0 : -1
  if (r.code !== 0 || failCount > 0) {
    return {
      name,
      ok: false,
      summary: `bun test failed (${failCount >= 0 ? `${failCount} failing` : `exit ${r.code}`})`,
      detail: out.slice(-3000),
    }
  }
  const scope = RUN_ALL_TESTS ? 'full suite' : `${FAST_TEST_TARGETS.length} fast suites`
  return {
    name,
    ok: true,
    summary: `${passMatch ? passMatch[1] : '?'} tests passed (${scope})`,
    detail: VERBOSE ? out.slice(-1500) : undefined,
  }
}

// ── gate 4: launch (no ReferenceError) ────────────────────────────────────────

function gateLaunch(): GateResult {
  const name = 'launch'
  // Run the DEFAULT (OpenTUI) bundle directly under BUN — its production runtime.
  // --help loads the full command tree (incl. the externalized react-reconciler that
  // node can't resolve) then exits. Bypasses bin/clpzcode's re-exec to see any
  // load-time crash immediately.
  const r = runCmd('bun', ['dist/cli.mjs', '--help'], { timeoutMs: 60_000 })
  const out = `${r.stdout}\n${r.stderr}`
  if (r.timedOut) {
    return { name, ok: false, summary: '--help timed out (hung on load)', detail: out.slice(-2000) }
  }
  const crashSignatures = [
    /ReferenceError/,
    /is not defined/,
    /Cannot find (module|package)/,
    /SyntaxError/,
    /TypeError: .* is not a function/,
  ]
  const crash = crashSignatures.find(re => re.test(out))
  if (crash) {
    return {
      name,
      ok: false,
      summary: `load-time crash matched /${crash.source}/`,
      detail: out.slice(-3000),
    }
  }
  if (r.code !== 0) {
    return { name, ok: false, summary: `--help exited ${r.code}`, detail: out.slice(-3000) }
  }
  if (!out.includes('Usage: clpzcode')) {
    return {
      name,
      ok: false,
      summary: 'help output missing "Usage: clpzcode"',
      detail: out.slice(0, 2000),
    }
  }
  return { name, ok: true, summary: 'bun dist/cli.mjs --help loaded & exited 0' }
}

// ── gate 5: PTY boot-render ───────────────────────────────────────────────────

async function gateBootRender(
  commandBin: string,
  name: string,
  override: {
    args?: string[]
    extraEnv?: Record<string, string>
    checks?: { label: string; test: (s: string) => boolean }[]
    readySubstrings?: string[]
    /** Boot in fullscreen (alt-screen) instead of forcing scrollback. */
    fullscreen?: boolean
  } = {},
): Promise<GateResult> {
  // Expected elements of the Zen boot frame (BootReveal + ZenLogo specs + chevron).
  // Matched against the reconstructed screen snapshot, tolerant of spacing. These
  // are renderer-agnostic: the OpenTUI screen must preserve the same brand/specs/
  // chevron, so this gate holds across the Ink→OpenTUI migration unchanged.
  const checks: { label: string; test: (s: string) => boolean }[] = override.checks ?? [
    { label: 'brand "clpzcode"', test: s => /clpzcode/.test(s) },
    { label: 'version "v<semver>"', test: s => /v\d+\.\d+\.\d+/.test(s) },
    { label: 'specs label "Model"', test: s => /\bModel\b/.test(s) },
    { label: 'specs label "Path"', test: s => /\bPath\b/.test(s) },
    { label: 'specs label "Mode"', test: s => /\bMode\b/.test(s) },
    { label: 'prompt chevron "›"', test: s => s.includes('›') },
  ]

  // Delegate the PTY drive to the node-native helper (node-pty can't run in bun);
  // commandBin is the runtime that launches the CLI as the PTY child (node or bun).
  const opts = {
    command: commandBin,
    args: override.args ?? ['dist/cli.mjs', '--bare'],
    cwd: ROOT,
    cols: 100,
    rows: 30,
    // --bare keeps boot deterministic; CLPZCODE_HEAP_SET avoids the node heap re-exec
    // in the dist-direct gates (the boot-launcher gate overrides args to bin/clpzcode,
    // where the node→bun re-exec is exactly what we want to exercise).
    // Default forces scrollback (CLAUDE_CODE_NO_FLICKER=0) to validate the Zen
    // ZenLogo boot frame (brand+version+specs+chevron). With fullscreen:true we
    // force alt-screen (=1) instead, to validate the default OpenTUI launch
    // visual — the centered WelcomeHero constellation (no Model/Path/Mode specs).
    env: {
      CLPZCODE_HEAP_SET: '1',
      CI: '1',
      FORCE_COLOR: '1',
      CLAUDE_CODE_NO_FLICKER: override.fullscreen ? '1' : '0',
      ...override.extraEnv,
    },
    // Stop as soon as all boot elements (chevron last) are on screen.
    readySubstrings: override.readySubstrings ?? ['clpzcode', 'Mode', '›'],
    idleMs: 1500,
    timeoutMs: 12_000,
  }
  const proc = spawnSync(NODE_BIN, [PTY_DRIVE, JSON.stringify(opts)], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 20_000,
    maxBuffer: 16 * 1024 * 1024,
  })
  if (proc.status !== 0 || !proc.stdout.trim()) {
    return {
      name,
      ok: false,
      summary: `PTY helper failed (exit ${proc.status})`,
      detail: (proc.stdout + '\n' + proc.stderr).slice(-2000),
    }
  }
  let res: { snapshot: string; raw: string; reason: string; exitCode: number | null }
  try {
    res = JSON.parse(proc.stdout.trim().split('\n').pop() as string)
  } catch (err) {
    return {
      name,
      ok: false,
      summary: `could not parse PTY helper output: ${String(err)}`,
      detail: proc.stdout.slice(-2000),
    }
  }

  const snap = res.snapshot
  const crash = /ReferenceError|is not defined|Cannot find (module|package)|UnhandledPromiseRejection|SyntaxError/.test(
    res.raw,
  )
  const failed = checks.filter(c => !c.test(snap))

  const detail =
    `stop reason: ${res.reason}; raw ${res.raw.length}B; exitCode ${res.exitCode}\n` +
    `--- SNAPSHOT ---\n${snap}\n--- END SNAPSHOT ---`

  if (crash) {
    return { name, ok: false, summary: 'crash signature in boot stream', detail }
  }
  if (res.reason === 'exit' && res.exitCode !== 0 && res.exitCode !== null) {
    // A clean TUI should NOT exit on its own; a non-zero exit means it bailed.
    return { name, ok: false, summary: `TUI exited early (code ${res.exitCode})`, detail }
  }
  if (failed.length > 0) {
    return {
      name,
      ok: false,
      summary: `boot frame missing: ${failed.map(f => f.label).join(', ')}`,
      detail,
    }
  }
  return {
    name,
    ok: true,
    summary: `Zen boot frame rendered (brand+version+specs+chevron), no crash [${res.reason}]`,
    detail: VERBOSE ? detail : undefined,
  }
}

// ── gate: legacy Ink build boots under node ────────────────────────────────────
//
// OpenTUI is now the DEFAULT (gate 2 builds it; the bun + launcher boot gates exercise
// it). The legacy Ink renderer (CLPZCODE_RENDERER=ink) is the fallback that runs under
// plain node. This gate builds it, boots it under node, then REBUILDS the default
// (opentui) so dist is left canonical for the production launcher.
function restoreDefaultBuild(): { ok: boolean; detail: string } {
  // Clear CLPZCODE_RENDERER (≠ 'ink') so the restore produces the default opentui build,
  // never inheriting an 'ink' override from a polluted parent env.
  const r = runCmd('bun', ['run', 'build'], { timeoutMs: 300_000, env: { CLPZCODE_RENDERER: '' } })
  return { ok: !r.timedOut && r.code === 0, detail: (r.stdout + '\n' + r.stderr).slice(-1500) }
}

// If the default rebuild fails, dist may be left in an inconsistent/ink state — a real
// breakage (the launcher would run the wrong/partial bundle), so it must FAIL loudly
// (re-run `bun run build` to repair).
function restoreOrFail(name: string, primary: GateResult): GateResult {
  const restored = restoreDefaultBuild()
  if (restored.ok) return primary
  return {
    name,
    ok: false,
    summary: 'DEFAULT BUILD RESTORE FAILED — dist left in ink state; run `bun run build`',
    detail: `(primary gate result: ${primary.ok ? 'PASS' : 'FAIL'} — ${primary.summary})\n${restored.detail}`,
  }
}

async function gateInkLegacy(): Promise<GateResult> {
  const name = 'ink-legacy'
  const build = runCmd('bun', ['run', 'build'], {
    timeoutMs: 300_000,
    env: { CLPZCODE_RENDERER: 'ink' },
  })
  if (build.timedOut || build.code !== 0) {
    return restoreOrFail(name, {
      name,
      ok: false,
      summary: build.timedOut ? 'ink build timed out' : `ink build exited ${build.code}`,
      detail: (build.stdout + '\n' + build.stderr).slice(-3000),
    })
  }
  // Ink renders under plain node — boot it there to prove the fallback runtime.
  const boot = await gateBootRender(NODE_BIN, name)
  return restoreOrFail(name, boot)
}

// ── orchestration ─────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const t0 = Date.now()
  process.stdout.write(C.bold('\nclpzcode self-verify\n'))
  process.stdout.write(C.dim(`root: ${ROOT}${RUN_ALL_TESTS ? '  [--all]' : ''}\n\n`))

  const results: GateResult[] = []

  // Ordered & sequential: each gate depends on the prior (build needs typecheck-
  // clean source; launch/boot need a fresh build). Stop running later gates if an
  // earlier hard prerequisite fails, but still report them as SKIPPED.
  const gates: { name: string; run: () => GateResult | Promise<GateResult>; postBuild: boolean }[] = [
    { name: 'typecheck', run: gateTypecheck, postBuild: false },
    { name: 'build', run: gateBuild, postBuild: false }, // hard prereq for launch/boot
    { name: 'test', run: gateTest, postBuild: false },
    { name: 'launch', run: gateLaunch, postBuild: true },
    // Default = OpenTUI: boot the built bundle directly under Bun (its production
    // runtime). This is the primary render gate.
    { name: 'boot-render-bun', run: () => gateBootRender(BUN_BIN, 'boot-render-bun'), postBuild: true },
    // The DEFAULT launch visual under OpenTUI: fullscreen alt-screen, empty state =
    // the centered WelcomeHero ORTHOGRAM figure. Previously ungated (the scrollback
    // gates force CLAUDE_CODE_NO_FLICKER=0). Boot under Bun with fullscreen forced
    // and assert the "clpzcode" wordmark + at least one drawn frame rule.
    {
      name: 'fullscreen-welcome',
      run: () =>
        gateBootRender(BUN_BIN, 'fullscreen-welcome', {
          fullscreen: true,
          readySubstrings: ['clpzcode'],
          checks: [
            { label: 'brand "clpzcode"', test: s => /clpzcode/.test(s) },
            { label: 'frame rule', test: s => /[─│╭╮╰╯+|-]/.test(s) },
          ],
        }),
      postBuild: true,
    },
    // Production entry: drive the REAL launcher (node bin/clpzcode), which reads the
    // dist/renderer marker and re-execs under Bun for the OpenTUI default. Proves the
    // node→bun re-exec path end users actually hit.
    {
      name: 'boot-launcher',
      run: () => gateBootRender(NODE_BIN, 'boot-launcher', { args: ['bin/clpzcode', '--bare'] }),
      postBuild: true,
    },
    // Legacy Ink fallback: build CLPZCODE_RENDERER=ink + boot under node, then restore
    // the default opentui bundle. Keeps the node-renderable fallback green.
    { name: 'ink-legacy', run: gateInkLegacy, postBuild: true },
  ]

  let buildFailed = false
  for (const g of gates) {
    if (g.postBuild && buildFailed) {
      results.push({ name: g.name, ok: false, summary: 'SKIPPED — build failed' })
      continue
    }
    const started = Date.now()
    const r = await g.run()
    const ms = Date.now() - started
    process.stdout.write(
      `${r.ok ? C.green('  PASS') : C.red('  FAIL')}  ${r.name.padEnd(16)} ${C.dim(`${ms}ms`)}  ${r.summary}\n`,
    )
    if ((!r.ok || VERBOSE) && r.detail) {
      const indented = r.detail
        .split('\n')
        .map(l => '         ' + l)
        .join('\n')
      process.stdout.write(C.dim(indented) + '\n')
    }
    results.push(r)
    if (g.name === 'build' && !r.ok) buildFailed = true
  }

  const passed = results.filter(r => r.ok).length
  const allOk = results.every(r => r.ok)
  const totalMs = Date.now() - t0

  process.stdout.write('\n' + C.dim('─'.repeat(60)) + '\n')
  process.stdout.write(
    `${allOk ? C.green(C.bold('ALL GATES PASSED')) : C.red(C.bold('GATE FAILURE'))}` +
      `  ${passed}/${results.length} green  ${C.dim(`(${totalMs}ms)`)}\n`,
  )
  if (!allOk) {
    const reds = results.filter(r => !r.ok).map(r => r.name)
    process.stdout.write(C.red(`  red: ${reds.join(', ')}\n`))
  }
  process.stdout.write('\n')

  process.exit(allOk ? 0 : 1)
}

main().catch(err => {
  process.stderr.write(`selfverify: fatal ${String(err?.stack ?? err)}\n`)
  process.exit(2)
})
