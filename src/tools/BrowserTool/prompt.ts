export const BROWSER_TOOL_NAME = 'Browser'

export const DESCRIPTION = `
- Automates a real Chromium browser session for navigation, interaction, and scraping
- Maintains a persistent session across calls — navigate, click, type, and inspect in sequence
- Returns screenshots so you can visually verify state after each action

Actions:
  - navigate: Go to a URL and wait for it to load
  - click: Click an element matching a CSS selector
  - fill: Type text into an input field
  - select: Select an option in a <select> element
  - screenshot: Capture the current page state (returns image)
  - evaluate: Run JavaScript in the page and return the result
  - wait: Wait for a CSS selector to appear, or for a timeout in milliseconds
  - extract: Extract text content from matching elements
  - close: Close the browser session

Parameters:
  - action: One of the actions listed above
  - url: URL for navigate action
  - selector: CSS selector for click, fill, wait, extract actions
  - text: Text to type for fill action, or option value/label for select
  - script: JavaScript code string for evaluate action
  - wait_for: CSS selector or milliseconds to wait after navigate/click
  - full_page: Capture full page for screenshot (default: false)
  - timeout_ms: Max time to wait for elements (default: 10000)
  - stealth: Use stealth Chromium (CloakBrowser) to bypass Cloudflare, reCAPTCHA v3, FingerprintJS (default: false — downloads ~200MB binary on first use)
  - proxy: HTTP/SOCKS proxy URL for all requests in the session (e.g. http://user:pass@host:port)

Usage notes:
  - The session persists — navigate to a page, then click and fill in subsequent calls
  - Use screenshot after each significant interaction to verify state
  - Use extract to get text data from pages without a screenshot
  - Use evaluate for complex data extraction or custom page manipulation
  - Use close when done to free resources
  - Handles JavaScript-heavy SPAs, authentication flows, and dynamic content
  - Use stealth=true for targets with Cloudflare, reCAPTCHA, or fingerprint-based bot detection
  - When stealth=true, first launch downloads CloakBrowser binary (~200MB) to ~/.cloakbrowser/
`
