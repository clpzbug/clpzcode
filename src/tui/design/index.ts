// src/tui/design/index.ts
//
// Linguagem visual "Zen minimalista". Ponto de entrada único.
//
//   import { ToolMarker, Row, role, GLYPH } from '../tui/design/index.js'
//
// Regra de ouro: UM accent (roxo), quase nada de bold, espaço pela escala,
// cada glyph mapeia um estado real do sistema.

export {
  GUTTER,
  ROLE,
  role,
  SPACE,
  type ColorRole,
  type SpaceStep,
  type TextWeight,
  type WeightLevel,
  weight,
  WEIGHT,
} from './tokens.js'

export {
  GLYPH,
  type GlyphName,
  STATUS_DOT,
  type StatusKind,
  statusDotRole,
  toolGlyph,
  toolGlyphRole,
  TOOL_ICON,
  toolIcon,
  type ToolState,
} from './glyphs.js'

export { useAccent } from './useAccent.js'

export {
  GhostDivider,
  Gutter,
  Rail,
  Row,
  ToolMarker,
  ZenGlyph,
} from './Row.js'
