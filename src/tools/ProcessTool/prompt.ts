export const PROCESS_TOOL_NAME = 'Process'

export const DESCRIPTION = `
- Manages long-running background processes (dev servers, build watchers, daemons)
- Processes persist across tool calls and can be inspected or stopped later
- Automatically detects available ports when starting servers

Actions:
  - start: Launch a process in the background and return its PID and port
  - stop: Kill a named process and clean up
  - restart: Stop and restart a named process
  - status: List all running managed processes
  - logs: Return recent stdout/stderr from a named process

Parameters:
  - action: One of: start, stop, restart, status, logs
  - name: Unique name for the process (required for start/stop/restart/logs)
  - cmd: Shell command to run (required for start/restart)
  - cwd: Working directory (optional, defaults to current directory)
  - port: Port hint — if provided, waits for the process to listen on it (optional)
  - log_lines: Number of log lines to return for the logs action (default: 50)

Usage notes:
  - Use start to run dev servers (e.g. bun dev, npm run dev, python -m uvicorn)
  - The process runs in background — use logs to check if it started correctly
  - Use status to see all running processes and their ports
  - Always stop processes when done to avoid resource leaks
  - After starting a server, use Screenshot to capture what it looks like
`
