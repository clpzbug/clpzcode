export const SCAFFOLD_TOOL_NAME = 'Scaffold'

export const DESCRIPTION = `
- Creates a complete project structure from a template, ready to run
- Writes all files, installs dependencies, and returns the project path
- Templates are optimized for modern development with the best tooling

Available templates:
  - next-app: Next.js 15 + TypeScript + Tailwind CSS + shadcn/ui — full-stack React app
  - react-vite: React 18 + Vite + TypeScript + Tailwind CSS — fast SPA
  - api-hono: Hono + Bun — lightweight REST API (ultra-fast, TypeScript-first)
  - api-fastapi: FastAPI + uv — Python REST API with automatic OpenAPI docs
  - landing: Pure HTML + Tailwind CSS CDN — static landing page, no build step

Parameters:
  - template: Template to use (see list above)
  - name: Project name (used as directory name and package name)
  - path: Parent directory where the project will be created (optional, defaults to current dir)
  - install: Whether to install dependencies after scaffolding (default: true)

Usage notes:
  - After scaffolding, use Process to start the dev server
  - After starting the dev server, use Screenshot to capture the result
  - The project is created at path/name
  - For next-app and react-vite, the dev server runs on port 3000 by default
  - For api-hono, the server runs on port 3000 by default
  - For api-fastapi, the server runs on port 8000 by default
`
