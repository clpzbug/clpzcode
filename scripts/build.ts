/**
 * clpzcode build script — bundles the TypeScript source into a single
 * distributable JS file using Bun's bundler.
 *
 * Handles:
 * - bun:bundle feature() flags for the open build
 * - MACRO.* globals → inlined version/build-time constants
 * - src/ path aliases
 */

import { readFileSync, rmSync, writeFileSync } from 'fs'
import { noTelemetryPlugin } from './no-telemetry-plugin'
import { CLI_EXTERNALS, SDK_EXTERNALS } from './externals.js'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const version = pkg.version

// Renderer selection. OpenTUI is the DEFAULT; CLPZCODE_RENDERER=ink builds the legacy
// Ink renderer (the only one that runs under plain node). The launcher (bin/clpzcode)
// reads the dist/renderer marker written below to pick the runtime (bun for opentui).
const RENDERER = process.env.CLPZCODE_RENDERER === 'ink' ? 'ink' : 'opentui'
const USE_OPENTUI = RENDERER === 'opentui'

// Feature flags for the open build.
// Most Anthropic-internal features stay off; open-build features can be
// selectively enabled here when their full source exists in the mirror.
const featureFlags: Record<string, boolean> = {
  // ── Disabled: require Anthropic infrastructure or missing source ─────
  VOICE_MODE: false,              // Push-to-talk STT via claude.ai OAuth endpoint
  PROACTIVE: false,               // Autonomous agent mode (missing proactive/ module)
  KAIROS: false,                  // Persistent assistant/session mode (cloud backend)
  BRIDGE_MODE: false,             // Remote desktop bridge via CCR infrastructure
  DAEMON: false,                  // Background daemon process (stubbed in open build)
  AGENT_TRIGGERS: false,          // Scheduled remote agent triggers
  ABLATION_BASELINE: false,       // A/B testing harness for eval experiments
  CONTEXT_COLLAPSE: false,        // Context collapsing optimization (stubbed)
  COMMIT_ATTRIBUTION: false,      // Co-Authored-By metadata in git commits
  UDS_INBOX: false,               // Unix Domain Socket inter-session messaging
  BG_SESSIONS: false,             // Background sessions via tmux (stubbed)
  WEB_BROWSER_TOOL: false,        // Built-in browser automation (source not mirrored)
  CHICAGO_MCP: false,             // Computer-use MCP (native Swift modules stubbed)
  COWORKER_TYPE_TELEMETRY: false, // Telemetry for agent/coworker type classification
  MCP_SKILLS: false,              // Dynamic MCP skill discovery (src/skills/mcpSkills.ts not mirrored; enabling this causes "fetchMcpSkillsForClient is not a function" when MCP servers with resources connect — see #856)

  // ── Enabled: upstream defaults ──────────────────────────────────────
  COORDINATOR_MODE: true,             // Multi-agent coordinator with worker delegation
  BUILTIN_EXPLORE_PLAN_AGENTS: true,  // Built-in Explore/Plan specialized subagents
  BUDDY: true,                        // Buddy mode for paired programming
  MONITOR_TOOL: true,                 // MCP server monitoring/streaming tool
  TEAMMEM: true,                      // Team memory management
  MESSAGE_ACTIONS: true,              // Message action buttons in the UI

  // ── Enabled: new activations ────────────────────────────────────────
  DUMP_SYSTEM_PROMPT: true,           // --dump-system-prompt CLI flag for debugging
  CACHED_MICROCOMPACT: true,          // Cache-aware tool result truncation optimization
  AWAY_SUMMARY: true,                 // "While you were away" recap after 5min blur
  TRANSCRIPT_CLASSIFIER: true,        // Auto-approval classifier for safe tool uses
  ULTRATHINK: true,                   // Deep thinking mode — type "ultrathink" to boost reasoning
  TOKEN_BUDGET: true,                 // Token budget tracking with usage warnings
  HISTORY_PICKER: true,               // Enhanced interactive prompt history picker
  QUICK_SEARCH: true,                 // Ctrl+G quick search across prompts
  SHOT_STATS: true,                   // Shot distribution stats in session summary
  EXTRACT_MEMORIES: true,             // Auto-extract durable memories from conversations
  FORK_SUBAGENT: true,                // Implicit context-forking when omitting subagent_type
  VERIFICATION_AGENT: true,           // Built-in read-only agent for test/verification
  PROMPT_CACHE_BREAK_DETECTION: true, // Detect & log unexpected prompt cache invalidations
  HOOK_PROMPTS: true,                 // Allow tools to request interactive user prompts
  WORKFLOW_SCRIPTS: true,             // Dynamic Workflows — parallel ultracode agent fleet
}

// ── Pre-process: replace feature() calls with boolean literals ──────
// Bun v1.3.9+ resolves `import { feature } from 'bun:bundle'` natively
// before plugins can intercept it via onResolve. The bun: namespace is
// handled by Bun's C++ resolver which runs before the JS plugin phase,
// so the previous onResolve/onLoad shim was silently ineffective — ALL
// feature() calls evaluated to false regardless of the featureFlags map.
//
// Fix: transform source as Bun loads each module, stripping the bun:bundle
// import and replacing feature('FLAG') calls with their boolean literal.
// The working tree stays immutable while smoke/build runs.

// Match feature('FLAG') calls, including multi-line: feature(\n  'FLAG',\n)
const featureCallRe = /\bfeature\(\s*['"](\w+)['"][,\s]*\)/gs
const featureImportRe = /import\s*\{[^}]*\bfeature\b[^}]*\}\s*from\s*['"]bun:bundle['"];?\s*\n?/g
const featureFlagTransformedFiles = new Set<string>()

const featureFlagPreprocessPlugin = {
  name: 'feature-flag-preprocess',
  setup(build) {
    build.onLoad({ filter: /\.[cm]?tsx?$/ }, args => {
      const normalizedPath = args.path.replace(/\\/g, '/')
      if (!normalizedPath.includes('/src/')) return null

      const raw = readFileSync(args.path, 'utf-8')
      if (!raw.includes('feature(')) return null
      // Only transform files that explicitly import feature from bun:bundle.
      // Prevents false-positive replacement if another package has a feature() function.
      if (!/from\s*['"]bun:bundle['"]/.test(raw)) return null

      let contents = raw
      contents = contents.replace(featureImportRe, '')
      contents = contents.replace(featureCallRe, (_match, name) =>
        String((featureFlags as Record<string, boolean>)[name] ?? false),
      )

      if (contents === raw) return null

      featureFlagTransformedFiles.add(args.path)
      return {
        contents,
        loader: args.path.endsWith('.tsx') || args.path.endsWith('.jsx')
          ? 'tsx'
          : 'ts',
      }
    })
  },
}

let result: Awaited<ReturnType<typeof Bun.build>> | undefined
let sdkResult: Awaited<ReturnType<typeof Bun.build>> | undefined

// Clean content-hashed chunks before building: splitting:true emits
// chunks/[name]-[hash].mjs and Bun never prunes its own outdir, so every
// rebuild left the old hashes behind — they had accumulated to ~2.4GB /
// 28.9k files. Wipe the dir each build so it only ever holds the current set.
rmSync('./dist/chunks', { recursive: true, force: true })

try {

console.log('Building SDK bundle...')
const cliPromise = Bun.build({
  entrypoints: ['./src/entrypoints/cli.tsx'],
  outdir: './dist',
  target: 'node',
  format: 'esm',
  splitting: true,
  sourcemap: 'external',
  minify: false,
  naming: { entry: 'cli.mjs', chunk: 'chunks/[name]-[hash].mjs', asset: '[name]-[hash].[ext]' },
  define: {
    // MACRO.* build-time constants
    // Keep the internal compatibility version high enough to pass
    // first-party minimum-version guards, but expose the real package
    // version separately in clpzcode branding.
    'MACRO.VERSION': JSON.stringify('99.0.0'),
    'MACRO.DISPLAY_VERSION': JSON.stringify(version),
    'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
    'MACRO.ISSUES_EXPLAINER':
      JSON.stringify('report the issue at https://github.com/clpzbug/clpzcode/issues'),
    'MACRO.FEEDBACK_CHANNEL':
      JSON.stringify('https://github.com/clpzbug/clpzcode/issues'),
    'MACRO.PACKAGE_URL': JSON.stringify('@clpz/clpzcode'),
    'MACRO.NATIVE_PACKAGE_URL': 'undefined',
  },
  plugins: [
    noTelemetryPlugin,
    featureFlagPreprocessPlugin,
    {
      name: 'bun-bundle-shim',
      setup(build) {
        const internalFeatureStubModules = new Map([
          [
            '../daemon/workerRegistry.js',
            'export async function runDaemonWorker() { throw new Error("Daemon worker is unavailable in the open build."); }',
          ],
          [
            '../daemon/main.js',
            'export async function daemonMain() { throw new Error("Daemon mode is unavailable in the open build."); }',
          ],
          [
            '../cli/bg.js',
            `
export async function psHandler() { throw new Error("Background sessions are unavailable in the open build."); }
export async function logsHandler() { throw new Error("Background sessions are unavailable in the open build."); }
export async function attachHandler() { throw new Error("Background sessions are unavailable in the open build."); }
export async function killHandler() { throw new Error("Background sessions are unavailable in the open build."); }
export async function handleBgFlag() { throw new Error("Background sessions are unavailable in the open build."); }
`,
          ],
          [
            '../cli/handlers/templateJobs.js',
            'export async function templatesMain() { throw new Error("Template jobs are unavailable in the open build."); }',
          ],
          [
            '../environment-runner/main.js',
            'export async function environmentRunnerMain() { throw new Error("Environment runner is unavailable in the open build."); }',
          ],
          [
            '../self-hosted-runner/main.js',
            'export async function selfHostedRunnerMain() { throw new Error("Self-hosted runner is unavailable in the open build."); }',
          ],
        ] as const)

        // bun:bundle feature() replacement is handled by featureFlagPreprocessPlugin.
        // The previous onResolve/onLoad shim was ineffective in Bun
        // v1.3.9+ because the bun: namespace is resolved natively
        // before the JS plugin phase runs.

        build.onResolve(
          { filter: /^\.\.\/(daemon\/workerRegistry|daemon\/main|cli\/bg|cli\/handlers\/templateJobs|environment-runner\/main|self-hosted-runner\/main)\.js$/ },
          args => {
            if (!internalFeatureStubModules.has(args.path)) return null
            return {
              path: args.path,
              namespace: 'internal-feature-stub',
            }
          },
        )
        build.onLoad(
          { filter: /.*/, namespace: 'internal-feature-stub' },
          args => ({
            contents:
              internalFeatureStubModules.get(args.path) ??
              'export {}',
            loader: 'js',
          }),
        )

        // OpenTUI renderer alias. OpenTUI is now the DEFAULT renderer; the renderer
        // entry module src/ink.ts (imported across the app as ".../ink.js") resolves
        // to the OpenTUI adapter barrel instead of the forked Ink. Legacy Ink is
        // opt-in via CLPZCODE_RENDERER=ink (the launcher then runs under node).
        // Excludes the unrelated src/utils/ink.js helper (also ends in /ink.js).
        if (USE_OPENTUI) {
          const adapterBarrel = new URL(
            '../src/ink-opentui/index.ts',
            import.meta.url,
          ).pathname
          build.onResolve({ filter: /(^|\/)ink\.js$/ }, args => {
            if (/utils\/ink\.js$/.test(args.path)) return undefined
            return { path: adapterBarrel }
          })
          // Many components import forked-Ink LEAF components DIRECTLY (e.g.
          // `import Text from '../../ink/components/Text.js'`), bypassing ink.js.
          // Under OpenTUI those emit ink-text/ink-link intrinsics the reconciler
          // rejects ("Text must be created inside of a text node"). Redirect the
          // leaf modules to their adapter equivalents too. Default-export shapes
          // match (adapter Text default = Text; controls default = Link). Skip the
          // adapter's OWN (type) imports of these leaves to avoid a circular alias.
          const adapterText = new URL('../src/ink-opentui/Text.tsx', import.meta.url).pathname
          const adapterControls = new URL('../src/ink-opentui/controls.tsx', import.meta.url).pathname
          build.onResolve({ filter: /\/ink\/components\/(Text|Link)\.js$/ }, args => {
            if (args.importer.includes('/ink-opentui/')) return undefined
            return { path: /\/Text\.js$/.test(args.path) ? adapterText : adapterControls }
          })
          // ScrollBox is the same story: FullscreenLayout (message-list path),
          // btw, and Tabs import the forked ScrollBox DIRECTLY. Under OpenTUI it
          // emits <ink-box> and reaches into Ink-DOM-only state (dom.js /
          // reconciler.js / scroll node fields), which don't exist here. Redirect
          // it to the OpenTUI-backed adapter, whose default export + ScrollBoxHandle/
          // ScrollBoxProps named exports mirror the forked module's shape. Skip the
          // adapter's OWN (type) import of the forked module to avoid a circular alias.
          const adapterScrollBox = new URL('../src/ink-opentui/scrollbox.tsx', import.meta.url).pathname
          build.onResolve({ filter: /\/ink\/components\/ScrollBox\.js$/ }, args => {
            if (args.importer.includes('/ink-opentui/')) return undefined
            return { path: adapterScrollBox }
          })
          // Box (a few direct importers) → adapter BaseBox; AlternateScreen (wraps
          // the fullscreen REPL tree, REPL.tsx) → adapter container. The forked
          // AlternateScreen emits <ink-box> + writes raw alt-screen escapes; the
          // adapter is a pure fullscreen <box> (OpenTUI's renderer owns the alt
          // screen + mouse already). Same exclusion to avoid self-aliasing.
          const adapterBox = new URL('../src/ink-opentui/Box.tsx', import.meta.url).pathname
          const adapterAltScreen = new URL('../src/ink-opentui/alternate-screen.tsx', import.meta.url).pathname
          build.onResolve({ filter: /\/ink\/components\/(Box|AlternateScreen)\.js$/ }, args => {
            if (args.importer.includes('/ink-opentui/')) return undefined
            return { path: /\/Box\.js$/.test(args.path) ? adapterBox : adapterAltScreen }
          })
          // instances map: 8 callers (thinkback, editor, terminalPanel, promptEditor,
          // useGlobalKeybindings, overlayContext, FullscreenLayout, gracefulShutdown)
          // import the forked-Ink stdout→Ink map and call the Ink-class leaked surface
          // (enterAlternateScreen/exitAlternateScreen/forceRedraw/invalidatePrevFrame/
          // pause/resume/suspendStdin/resumeStdin/onHyperlinkClick) off the looked-up
          // value. Under OpenTUI the Ink class is gone; redirect to the adapter module
          // that re-exports render.tsx's AdapterInstance map (each value backed by the
          // live renderer). Skip the adapter's OWN import (instances.ts imports from
          // ./render.js, never via this alias) to avoid a circular alias.
          const adapterInstances = new URL('../src/ink-opentui/instances.ts', import.meta.url).pathname
          build.onResolve({ filter: /\/ink\/instances\.js$/ }, args => {
            if (args.importer.includes('/ink-opentui/')) return undefined
            return { path: adapterInstances }
          })
          // Text selection hooks: ScrollKeybindingHandler, PromptInputFooterLeftSide,
          // and useCopyOnSelect import useSelection/useHasSelection DIRECTLY from
          // ../ink/hooks/use-selection.js (bypassing ink.js). The forked module
          // reaches into the Ink class's selection engine via the instances map,
          // which doesn't exist under OpenTUI. Redirect it to hooks-extra.tsx, whose
          // useSelection/useHasSelection are backed by the SelectionController (M3,
          // PATH 1 cell-grid shadow) with the IDENTICAL return shape, so those
          // consumers stay drop-in. Skip the adapter's OWN imports to avoid a
          // circular alias (hooks-extra imports SelectionState/FocusMove TYPES from
          // ../ink/selection.js, never use-selection.js, so this is purely defensive).
          const adapterHooksExtra = new URL('../src/ink-opentui/hooks-extra.tsx', import.meta.url).pathname
          build.onResolve({ filter: /\/ink\/hooks\/use-selection\.js$/ }, args => {
            if (args.importer.includes('/ink-opentui/')) return undefined
            return { path: adapterHooksExtra }
          })
          // useTerminalViewport: OffscreenFreeze/Ratchet (and others) import the
          // forked-Ink hook DIRECTLY (bypassing ink.js). That version reads
          // Ink-DOM fields (parentNode/scrollTop/yogaNode) that don't exist on an
          // OpenTUI Renderable, so its visibility math is wrong and the
          // scrollback render-FREEZE silently never engages → off-screen animated
          // rows keep re-rendering. Redirect to hooks-extra's Renderable-backed
          // reimplementation (same export shape). Skip the adapter's own imports.
          // Broad filter (not just /ink/hooks/…) because the forked
          // use-animation-frame.ts imports it via the RELATIVE './…' specifier,
          // which a path-prefixed filter would miss — so its visibility-gated
          // animations would keep ticking off-screen under OpenTUI too.
          build.onResolve({ filter: /(^|\/)use-terminal-viewport\.js$/ }, args => {
            if (args.importer.includes('/ink-opentui/')) return undefined
            return { path: adapterHooksExtra }
          })
        }

        // Resolve native addon and missing snapshot imports to stubs
        for (const mod of [
          'audio-capture-napi',
          'audio-capture.node',
          'image-processor-napi',
          'modifiers-napi',
          'url-handler-napi',
          'color-diff-napi',
          '@anthropic-ai/mcpb',
          '@ant/claude-for-chrome-mcp',
          '@anthropic-ai/sandbox-runtime',
          'asciichart',
          'plist',
          'cacache',
          'fuse',
          'code-excerpt',
          'stack-utils',
        ]) {
          build.onResolve({ filter: new RegExp(`^${mod}$`) }, () => ({
            path: mod,
            namespace: 'native-stub',
          }))
        }
        build.onLoad(
          { filter: /.*/, namespace: 'native-stub' },
          () => ({
            // Comprehensive stub that handles any named export via Proxy
            contents: `
const noop = () => null;
const noopClass = class {};
const handler = {
  get(_, prop) {
    if (prop === '__esModule') return true;
    if (prop === 'default') return new Proxy({}, handler);
    if (prop === 'SandboxRuntimeConfigSchema') return { parse: () => ({}) };
    return noop;
  }
};
const stub = new Proxy(noop, handler);
export default stub;
export const __stub = true;
// Named exports for all known imports
export const SandboxViolationStore = null;
export const SandboxManager = new Proxy({}, { get: () => noop });
export const SandboxRuntimeConfigSchema = { parse: () => ({}) };
export const BROWSER_TOOLS = [];
export const getMcpConfigForManifest = noop;
export const ColorDiff = null;
export const ColorFile = null;
export const getSyntaxTheme = noop;
export const plot = noop;
export const createClaudeForChromeMcpServer = noop;
`,
            loader: 'js',
          }),
        )

        // Resolve .md and .txt file imports to empty string stubs
        build.onResolve({ filter: /\.(md|txt)$/ }, (args) => ({
          path: args.path,
          namespace: 'text-stub',
        }))
        build.onLoad(
          { filter: /.*/, namespace: 'text-stub' },
          () => ({
            contents: `export default '';`,
            loader: 'js',
          }),
        )

        // Pre-scan: find all missing modules that need stubbing
        // (Bun's onResolve corrupts module graph even when returning null,
        //  so we use exact-match resolvers instead of catch-all patterns)
        const fs = require('fs')
        const pathMod = require('path')
        const srcDir = pathMod.resolve(__dirname, '..', 'src')
        const missingModules = new Set<string>()
        const missingModuleExports = new Map<string, Set<string>>()

        // Known missing external packages
        for (const pkg of [
          '@ant/computer-use-mcp',
          '@ant/computer-use-mcp/sentinelApps',
          '@ant/computer-use-mcp/types',
          '@ant/computer-use-swift',
          '@ant/computer-use-input',
        ]) {
          missingModules.add(pkg)
        }

        // Known missing internal-only Anthropic modules (gated by USER_TYPE=ant
        // at runtime, but bun cannot eliminate the branch statically)
        for (const mod of [
          './utils/sessionDataUploader.js',
          'src/cli/up.js',
          'src/cli/rollback.js',
        ]) {
          missingModules.add(mod)
        }

        // Scan source to find imports that can't resolve
        function scanForMissingImports() {
          // Cache fs.existsSync calls — the same resolved path may be checked
          // hundreds of times across files that import the same module.
          const existsCache = new Map<string, boolean>()
          const cachedExists = (p: string): boolean => {
            let v = existsCache.get(p)
            if (v === undefined) { v = fs.existsSync(p); existsCache.set(p, v) }
            return v
          }

          function checkAndRegister(specifier: string, fileDir: string, namedPart: string) {
                const names = namedPart.split(',')
                  .map((s: string) => s.trim().replace(/^type\s+/, ''))
                  .filter((s: string) => s && !s.startsWith('type '))

                // Check src/tasks/ non-relative imports
                if (specifier.startsWith('src/tasks/')) {
                  const resolved = pathMod.resolve(__dirname, '..', specifier)
                  const candidates = [
                    resolved,
                    `${resolved}.ts`, `${resolved}.tsx`,
                    resolved.replace(/\.js$/, '.ts'), resolved.replace(/\.js$/, '.tsx'),
                    pathMod.join(resolved, 'index.ts'), pathMod.join(resolved, 'index.tsx'),
                  ]
                  if (!candidates.some((c: string) => cachedExists(c))) {
                    missingModules.add(specifier)
                  }
                }
                // Check relative .js imports
                else if (specifier.endsWith('.js') && (specifier.startsWith('./') || specifier.startsWith('../'))) {
                  const resolved = pathMod.resolve(fileDir, specifier)
                  const tsVariant = resolved.replace(/\.js$/, '.ts')
                  const tsxVariant = resolved.replace(/\.js$/, '.tsx')
                  if (!cachedExists(resolved) && !cachedExists(tsVariant) && !cachedExists(tsxVariant)) {
                    missingModules.add(specifier)
                  }
                }

                // Track named exports for missing modules
                if (names.length > 0) {
                  if (!missingModuleExports.has(specifier)) missingModuleExports.set(specifier, new Set())
                  for (const n of names) missingModuleExports.get(specifier)!.add(n)
                }
          }

          function walk(dir: string) {
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
              const full = pathMod.join(dir, ent.name)
              if (ent.isDirectory()) { walk(full); continue }
              if (!/\.(ts|tsx)$/.test(ent.name)) continue
              const rawCode: string = fs.readFileSync(full, 'utf-8')
              const fileDir = pathMod.dirname(full)

              // Strip comments before scanning for imports/requires.
              // The regex scanner matches require()/import() patterns
              // inside JSDoc comments, causing false-positive missing
              // module detection that breaks the build with noop stubs.
              const code = rawCode
                .replace(/\/\*[\s\S]*?\*\//g, '')  // block comments
                .replace(/\/\/.*$/gm, '')           // line comments

              // Collect static imports: import { X } from '...'
              for (const m of code.matchAll(/import\s+(?:\{([^}]*)\}|(\w+))?\s*(?:,\s*\{([^}]*)\})?\s*from\s+['"](.*?)['"]/g)) {
                checkAndRegister(m[4], fileDir, m[1] || m[3] || '')
              }

              // Collect dynamic requires: require('...') — these are used
              // behind feature() gates and become live when flags are enabled.
              for (const m of code.matchAll(/require\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g)) {
                checkAndRegister(m[1], fileDir, '')
              }

              // Collect dynamic imports: import('...')
              for (const m of code.matchAll(/import\(\s*['"](\.\.?\/[^'"]+)['"]\s*\)/g)) {
                checkAndRegister(m[1], fileDir, '')
              }
            }
          }
          walk(srcDir)
        }
        scanForMissingImports()

        // Register exact-match resolvers for each missing module
        for (const mod of missingModules) {
          const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          build.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({
            path: mod,
            namespace: 'missing-module-stub',
          }))
        }

        build.onLoad(
          { filter: /.*/, namespace: 'missing-module-stub' },
          (args) => {
            const names = missingModuleExports.get(args.path) ?? new Set()
            const exports = [...names].map(n => `export const ${n} = noop;`).join('\n')
            return {
              contents: `
const noop = () => null;
export default noop;
${exports}
`,
              loader: 'js',
            }
          },
        )
      },
    },
  ],
  external: CLI_EXTERNALS,
})

// ── SDK Bundle Build ──────────────────────────────────────────────────────
// SDK is a separate bundle for npm consumption - must NOT bundle React/Ink
const sdkPromise = Bun.build({
  entrypoints: ['./src/entrypoints/sdk/index.ts'],
  outdir: './dist',
  target: 'node',
  format: 'esm',
  splitting: false,
  sourcemap: 'external',
  minify: false,
  naming: 'sdk.mjs',
  define: {
    'MACRO.VERSION': JSON.stringify(version),
    'MACRO.DISPLAY_VERSION': JSON.stringify(version),
    'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
    'MACRO.ISSUES_EXPLAINER':
      JSON.stringify('report the issue at https://github.com/clpzbug/clpzcode/issues'),
    'MACRO.FEEDBACK_CHANNEL':
      JSON.stringify('https://github.com/clpzbug/clpzcode/issues'),
    'MACRO.PACKAGE_URL': JSON.stringify('@clpz/clpzcode'),
    'MACRO.NATIVE_PACKAGE_URL': 'undefined',
  },
  // External: everything TUI-related + native modules
  external: SDK_EXTERNALS,
  plugins: [
    noTelemetryPlugin,
    featureFlagPreprocessPlugin,
    // Stub missing internal/optional modules (same pattern as CLI build)
    {
      name: 'sdk-missing-stub',
      setup(build) {
        const missingModules = [
          '@anthropic-ai/mcpb',
          '@ant/claude-for-chrome-mcp',
          '@ant/computer-use-mcp',
          '@ant/computer-use-swift',
          '@ant/computer-use-input',
          '@anthropic-ai/sandbox-runtime',
          'audio-capture-napi', 'audio-capture.node',
          'image-processor-napi', 'modifiers-napi', 'url-handler-napi', 'color-diff-napi',
          'asciichart', 'plist', 'cacache', 'fuse', 'code-excerpt', 'stack-utils',
        ]
        for (const mod of missingModules) {
          const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          build.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({
            path: mod,
            namespace: 'sdk-missing-stub',
          }))
        }
        // Stub relative imports to TUI directories
        // Use (\.\.?\/)+ to match multiple ../ prefixes like ../../components/
        build.onResolve({ filter: /^(\.\.?\/)+components\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /^(\.\.?\/)+ink\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /^(\.\.?\/)+commands\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /^(\.\.?\/)+cli\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        // Stub relative imports to state/ directory EXCEPT for store.js and AppStateStore.js
        // which are React-free utilities needed by the SDK for state management.
        build.onResolve({ filter: /^(\.\.?\/)+state\// }, (args) => {
          // Exclude React-free state utilities from stubbing
          const isReactFreeStateModule =
            args.path.endsWith('store.js') ||
            args.path.endsWith('AppStateStore.js') ||
            args.path.endsWith('store.ts') ||
            args.path.endsWith('AppStateStore.ts')
          if (isReactFreeStateModule) {
            return null // Let Bun resolve normally
          }
          return {
            path: args.path,
            namespace: 'sdk-missing-stub',
          }
        })
        build.onResolve({ filter: /^(\.\.?\/)+context\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        // Stub root ink.js barrel imports (../ink.js, ../../ink.js, ./ink.js)
        // These are TUI entry points that import React directly.
        build.onResolve({ filter: /^(\.\.?\/)+ink\.js$/ }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        // Also stub ./ paths used by re-exports in src/ink.ts, src/components/, etc.
        build.onResolve({ filter: /^\.\/components\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /^\.\/ink\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /^\.\/commands\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /^\.\/cli\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        // Stub tool UI.js imports from within src/tools/ subdirectories.
        // Tool UI modules render React/TUI components that are not needed
        // in the SDK (headless) bundle. Only stub when the importer is
        // inside src/tools/ to avoid blind-matching other UI.js files.
        build.onResolve({ filter: /(?:^|\/)UI\.js$/ }, (args) => {
          // Normalize path separators for cross-platform matching
          const importer = (args.importer || '').replace(/\\/g, '/')
          if (importer.includes('src/tools/')) {
            return {
              path: args.path,
              namespace: 'sdk-missing-stub',
            }
          }
          return null
        })

        // Stub src/ alias imports that resolve to TUI directories
        // These are used by require('src/components/...') style imports
        build.onResolve({ filter: /^src\/components\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /^src\/ink\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        // Stub src/ink.js root barrel import (used by some files via 'src/ink.js')
        build.onResolve({ filter: /^src\/ink\.js$/ }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /^src\/commands\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /^src\/cli\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        // src/state/ contains AppState.tsx with React hooks, but store.ts and AppStateStore.ts
        // are React-free utilities needed by the SDK - exclude them from stubbing.
        build.onResolve({ filter: /^src\/state\// }, (args) => {
          // Exclude React-free state utilities from stubbing
          const isReactFreeStateModule =
            args.path.endsWith('store.js') ||
            args.path.endsWith('AppStateStore.js') ||
            args.path.endsWith('store.ts') ||
            args.path.endsWith('AppStateStore.ts')
          if (isReactFreeStateModule) {
            return null // Let Bun resolve normally
          }
          return {
            path: args.path,
            namespace: 'sdk-missing-stub',
          }
        })
        build.onResolve({ filter: /^src\/context\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        // Stub src/keybindings/ — React-dependent keybinding system not needed in SDK
        build.onResolve({ filter: /^src\/keybindings\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        build.onResolve({ filter: /^(\.\.?\/)+keybindings\// }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))
        // Stub TUI-only React hook files that leak into SDK via tool imports.
        // These are imported transitively through spawnMultiAgent → It2SetupPrompt
        // and through keybinding hooks. The SDK doesn't use TUI features.
        for (const hookPath of [
          'useDoublePress.js', 'useExitOnCtrlCD.js', 'useExitOnCtrlCDWithKeybindings.js',
          'useTerminalSize.js', 'useShortcutDisplay.js',
        ]) {
          const escaped = hookPath.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          build.onResolve({ filter: new RegExp(`(^|/)${escaped}$`) }, (args) => ({
            path: args.path,
            namespace: 'sdk-missing-stub',
          }))
        }
        // Stub It2SetupPrompt.tsx — TUI component pulled in by spawnMultiAgent
        build.onResolve({ filter: /It2SetupPrompt\.js$/ }, (args) => ({
          path: args.path,
          namespace: 'sdk-missing-stub',
        }))

        // Stub react/jsx-dev-runtime with local no-op — tool .tsx files compile
        // to jsxDEV() calls that are never rendered in SDK headless mode.
        // This eliminates the external react/jsx-dev-runtime import entirely.
        build.onResolve({ filter: /^react\/jsx-dev-runtime$/ }, () => ({
          path: 'react/jsx-dev-runtime',
          namespace: 'sdk-jsx-stub',
        }))
        build.onLoad({ filter: /.*/, namespace: 'sdk-jsx-stub' }, () => ({
          contents: `
// No-op jsxDEV: returns null (SDK never renders JSX)
export function jsxDEV(type, props, key, isStaticChildren, source, self) {
  return null;
}
// No-op Fragment: returns null (never used in SDK rendering)
export const Fragment = null;
`,
          loader: 'js',
        }))

        // Resolve .md and .txt file imports (used by yolo-classifier etc.) to empty string stubs
        build.onResolve({ filter: /\.(md|txt)$/, namespace: 'file' }, (args) => ({
          path: args.path,
          namespace: 'sdk-text-stub',
        }))
        build.onLoad(
          { filter: /.*/, namespace: 'sdk-text-stub' },
          () => ({
            contents: `export default '';`,
            loader: 'js',
          }),
        )

        // Stub require() calls to modules that don't exist on disk.
        // These are feature-gated lazy imports (e.g. cachedMCConfig, VerifyPlanExecutionTool,
        // mcpSkills) that only resolve when the feature flag is enabled at build time.
        // Pre-scan source files for require('...') to non-existent .js paths.
        const sdkRequireScanDir = require('path').resolve(__dirname, '..', 'src')
        const sdkMissingRequires = new Set<string>()
        const sdkPathMod = require('path')
        const sdkFs = require('fs')
        function scanSdkRequireImports() {
          function walkRequireScan(dir: string) {
            for (const ent of sdkFs.readdirSync(dir, { withFileTypes: true })) {
              const full = sdkPathMod.join(dir, ent.name)
              if (ent.isDirectory()) { walkRequireScan(full); continue }
              if (!/\.(ts|tsx)$/.test(ent.name)) continue
              const fileDir = sdkPathMod.dirname(full)
              const rawCode: string = sdkFs.readFileSync(full, 'utf-8')
              // Strip comments
              const code = rawCode
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/\/\/.*$/gm, '')
              // Collect require('...') calls for relative .js paths
              for (const m of code.matchAll(/require\(\s*['"](\.\.?\/[^'"]+\.js)['"]\s*\)/g)) {
                const specifier = m[1]
                const resolved = sdkPathMod.resolve(fileDir, specifier)
                const tsVariant = resolved.replace(/\.js$/, '.ts')
                if (!sdkFs.existsSync(resolved) && !sdkFs.existsSync(tsVariant)) {
                  sdkMissingRequires.add(specifier)
                }
              }
            }
          }
          walkRequireScan(sdkRequireScanDir)
        }
        scanSdkRequireImports()
        for (const mod of sdkMissingRequires) {
          const escaped = mod.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
          build.onResolve({ filter: new RegExp(`^${escaped}$`) }, () => ({
            path: mod,
            namespace: 'sdk-missing-stub',
          }))
        }

        // Pre-scan: find all named imports for each stubbed module so we can
        // generate matching exports dynamically (avoids the whack-a-mole of
        // static export lists that break whenever a new import is added).
        const fs = require('fs')
        const pathMod = require('path')
        const srcDir = pathMod.resolve(__dirname, '..', 'src')
        const sdkStubExports = new Map<string, Set<string>>() // module path → set of imported names

        function scanSdkStubImports() {
          function register(specifier: string, namedPart: string) {
            const rawNames = namedPart.split(',')
              .map((s: string) => s.trim().replace(/^type\s+/, ''))
              .filter((s: string) => s && !s.startsWith('type '))
            if (rawNames.length === 0) return
            if (!sdkStubExports.has(specifier)) sdkStubExports.set(specifier, new Set())
            const names = sdkStubExports.get(specifier)!
            for (const s of rawNames) {
              // Handle "originalName as localName" — export BOTH names
              // because Bun validates the original export name exists
              const asMatch = s.match(/^(\w+)\s+as\s+(\w+)$/)
              if (asMatch) {
                names.add(asMatch[1]) // original name
                names.add(asMatch[2]) // aliased name
              } else {
                names.add(s)
              }
            }
          }
          const isStubbedSpecifier = (s: string) =>
            missingModules.includes(s) ||
            /^(\.\.?\/)+(components|ink|commands|cli|context|state|keybindings)\//.test(s) ||
            /^(\.\.?\/)+ink\.js$/.test(s) ||
            /^src\/(components|ink|commands|cli|state|context|keybindings)\//.test(s) ||
            /^src\/ink\.js$/.test(s) ||
            /(?:^|\/)UI\.js$/.test(s) ||
            /(?:^|\/)It2SetupPrompt\.js$/.test(s) ||
            /(?:^|\/)(useDoublePress|useExitOnCtrlCD|useExitOnCtrlCDWithKeybindings|useTerminalSize|useShortcutDisplay)\.js$/.test(s)
          function walk(dir: string) {
            for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
              const full = pathMod.join(dir, ent.name)
              if (ent.isDirectory()) { walk(full); continue }
              if (!/\.(ts|tsx)$/.test(ent.name)) continue
              const fileDir = pathMod.dirname(full)
              const rawCode: string = fs.readFileSync(full, 'utf-8')
              // Strip comments
              const code = rawCode
                .replace(/\/\*[\s\S]*?\*\//g, '')
                .replace(/\/\/.*$/gm, '')
              // Collect static imports: import { X } from '...'
              for (const m of code.matchAll(/import\s+(?:\{([^}]*)\}|(\w+))?\s*(?:,\s*\{([^}]*)\})?\s*from\s+['"](.*?)['"]/g)) {
                const specifier = m[4]
                if (isStubbedSpecifier(specifier)) {
                  register(specifier, m[1] || m[3] || '')
                }
              }
              // Collect re-exports: export { X, Y } from '...'
              for (const m of code.matchAll(/export\s+\{([^}]*)\}\s*from\s+['"](.*?)['"]/g)) {
                const specifier = m[2]
                if (isStubbedSpecifier(specifier)) {
                  register(specifier, m[1])
                }
              }
              // Collect star re-exports: export * from '...'
              // These re-export all named exports from the source module.
              // For stubbed modules, we need to scan the re-exported module
              // to find its exports and register them under the stubbed specifier.
              for (const m of code.matchAll(/export\s+\*\s+from\s+['"](.*?)['"]/g)) {
                const specifier = m[1]
                if (isStubbedSpecifier(specifier)) {
                  // The re-exported module might itself be stubbed, so we need
                  // to find its exports. Parse the relative path and scan it.
                  const reexportPath = pathMod.resolve(fileDir, specifier)
                  const reexportBase = reexportPath.replace(/\.js$/, '')
                  const candidates = [
                    `${reexportBase}.ts`,
                    `${reexportBase}.tsx`,
                    reexportPath,
                    `${reexportPath}.ts`,
                    `${reexportPath}.tsx`,
                  ]
                  for (const candidate of candidates) {
                    if (fs.existsSync(candidate)) {
                      const reexportCode = fs.readFileSync(candidate, 'utf-8')
                        .replace(/\/\*[\s\S]*?\*\//g, '')
                        .replace(/\/\/.*$/gm, '')
                      // Collect exports from the re-exported module
                      for (const exp of reexportCode.matchAll(/export\s+(?:const|let|var|function|class|type|interface)\s+(\w+)/g)) {
                        register(specifier, exp[1])
                      }
                      for (const exp of reexportCode.matchAll(/export\s+\{([^}]*)\}/g)) {
                        register(specifier, exp[1])
                      }
                      break
                    }
                  }
                }
              }
            }
          }
          walk(srcDir)
        }
        scanSdkStubImports()

        // Special default exports for known modules
        const defaultExportOverrides: Record<string, string> = {
          'stringWidth': '(s) => s?.length || 0',
          'wrapAnsi': '(s) => s',
          'instances': 'new Map()',
          'selectableUserMessagesFilter': '() => true',
          'messagesAfterAreOnlySynthetic': '() => false',
          'SandboxManager': 'class { static isSupportedPlatform = () => false; static create = noop; static Version = \'\'; }',
          'SandboxRuntimeConfigSchema': '{ parse: noop }',
          'SandboxViolationStore': 'null',
          'BaseSandboxManager': 'class { static isSupportedPlatform = () => false; }',
          'ExportResultCode': '{ SUCCESS: 0, FAILED: 1 }',
          'linkifyUrlsInText': '(s) => s',
        }

        build.onLoad({ filter: /.*/, namespace: 'sdk-missing-stub' }, (args) => {
          const names = sdkStubExports.get(args.path) ?? new Set()
          const parts: string[] = []
          for (const n of names) {
            if (n === 'default') continue // handled by `export default noop` below
            const val = defaultExportOverrides[n] ?? 'noop'
            parts.push(`export const ${n} = ${val};`)
          }
          return {
            contents: `
const noop = () => null;
export default noop;
export const __stub = true;
${parts.join('\n')}
`,
            loader: 'js',
          }
        })
      },
    },
  ],
})

result = await cliPromise
sdkResult = await sdkPromise

if (!result.success) {
  console.error('Build failed:')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exitCode = 1
} else {
  // Marker for bin/clpzcode: which renderer this bundle was built with, so the
  // launcher runs it under the right runtime (opentui → bun, ink → node/bun).
  writeFileSync('./dist/renderer', RENDERER + '\n')
  console.log(`✓ Built clpzcode v${version} → dist/cli.mjs  [renderer: ${RENDERER}]`)
}

if (!sdkResult.success) {
  console.error('SDK build failed:')
  for (const log of sdkResult.logs) {
    console.error(log)
  }
  process.exitCode = 1
} else {
  console.log(`✓ Built SDK bundle → dist/sdk.mjs`)
}

} finally {
  console.log(`  🔄 feature-flags: transformed ${featureFlagTransformedFiles.size} files during bundling`)
}

// ── Validate SDK bundle for React/Ink leakage ──────────────────────────────
if (sdkResult?.success) {
  const sdkBundle = readFileSync('./dist/sdk.mjs', 'utf-8')
  // Patterns that indicate React/Ink code leaked into the SDK bundle.
  const reactInkPatterns = [
    /from\s+["']react["']/,               // direct react import
    /from\s+["']ink["']/,                 // direct ink import
    /from\s+["']react\/jsx-dev-runtime["']/, // JSX runtime (must be stubbed, not external)
  ]
  const leaks: string[] = []
  for (const pattern of reactInkPatterns) {
    const match = sdkBundle.match(pattern)
    if (match) leaks.push(match[0])
  }
  if (leaks.length > 0) {
    console.error(`\n❌ SDK bundle contains React/Ink imports (must be stubbed):`)
    for (const leak of leaks) console.error(`   - ${leak}`)
    process.exitCode = 1
  } else {
    console.log(`✓ SDK bundle: no React/Ink leakage detected`)
  }
}

// ── Validate external lists ──────────────────────────────────────────────
if (result?.success && sdkResult?.success) {
  console.log('\nValidating external lists...')
  const validation = Bun.spawnSync(['bun', 'run', 'scripts/validate-externals.ts'], {
    stdout: 'inherit',
    stderr: 'inherit',
  })
  if (validation.exitCode !== 0) {
    process.exitCode = 1
  }
}
