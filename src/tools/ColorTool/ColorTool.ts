import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionDecision } from '../../utils/permissions/PermissionResult.js'
import { DESCRIPTION, COLOR_TOOL_NAME } from './prompt.js'
import {
  getToolUseSummary,
  renderToolResultMessage,
  renderToolUseMessage,
  renderToolUseProgressMessage,
} from './UI.js'
import {
  checkContrast,
  exportPaletteAsCss,
  exportPaletteAsJs,
  exportPaletteAsTailwind,
  generatePalette,
  mixColors,
  parseColor,
  rgbToHex,
  rgbToHsl,
  rgbToOklch,
} from './utils.js'

export type ColorOutput =
  | {
      action: 'palette'
      name: string
      base_color: string
      palette: Record<string | number, string>
      export_format: string
      output: string
    }
  | {
      action: 'contrast'
      color1: string
      color2: string
      ratio: number
      aa_normal: boolean
      aa_large: boolean
      aaa_normal: boolean
      aaa_large: boolean
      rating: string
    }
  | {
      action: 'convert'
      input: string
      hex: string
      rgb: string
      hsl: string
      oklch: string
      result: string
    }
  | {
      action: 'mix'
      color1: string
      color2: string
      ratio: number
      result: string
    }
  | {
      action: 'dominant'
      image_path: string
      colors: string[]
    }

const inputSchema = lazySchema(() =>
  z.strictObject({
    action: z
      .enum(['palette', 'contrast', 'convert', 'mix', 'dominant'])
      .describe('Action to perform'),
    color: z
      .string()
      .optional()
      .describe('Base color in any format: hex (#3b82f6), rgb(59 130 246), hsl(217 91% 60%), oklch(0.6 0.2 260), or named CSS color'),
    color2: z
      .string()
      .optional()
      .describe('Second color (required for contrast and mix actions)'),
    name: z
      .string()
      .optional()
      .describe('Color name for palette export (default: "primary")'),
    format: z
      .enum(['hex', 'rgb', 'hsl', 'oklch'])
      .optional()
      .describe('Target format for convert action'),
    ratio: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe('Mix ratio 0–1 (default: 0.5)'),
    export: z
      .enum(['css', 'tailwind', 'js'])
      .optional()
      .describe('Export format for palette (default: css)'),
    image_path: z
      .string()
      .optional()
      .describe('Absolute path to image file for dominant color extraction'),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() => z.unknown())
type OutputSchema = ReturnType<typeof outputSchema>

export const ColorTool = buildTool({
  name: COLOR_TOOL_NAME,
  searchHint:
    'color utilities: generate design system palettes, check WCAG contrast, convert formats',
  maxResultSizeChars: 10_000,
  shouldDefer: false,
  async description(input) {
    const { action, color } = input as { action: string; color?: string }
    return color ? `${action} ${color}` : `Color ${action}`
  },
  userFacingName() {
    return 'Color'
  },
  getToolUseSummary,
  getActivityDescription(input) {
    const s = getToolUseSummary(input)
    return s ? `Color: ${s}` : 'Color operation'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return `${input.action} ${input.color ?? ''}`
  },
  async checkPermissions(input): Promise<PermissionDecision> {
    return {
      behavior: 'allow',
      updatedInput: input,
      decisionReason: { type: 'other', reason: 'Color computation — no side effects' },
    }
  },
  async prompt() {
    return DESCRIPTION
  },
  async validateInput(input) {
    const { action, color, color2, image_path } = input

    if (action === 'dominant' && !image_path) {
      return {
        result: false,
        message: '"image_path" is required for the dominant action',
        meta: { reason: 'missing_image_path' },
        errorCode: 1,
      }
    }
    if (!image_path && !color && action !== 'dominant') {
      return {
        result: false,
        message: '"color" is required for this action',
        meta: { reason: 'missing_color' },
        errorCode: 1,
      }
    }
    if ((action === 'contrast' || action === 'mix') && !color2) {
      return {
        result: false,
        message: '"color2" is required for the contrast and mix actions',
        meta: { reason: 'missing_color2' },
        errorCode: 1,
      }
    }
    if (color) {
      try {
        parseColor(color)
      } catch (e) {
        return {
          result: false,
          message: `Cannot parse color "${color}": ${e instanceof Error ? e.message : String(e)}`,
          meta: { reason: 'invalid_color' },
          errorCode: 1,
        }
      }
    }
    return { result: true }
  },
  renderToolUseMessage,
  renderToolUseProgressMessage,
  renderToolResultMessage,
  async call(input, { abortController }) {
    const { action, color, color2, name = 'primary', format, ratio = 0.5, image_path } = input
    const exportFmt = (input.export ?? 'css') as 'css' | 'tailwind' | 'js'

    switch (action) {
      case 'palette': {
        const palette = generatePalette(color!)
        let output: string
        if (exportFmt === 'tailwind') output = exportPaletteAsTailwind(name, palette)
        else if (exportFmt === 'js') output = exportPaletteAsJs(name, palette)
        else output = exportPaletteAsCss(name, palette)

        return {
          data: {
            action: 'palette' as const,
            name,
            base_color: color!,
            palette,
            export_format: exportFmt,
            output,
          } satisfies ColorOutput,
        }
      }

      case 'contrast': {
        const result = checkContrast(color!, color2!)
        return {
          data: {
            action: 'contrast' as const,
            color1: color!,
            color2: color2!,
            ...result,
          } satisfies ColorOutput,
        }
      }

      case 'convert': {
        const rgb = parseColor(color!)
        const hex = rgbToHex(rgb)
        const hsl = rgbToHsl(rgb)
        const oklch = rgbToOklch(rgb)
        const rgbStr = `rgb(${rgb.r} ${rgb.g} ${rgb.b})`
        const hslStr = `hsl(${Math.round(hsl.h)} ${Math.round(hsl.s * 100)}% ${Math.round(hsl.l * 100)}%)`
        const oklchStr = `oklch(${oklch.l.toFixed(3)} ${oklch.c.toFixed(3)} ${Math.round(oklch.h)})`

        const resultMap = { hex, rgb: rgbStr, hsl: hslStr, oklch: oklchStr }
        const resultVal = format ? resultMap[format] : hex

        return {
          data: {
            action: 'convert' as const,
            input: color!,
            hex,
            rgb: rgbStr,
            hsl: hslStr,
            oklch: oklchStr,
            result: resultVal,
          } satisfies ColorOutput,
        }
      }

      case 'mix': {
        const result = mixColors(color!, color2!, ratio)
        return {
          data: {
            action: 'mix' as const,
            color1: color!,
            color2: color2!,
            ratio,
            result,
          } satisfies ColorOutput,
        }
      }

      case 'dominant': {
        abortController.signal.throwIfAborted()
        const sharp = await import('sharp')
        const { data: rawData, info } = await sharp
          .default(image_path!)
          .resize(100, 100, { fit: 'inside' })
          .raw()
          .toBuffer({ resolveWithObject: true })

        const pixels = new Map<string, number>()
        for (let i = 0; i < rawData.length; i += info.channels) {
          const r = rawData[i]!
          const g = rawData[i + 1]!
          const b = rawData[i + 2]!
          // Quantize to reduce unique colors
          const qr = Math.round(r / 16) * 16
          const qg = Math.round(g / 16) * 16
          const qb = Math.round(b / 16) * 16
          const key = `${qr},${qg},${qb}`
          pixels.set(key, (pixels.get(key) ?? 0) + 1)
        }

        const sorted = Array.from(pixels.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([key]) => {
            const [r, g, b] = key.split(',').map(Number)
            return rgbToHex({ r: r!, g: g!, b: b! })
          })

        return {
          data: {
            action: 'dominant' as const,
            image_path: image_path!,
            colors: sorted,
          } satisfies ColorOutput,
        }
      }
    }
  },
  mapToolResultToToolResultBlockParam(result: ColorOutput, toolUseID) {
    let text: string

    if (result.action === 'palette') {
      text = [
        `Palette "${result.name}" generated from ${result.base_color}`,
        '',
        result.output,
      ].join('\n')
    } else if (result.action === 'contrast') {
      text = [
        `Contrast ratio: ${result.ratio}:1`,
        `WCAG AA (normal text): ${result.aa_normal ? '✓ Pass' : '✗ Fail'} (requires 4.5:1)`,
        `WCAG AA (large text):  ${result.aa_large ? '✓ Pass' : '✗ Fail'} (requires 3:1)`,
        `WCAG AAA (normal):     ${result.aaa_normal ? '✓ Pass' : '✗ Fail'} (requires 7:1)`,
        `Overall: ${result.rating}`,
      ].join('\n')
    } else if (result.action === 'convert') {
      text = [
        `Input: ${result.input}`,
        `hex:   ${result.hex}`,
        `rgb:   ${result.rgb}`,
        `hsl:   ${result.hsl}`,
        `oklch: ${result.oklch}`,
      ].join('\n')
    } else if (result.action === 'mix') {
      text = `Mixed ${result.color1} + ${result.color2} at ${result.ratio}: ${result.result}`
    } else {
      text = `Dominant colors from ${result.image_path}:\n${result.colors.join('\n')}`
    }

    return {
      tool_use_id: toolUseID,
      type: 'tool_result',
      content: text,
    }
  },
} satisfies ToolDef<InputSchema, ColorOutput>)
