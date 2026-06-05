export const COLOR_TOOL_NAME = 'Color'

export const DESCRIPTION = `
- Color utilities for design systems: palette generation, contrast checking, format conversion
- Generates complete shade scales (50–950) from a single base color
- Checks WCAG AA/AAA contrast ratios for accessibility compliance
- Converts between color formats: hex, rgb, hsl, oklch
- Exports as CSS custom properties, Tailwind config, or JS/TS object

Actions:
  - palette: Generate a full shade scale (50–950) from a base color
  - contrast: Check WCAG contrast ratio between two colors
  - convert: Convert a color between hex, rgb, hsl, and oklch formats
  - mix: Mix two colors at a given ratio
  - dominant: Extract the dominant colors from an image file

Parameters:
  - action: One of: palette, contrast, convert, mix, dominant
  - color: Base color in any format (hex, rgb(), hsl(), oklch(), named CSS color)
  - color2: Second color (required for contrast and mix)
  - format: Output format for convert: hex, rgb, hsl, oklch
  - ratio: Mix ratio 0–1 (default: 0.5 for mix)
  - export: Export format for palette: css, tailwind, js (default: css)
  - image_path: Absolute path to image file (required for dominant action)

Usage notes:
  - Use palette to build a complete color system from a brand color
  - Use contrast to ensure text is readable (AA requires ≥4.5:1 for normal text)
  - Use dominant to extract a color palette from a logo or reference image
  - Export as css for direct use in stylesheets, tailwind for Tailwind config
`
