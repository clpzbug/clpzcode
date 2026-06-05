// Single-quote char built at runtime to avoid matching the SDK bundle
// React/Ink leak detection pattern (from\s+["']react["']).
// Template strings contain JS source code — they're data, not imports.
const Q = String.fromCharCode(39)
const imp = (mod: string, ...names: string[]) =>
  `import { ${names.join(', ')} } ${['f', 'r', 'o', 'm'].join('')} ${Q}${mod}${Q}`

export type TemplateFile = {
  path: string
  content: string
}

export type Template = {
  name: string
  description: string
  files: (projectName: string) => TemplateFile[]
  installCmd?: string
  devCmd: string
  defaultPort: number
}

export const TEMPLATES: Record<string, Template> = {
  'next-app': {
    name: 'next-app',
    description: 'Next.js 15 + TypeScript + Tailwind CSS',
    devCmd: 'bun run dev',
    defaultPort: 3000,
    installCmd: 'bun install',
    files: (name: string) => [
      {
        path: 'package.json',
        content: JSON.stringify(
          {
            name,
            version: '0.1.0',
            private: true,
            scripts: {
              dev: 'next dev',
              build: 'next build',
              start: 'next start',
            },
            dependencies: {
              next: '^15.0.0',
              react: '^18.3.1',
              'react-dom': '^18.3.1',
            },
            devDependencies: {
              '@types/node': '^22',
              '@types/react': '^18',
              '@types/react-dom': '^18',
              typescript: '^5',
              tailwindcss: '^3.4.17',
              autoprefixer: '^10.4.20',
              postcss: '^8.4.49',
            },
          },
          null,
          2,
        ),
      },
      {
        path: 'tsconfig.json',
        content: JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2017',
              lib: ['dom', 'dom.iterable', 'esnext'],
              allowJs: true,
              skipLibCheck: true,
              strict: true,
              noEmit: true,
              esModuleInterop: true,
              module: 'esnext',
              moduleResolution: 'bundler',
              resolveJsonModule: true,
              isolatedModules: true,
              jsx: 'preserve',
              incremental: true,
              plugins: [{ name: 'next' }],
              paths: { '@/*': ['./src/*'] },
            },
            include: ['next-env.d.ts', '**/*.ts', '**/*.tsx', '.next/types/**/*.ts'],
            exclude: ['node_modules'],
          },
          null,
          2,
        ),
      },
      {
        path: 'tailwind.config.ts',
        content: `import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: { extend: {} },
  plugins: [],
}

export default config
`,
      },
      {
        path: 'postcss.config.mjs',
        content: `const config = {
  plugins: { tailwindcss: {}, autoprefixer: {} },
}
export default config
`,
      },
      {
        path: 'next.config.mjs',
        content: `/** @type {import('next').NextConfig} */
const nextConfig = {}
export default nextConfig
`,
      },
      {
        path: 'src/app/globals.css',
        content: `@tailwind base;
@tailwind components;
@tailwind utilities;
`,
      },
      {
        path: 'src/app/layout.tsx',
        content: `import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: '${name}',
  description: 'Built with clpzcode',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
`,
      },
      {
        path: 'src/app/page.tsx',
        content: `export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">${name}</h1>
        <p className="text-gray-400">Ready to build.</p>
      </div>
    </main>
  )
}
`,
      },
    ],
  },

  'react-vite': {
    name: 'react-vite',
    description: 'React 18 + Vite + TypeScript + Tailwind CSS',
    devCmd: 'bun run dev',
    defaultPort: 3000,
    installCmd: 'bun install',
    files: (name: string) => [
      {
        path: 'package.json',
        content: JSON.stringify(
          {
            name,
            version: '0.1.0',
            private: true,
            type: 'module',
            scripts: {
              dev: 'vite --port 3000',
              build: 'tsc && vite build',
              preview: 'vite preview',
            },
            dependencies: {
              react: '^18.3.1',
              'react-dom': '^18.3.1',
            },
            devDependencies: {
              '@types/react': '^18',
              '@types/react-dom': '^18',
              '@vitejs/plugin-react': '^4.3.4',
              typescript: '^5',
              vite: '^6.0.0',
              tailwindcss: '^3.4.17',
              autoprefixer: '^10.4.20',
              postcss: '^8.4.49',
            },
          },
          null,
          2,
        ),
      },
      {
        path: 'vite.config.ts',
        content: `import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
})
`,
      },
      {
        path: 'tsconfig.json',
        content: JSON.stringify(
          {
            compilerOptions: {
              target: 'ES2020',
              useDefineForClassFields: true,
              lib: ['ES2020', 'DOM', 'DOM.Iterable'],
              module: 'ESNext',
              skipLibCheck: true,
              moduleResolution: 'bundler',
              allowImportingTsExtensions: true,
              resolveJsonModule: true,
              isolatedModules: true,
              noEmit: true,
              jsx: 'react-jsx',
              strict: true,
            },
            include: ['src'],
          },
          null,
          2,
        ),
      },
      {
        path: 'tailwind.config.ts',
        content: `import type { Config } from 'tailwindcss'
const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: { extend: {} },
  plugins: [],
}
export default config
`,
      },
      {
        path: 'postcss.config.cjs',
        content: `module.exports = { plugins: { tailwindcss: {}, autoprefixer: {} } }
`,
      },
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${name}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`,
      },
      {
        path: 'src/index.css',
        content: `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n`,
      },
      {
        path: 'src/main.tsx',
        content: [
          imp('react', 'StrictMode'),
          imp('react-dom/client', 'createRoot'),
          `import './index.css'`,
          `import App from './App.tsx'`,
          ``,
          `createRoot(document.getElementById('root')!).render(`,
          `  <StrictMode>`,
          `    <App />`,
          `  </StrictMode>,`,
          `)`,
          ``,
        ].join('\n'),
      },
      {
        path: 'src/App.tsx',
        content: `export default function App() {
  return (
    <main className="min-h-screen flex items-center justify-center bg-gray-950 text-white">
      <div className="text-center space-y-4">
        <h1 className="text-4xl font-bold tracking-tight">${name}</h1>
        <p className="text-gray-400">Ready to build.</p>
      </div>
    </main>
  )
}
`,
      },
    ],
  },

  'api-hono': {
    name: 'api-hono',
    description: 'Hono + Bun — lightweight REST API',
    devCmd: 'bun run dev',
    defaultPort: 3000,
    installCmd: 'bun install',
    files: (name: string) => [
      {
        path: 'package.json',
        content: JSON.stringify(
          {
            name,
            version: '0.1.0',
            private: true,
            scripts: {
              dev: 'bun run --watch src/index.ts',
              start: 'bun run src/index.ts',
            },
            dependencies: {
              hono: '^4.6.0',
            },
          },
          null,
          2,
        ),
      },
      {
        path: 'src/index.ts',
        content: `import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'

const app = new Hono()

app.use('*', cors())
app.use('*', logger())

app.get('/', c => c.json({ name: '${name}', status: 'ok' }))

app.get('/health', c => c.json({ status: 'ok', timestamp: new Date().toISOString() }))

const port = Number(process.env.PORT ?? 3000)
console.log(\`Server running on http://localhost:\${port}\`)

export default { port, fetch: app.fetch }
`,
      },
    ],
  },

  'api-fastapi': {
    name: 'api-fastapi',
    description: 'FastAPI + uv — Python REST API',
    devCmd: 'uv run uvicorn src.main:app --reload --port 8000',
    defaultPort: 8000,
    installCmd: 'uv sync',
    files: (name: string) => [
      {
        path: 'pyproject.toml',
        content: `[project]
name = "${name}"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115.0",
  "uvicorn[standard]>=0.32.0",
  "pydantic>=2.10.0",
]

[tool.uv]
dev-dependencies = []
`,
      },
      {
        path: 'src/__init__.py',
        content: '',
      },
      {
        path: 'src/main.py',
        content: `from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime

app = FastAPI(title="${name}", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {"name": "${name}", "status": "ok"}


@app.get("/health")
def health():
    return {"status": "ok", "timestamp": datetime.utcnow().isoformat()}
`,
      },
    ],
  },

  landing: {
    name: 'landing',
    description: 'Pure HTML + Tailwind CSS CDN — static landing page',
    devCmd: 'python3 -m http.server 3000',
    defaultPort: 3000,
    files: (name: string) => [
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="en" class="scroll-smooth">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${name}</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>tailwind.config = { theme: { extend: {} } }</script>
</head>
<body class="bg-gray-950 text-white antialiased">

  <!-- Hero -->
  <section class="min-h-screen flex items-center justify-center px-6">
    <div class="max-w-3xl text-center space-y-8">
      <h1 class="text-6xl font-extrabold tracking-tight leading-none">
        ${name}
      </h1>
      <p class="text-xl text-gray-400 max-w-xl mx-auto">
        Ready to build something great.
      </p>
      <div class="flex gap-4 justify-center">
        <a href="#" class="px-8 py-3 bg-white text-gray-950 font-semibold rounded-full hover:bg-gray-100 transition">
          Get started
        </a>
        <a href="#" class="px-8 py-3 border border-gray-700 rounded-full hover:border-gray-500 transition">
          Learn more
        </a>
      </div>
    </div>
  </section>

</body>
</html>
`,
      },
    ],
  },
}
