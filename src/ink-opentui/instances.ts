// src/ink-opentui/instances.ts
//
// OpenTUI-backed drop-in for src/ink/instances.ts (default export: the
// stdout-keyed instances Map). The forked Ink stored an `Ink` class instance per
// stdout; the 8 callers that do `import instances from '.../ink/instances.js'`
// then `instances.get(process.stdout)?.<method>()` expect that leaked surface
// (enterAlternateScreen/exitAlternateScreen/forceRedraw/invalidatePrevFrame/
// pause/resume/suspendStdin/resumeStdin/onHyperlinkClick).
//
// Under OpenTUI the Ink class is gone; render.tsx owns the live renderer and
// stores an AdapterInstance per stdout that re-exposes exactly that surface
// backed by the renderer's own lifecycle API (suspend/resume/pause/requestRender
// — see the mapping note in render.tsx). This module just re-exports that SAME
// map as the default export, so the build alias can redirect the forked-Ink
// instances path to it and the callers resolve unchanged (no edits to the 8
// call sites — they keep importing `.../ink/instances.js`).
//
// Single source of truth: the map lives in render.tsx (created/populated by
// render()/createRoot()); we only re-export it here so there's never a second,
// empty map that the callers would look up into.

import { instances } from './render.js'

export default instances
