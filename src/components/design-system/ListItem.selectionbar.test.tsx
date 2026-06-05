// Smoke test for the focused selection-bar background added to ListItem.
// renderToString emits PLAIN text (no color escapes), so the background color
// itself is validated visually in a real terminal (per the opencode look
// port). What we CAN guard headlessly: the compiled-component edit did not
// break the render structure — focused/unfocused both render the label, and
// the focused row keeps its pointer indicator.
import { describe, expect, it } from 'bun:test'
import { renderToString } from '../../utils/staticRender.js'
import { ListItem } from './ListItem.js'

describe('ListItem selection bar', () => {
  it('renders the label whether focused or not (no crash from the bg prop)', async () => {
    const focused = await renderToString(<ListItem isFocused>Hello</ListItem>, 40)
    const unfocused = await renderToString(<ListItem isFocused={false}>Hello</ListItem>, 40)
    expect(focused).toContain('Hello')
    expect(unfocused).toContain('Hello')
    // Focused row carries the pointer; unfocused does not.
    expect(focused).not.toBe(unfocused)
    expect(unfocused.trimStart().startsWith('Hello')).toBe(true)
  })
})
