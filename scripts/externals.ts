/**
 * Shared external dependency lists for CLI and SDK bundles.
 *
 * Used by build.ts and validate-externals.ts.
 * When adding a new dependency to package.json, check if it should be
 * added here (large packages, native modules, or packages with many exports).
 */

// Packages that should be kept external in ALL bundles (CLI + SDK)
export const COMMON_EXTERNALS: string[] = [
  // Native image processing
  'sharp',
  // Browser automation (requires system Chromium or CloakBrowser binary)
  'playwright-core',
  'chromium-bidi',
  'cloakbrowser',
  // Cloud provider SDKs
  '@aws-sdk/client-bedrock',
  '@aws-sdk/client-bedrock-runtime',
  '@aws-sdk/client-sts',
  '@aws-sdk/credential-providers',
  '@azure/identity',
  'google-auth-library',
  // @vscode/ripgrep ships a platform-specific binary alongside its
  // index.js and resolves the path via __dirname at runtime. Bundling
  // would freeze the build host's absolute path into dist/cli.mjs, so we
  // keep it external and rely on the npm package being installed.
  '@vscode/ripgrep',
  // Orama search engine
  '@orama/orama',
  '@orama/plugin-data-persistence',
  // PTY support — ships a native .node binary, must not be bundled
  'node-pty',
  // PTY backend under Bun (JavaScriptCore): ships TS source + bun:ffi, loaded
  // via a runtime-selected dynamic import in ptyExec.ts. Must stay external so
  // the Node bundle never tries to parse bun:ffi.
  'bun-pty',
  // OpenTUI renderer (Bun-only): @opentui/core ships a per-platform native
  // binary (@opentui/core-<os>-<arch>) loaded via bun:ffi, @opentui/react is its
  // React binding. Kept external so the bundle never tries to inline the native
  // core; resolved at runtime from node_modules when the OpenTUI renderer is on.
  '@opentui/core',
  '@opentui/react',
  // Large-and-rarely-used deps: keep external so they don't pay parse/compile
  // in the boot path. All are real package.json deps (resolve from
  // node_modules) and are imported only by specific tools/providers.
  // RAM-DEEPDIVE §2.4 / MEMORY-AND-RUNTIME-PLAN §2 #2.
  'duck-duck-scrape', // WebSearch provider (dynamic import)
  'qrcode', // bridge/session/mobile QR rendering
  'xml2js', // NmapTool XML parsing
  '@mendable/firecrawl-js', // WebSearch/WebFetch provider (dynamic import)
  '@anthropic-ai/bedrock-sdk', // Bedrock provider (dynamic import; drags AWS/smithy)
]

// Additional packages external only in the SDK bundle (TUI + heavy deps)
export const SDK_ONLY_EXTERNALS: string[] = [
  'react',
  'react-reconciler',
  '@anthropic-ai/sdk',
  '@modelcontextprotocol/sdk',
]

// Packages kept external but NOT listed in package.json dependencies.
// These are dynamically imported at runtime — they're optional and resolved
// from transitive deps or installed by users who need that provider/protocol.
export const OPTIONAL_RUNTIME_EXTERNALS: string[] = [
  // Cloud provider SDKs (dynamically imported per-provider)
  '@aws-sdk/client-bedrock',
  '@aws-sdk/client-bedrock-runtime',
  '@aws-sdk/client-sts',
  '@aws-sdk/credential-providers',
  '@azure/identity',
]

// Computed full lists
// Under the OpenTUI renderer (now the DEFAULT), React MUST be external:
// @opentui/react is external and resolves react from node_modules, so if the CLI
// bundle inlined its own react copy there would be two React instances and hooks
// fail with "resolveDispatcher().useState is null". Externalizing react (+ the JSX
// runtimes + react-reconciler) makes the app and @opentui/react share ONE react.
// The legacy Ink build (CLPZCODE_RENDERER=ink) keeps react bundled.
export const CLI_EXTERNALS: string[] =
  process.env.CLPZCODE_RENDERER !== 'ink'
    ? [
        ...COMMON_EXTERNALS,
        'react',
        'react/jsx-runtime',
        'react/jsx-dev-runtime',
        'react-reconciler',
      ]
    : COMMON_EXTERNALS
export const SDK_EXTERNALS: string[] = [...COMMON_EXTERNALS, ...SDK_ONLY_EXTERNALS]

// Packages intentionally bundled (not external, not flagged by validation)
// These are small utilities that are fine to inline into the output bundle.
export const INTENTIONALLY_BUNDLED: string[] = [
  // Anthropic provider variants (bundled, not the main SDK)
  '@anthropic-ai/foundry-sdk',
  '@anthropic-ai/sandbox-runtime',
  '@anthropic-ai/vertex-sdk',
  // CLI / TUI utilities
  '@alcalzone/ansi-tokenize',
  '@commander-js/extra-typings',
  'bidi-js',
  'chalk',
  'cli-boxes',
  'cli-highlight',
  'commander',
  'emoji-regex',
  'env-paths',
  'figures',
  'get-east-asian-width',
  'indent-string',
  'strip-ansi',
  'supports-hyperlinks',
  'wrap-ansi',
  // Data formats
  'jsonc-parser',
  'yaml',
  'marked',
  'turndown',
  'xss',
  // Data utilities
  'ajv',
  'auto-bind',
  'diff',
  'fflate',
  'fuse.js',
  'ignore',
  'lodash-es',
  'lru-cache',
  'p-map',
  'picomatch',
  'proper-lockfile',
  'semver',
  'shell-quote',
  'signal-exit',
  'stack-utils',
  'code-excerpt',
  'type-fest',
  // Networking
  'axios',
  'cross-spawn',
  'execa',
  'https-proxy-agent',
  'tree-kill',
  'undici',
  'ws',
  // React ecosystem (react/react-reconciler are SDK_ONLY_EXTERNALS, bundled in CLI)
  // react-compiler-runtime is shimmed by build.ts, not a real npm dep
  'react',
  'react-reconciler',
  'usehooks-ts',
  // Anthropic SDK (external in SDK bundle, bundled in CLI)
  '@anthropic-ai/sdk',
  // MCP SDK (external in SDK bundle, bundled in CLI)
  '@modelcontextprotocol/sdk',
  // Schema validation
  'zod',
    // gRPC (bundled into CLI, not external)
  '@grpc/grpc-js',
  '@grpc/proto-loader',
  // Language server protocol
  'vscode-languageserver-protocol',
  // File watching
  'chokidar',
]
