export const SCREENSHOT_TOOL_NAME = 'Screenshot'

export const DESCRIPTION = `
- Captures a screenshot of a URL or local HTML file using a real Chromium browser
- Renders the page exactly as a browser would (CSS, fonts, JavaScript)
- Returns the screenshot as an image you can see and analyze
- Also saves the image to disk at the returned path

Parameters:
  - url: A full URL (https://...) or a file:// path to a local HTML file
  - width: Viewport width in pixels (default: 1280)
  - height: Viewport height in pixels (default: 800)
  - full_page: Capture the full scrollable page, not just the viewport (default: false)
  - wait_for: CSS selector to wait for before capturing, or milliseconds to wait (optional)

Usage notes:
  - Use this tool after writing HTML/CSS files to visually verify the result
  - Use this tool to inspect UI design, layout, and visual appearance
  - For local files, pass the absolute path as a file:// URL: file:///path/to/file.html
  - For dev servers (e.g. bun dev on port 3000), use http://localhost:3000
  - The captured image is returned for your inspection — analyze colors, layout, typography
  - Always review screenshots when building or debugging UI
`
