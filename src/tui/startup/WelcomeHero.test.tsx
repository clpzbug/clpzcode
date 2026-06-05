// The ORTHOGRAM welcome wordmark was removed for a minimal boot. WelcomeHero is
// now a no-op component, so the empty-state renders no wordmark or frame art.
import { describe, expect, it } from 'bun:test'
import { renderToString } from '../../utils/staticRender.js'
import { WelcomeHero } from './WelcomeHero.js'

describe('WelcomeHero', () => {
  it('renders nothing (wordmark removed for minimal boot)', async () => {
    const out = await renderToString(<WelcomeHero />, 80)
    expect(out).not.toContain('clpzcode')
    expect(out.trim()).toBe('')
  })
})
