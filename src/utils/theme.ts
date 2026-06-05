import chalk, { Chalk } from 'chalk'
import { env } from './env.js'

export type Theme = {
  autoAccept: string
  bashBorder: string
  claude: string
  claudeShimmer: string // Lighter version of claude color for shimmer effect
  claudeBlue_FOR_SYSTEM_SPINNER: string
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: string
  permission: string
  permissionShimmer: string // Lighter version of permission color for shimmer effect
  planMode: string
  ide: string
  promptBorder: string
  promptBorderShimmer: string // Lighter version of promptBorder color for shimmer effect
  text: string
  inverseText: string
  inactive: string
  inactiveShimmer: string // Lighter version of inactive color for shimmer effect
  subtle: string
  suggestion: string
  remember: string
  background: string
  /** Canvas/terminal background. "transparent" lets the terminal wallpaper show through (dark themes); decoupled from `background` so panels/messages are unaffected. */
  canvasBackground: string
  // Semantic colors
  success: string
  error: string
  warning: string
  merged: string
  warningShimmer: string // Lighter version of warning color for shimmer effect
  // Diff colors
  diffAdded: string
  diffRemoved: string
  diffAddedDimmed: string
  diffRemovedDimmed: string
  // Word-level diff highlighting
  diffAddedWord: string
  diffRemovedWord: string
  // OpenTUI design-port (opencode parity): elevated surfaces + diff chrome
  backgroundPanel: string
  backgroundElement: string
  border: string
  borderActive: string
  selectedListItemText: string
  diffLineNumber: string
  diffHunkHeader: string
  // Agent colors
  red_FOR_SUBAGENTS_ONLY: string
  blue_FOR_SUBAGENTS_ONLY: string
  green_FOR_SUBAGENTS_ONLY: string
  yellow_FOR_SUBAGENTS_ONLY: string
  purple_FOR_SUBAGENTS_ONLY: string
  orange_FOR_SUBAGENTS_ONLY: string
  pink_FOR_SUBAGENTS_ONLY: string
  cyan_FOR_SUBAGENTS_ONLY: string
  // Grove colors
  professionalBlue: string
  // Chrome colors
  chromeYellow: string
  // TUI V2 colors
  clawd_body: string
  clawd_background: string
  userMessageBackground: string
  userMessageBackgroundHover: string
  commandMessageBackground: string
  /** Message-actions selection. Cool shift toward `suggestion` blue; distinct from default AND userMessageBackground. */
  messageActionsBackground: string
  /** Text-selection highlight background (alt-screen mouse selection). Solid
   *  bg that REPLACES the cell's bg while preserving its fg — matches native
   *  terminal selection. Previously SGR-7 inverse (swapped fg/bg per cell),
   *  which fragmented badly over syntax highlighting. */
  selectionBg: string
  bashMessageBackgroundColor: string

  memoryBackgroundColor: string
  rate_limit_fill: string
  rate_limit_empty: string
  fastMode: string
  fastModeShimmer: string
  // Brief/assistant mode label colors
  briefLabelYou: string
  briefLabelClaude: string
  // Rainbow colors for ultrathink keyword highlighting
  rainbow_red: string
  rainbow_orange: string
  rainbow_yellow: string
  rainbow_green: string
  rainbow_blue: string
  rainbow_indigo: string
  rainbow_violet: string
  rainbow_red_shimmer: string
  rainbow_orange_shimmer: string
  rainbow_yellow_shimmer: string
  rainbow_green_shimmer: string
  rainbow_blue_shimmer: string
  rainbow_indigo_shimmer: string
  rainbow_violet_shimmer: string
  // Ambient field — pastéis PRÉ-MISTURADOS com o fundo (cores sólidas, sem alpha).
  // Glints calmos ao redor do bloco de specs do boot. Baixa luminância: sussurram,
  // nunca competem com o texto nem com o accent roxo único.
  ambientLavender: string
  ambientPeriwinkle: string
  ambientMint: string
  ambientRose: string
}

export const THEME_NAMES = [
  'dark',
  'light',
  'light-daltonized',
  'dark-daltonized',
  'light-ansi',
  'dark-ansi',
  'pentest-dark',
  'opencode',
] as const

/** A renderable theme. Always resolvable to a concrete color palette. */
export type ThemeName = (typeof THEME_NAMES)[number]

export const THEME_SETTINGS = ['auto', ...THEME_NAMES] as const

/**
 * A theme preference as stored in user config. `'auto'` follows the system
 * dark/light mode and is resolved to a ThemeName at runtime.
 */
export type ThemeSetting = (typeof THEME_SETTINGS)[number]

/**
 * Light theme using explicit RGB values to avoid inconsistencies
 * from users' custom terminal ANSI color definitions
 */
const lightTheme: Theme = {
  autoAccept: 'rgb(135,0,255)', // Electric violet
  bashBorder: 'rgb(255,0,135)', // Vibrant pink
  claude: 'rgb(215,119,87)', // Claude orange
  claudeShimmer: 'rgb(245,149,117)', // Lighter claude orange for shimmer effect
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(87,105,247)', // Medium blue for system spinner
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(117,135,255)', // Lighter blue for system spinner shimmer
  permission: 'rgb(87,105,247)', // Medium blue
  permissionShimmer: 'rgb(137,155,255)', // Lighter blue for shimmer effect
  planMode: 'rgb(0,102,102)', // Muted teal
  ide: 'rgb(71,130,200)', // Muted blue
  promptBorder: 'rgb(153,153,153)', // Medium gray
  promptBorderShimmer: 'rgb(183,183,183)', // Lighter gray for shimmer effect
  text: 'rgb(0,0,0)', // Black
  inverseText: 'rgb(255,255,255)', // White
  inactive: 'rgb(102,102,102)', // Dark gray
  inactiveShimmer: 'rgb(142,142,142)', // Lighter gray for shimmer effect
  subtle: 'rgb(175,175,175)', // Light gray
  suggestion: 'rgb(87,105,247)', // Medium blue
  remember: 'rgb(0,0,255)', // Blue
  background: 'rgb(0,153,153)', // Cyan
  canvasBackground: 'rgb(0,153,153)',
  success: 'rgb(44,122,57)', // Green
  error: 'rgb(171,43,63)', // Red
  warning: 'rgb(150,108,30)', // Amber
  merged: 'rgb(135,0,255)', // Electric violet (matches autoAccept)
  warningShimmer: 'rgb(200,158,80)', // Lighter amber for shimmer effect
  diffAdded: 'rgb(105,219,124)', // Light green
  diffRemoved: 'rgb(255,168,180)', // Light red
  diffAddedDimmed: 'rgb(199,225,203)', // Very light green
  diffRemovedDimmed: 'rgb(253,210,216)', // Very light red
  diffAddedWord: 'rgb(47,157,68)', // Medium green
  diffRemovedWord: 'rgb(209,69,75)', // Medium red
  // Agent colors
  red_FOR_SUBAGENTS_ONLY: 'rgb(220,38,38)', // Red 600
  blue_FOR_SUBAGENTS_ONLY: 'rgb(37,99,235)', // Blue 600
  green_FOR_SUBAGENTS_ONLY: 'rgb(22,163,74)', // Green 600
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(202,138,4)', // Yellow 600
  purple_FOR_SUBAGENTS_ONLY: 'rgb(147,51,234)', // Purple 600
  orange_FOR_SUBAGENTS_ONLY: 'rgb(234,88,12)', // Orange 600
  pink_FOR_SUBAGENTS_ONLY: 'rgb(219,39,119)', // Pink 600
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(8,145,178)', // Cyan 600
  // Grove colors
  professionalBlue: 'rgb(106,155,204)',
  // Chrome colors
  chromeYellow: 'rgb(251,188,4)', // Chrome yellow
  // TUI V2 colors
  clawd_body: 'transparent',
  clawd_background: 'transparent',
  userMessageBackground: 'rgb(240, 240, 240)', // Slightly darker grey for optimal contrast
  userMessageBackgroundHover: 'rgb(252, 252, 252)', // ≥250 to quantize distinct from base at 256-color level
  commandMessageBackground: 'transparent',
  messageActionsBackground: 'rgb(232, 236, 244)', // cool gray — darker than userMsg 240 (visible on white), slight blue toward `suggestion`
  selectionBg: 'rgb(180, 213, 255)', // classic light-mode selection blue (macOS/VS Code-ish); dark fgs stay readable
  bashMessageBackgroundColor: 'transparent',

  memoryBackgroundColor: 'transparent',
  rate_limit_fill: 'rgb(87,105,247)', // Medium blue
  rate_limit_empty: 'rgb(39,47,111)', // Dark blue
  fastMode: 'rgb(255,106,0)', // Electric orange
  fastModeShimmer: 'rgb(255,150,50)', // Lighter orange for shimmer
  // Brief/assistant mode
  briefLabelYou: 'rgb(37,99,235)', // Blue
  briefLabelClaude: 'rgb(215,119,87)', // Brand orange
  rainbow_red: 'rgb(235,95,87)',
  rainbow_orange: 'rgb(245,139,87)',
  rainbow_yellow: 'rgb(250,195,95)',
  rainbow_green: 'rgb(145,200,130)',
  rainbow_blue: 'rgb(130,170,220)',
  rainbow_indigo: 'rgb(155,130,200)',
  rainbow_violet: 'rgb(200,130,180)',
  rainbow_red_shimmer: 'rgb(250,155,147)',
  rainbow_orange_shimmer: 'rgb(255,185,137)',
  rainbow_yellow_shimmer: 'rgb(255,225,155)',
  rainbow_green_shimmer: 'rgb(185,230,180)',
  rainbow_blue_shimmer: 'rgb(180,205,240)',
  rainbow_indigo_shimmer: 'rgb(195,180,230)',
  rainbow_violet_shimmer: 'rgb(230,180,210)',
  // Ambient pastéis pré-misturados com fundo CLARO (mistura em direção ao branco).
  ambientLavender: 'rgb(224,214,236)',
  ambientPeriwinkle: 'rgb(214,219,240)',
  ambientMint: 'rgb(210,234,224)',
  ambientRose: 'rgb(238,218,228)',
  backgroundPanel: 'rgb(245,245,247)',
  backgroundElement: 'rgb(232,232,236)',
  border: 'rgb(200,200,206)',
  borderActive: 'rgb(135,0,255)',
  selectedListItemText: 'rgb(255,255,255)',
  diffLineNumber: 'rgb(150,150,160)',
  diffHunkHeader: 'rgb(120,120,135)',
}

/**
 * Light ANSI theme using only the 16 standard ANSI colors
 * for terminals without true color support
 */
const lightAnsiTheme: Theme = {
  autoAccept: 'ansi:magenta',
  bashBorder: 'ansi:magenta',
  claude: 'ansi:redBright',
  claudeShimmer: 'ansi:yellowBright',
  claudeBlue_FOR_SYSTEM_SPINNER: 'ansi:blue',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'ansi:blueBright',
  permission: 'ansi:blue',
  permissionShimmer: 'ansi:blueBright',
  planMode: 'ansi:cyan',
  ide: 'ansi:blueBright',
  promptBorder: 'ansi:white',
  promptBorderShimmer: 'ansi:whiteBright',
  text: 'ansi:black',
  inverseText: 'ansi:white',
  inactive: 'ansi:blackBright',
  inactiveShimmer: 'ansi:white',
  subtle: 'ansi:blackBright',
  suggestion: 'ansi:blue',
  remember: 'ansi:blue',
  background: 'ansi:cyan',
  canvasBackground: 'ansi:cyan',
  success: 'ansi:green',
  error: 'ansi:red',
  warning: 'ansi:yellow',
  merged: 'ansi:magenta',
  warningShimmer: 'ansi:yellowBright',
  diffAdded: 'ansi:green',
  diffRemoved: 'ansi:red',
  diffAddedDimmed: 'ansi:green',
  diffRemovedDimmed: 'ansi:red',
  diffAddedWord: 'ansi:greenBright',
  diffRemovedWord: 'ansi:redBright',
  // Agent colors
  red_FOR_SUBAGENTS_ONLY: 'ansi:red',
  blue_FOR_SUBAGENTS_ONLY: 'ansi:blue',
  green_FOR_SUBAGENTS_ONLY: 'ansi:green',
  yellow_FOR_SUBAGENTS_ONLY: 'ansi:yellow',
  purple_FOR_SUBAGENTS_ONLY: 'ansi:magenta',
  orange_FOR_SUBAGENTS_ONLY: 'ansi:redBright',
  pink_FOR_SUBAGENTS_ONLY: 'ansi:magentaBright',
  cyan_FOR_SUBAGENTS_ONLY: 'ansi:cyan',
  // Grove colors
  professionalBlue: 'ansi:blueBright',
  // Chrome colors
  chromeYellow: 'ansi:yellow', // Chrome yellow
  // TUI V2 colors
  clawd_body: 'transparent',
  clawd_background: 'transparent',
  userMessageBackground: 'ansi:white',
  userMessageBackgroundHover: 'ansi:whiteBright',
  commandMessageBackground: 'transparent',
  messageActionsBackground: 'ansi:white',
  selectionBg: 'ansi:cyan', // lighter named bg for light-ansi; dark fgs stay readable
  bashMessageBackgroundColor: 'transparent',

  memoryBackgroundColor: 'transparent',
  rate_limit_fill: 'ansi:yellow',
  rate_limit_empty: 'ansi:black',
  fastMode: 'ansi:red',
  fastModeShimmer: 'ansi:redBright',
  briefLabelYou: 'ansi:blue',
  briefLabelClaude: 'ansi:redBright',
  rainbow_red: 'ansi:red',
  rainbow_orange: 'ansi:redBright',
  rainbow_yellow: 'ansi:yellow',
  rainbow_green: 'ansi:green',
  rainbow_blue: 'ansi:cyan',
  rainbow_indigo: 'ansi:blue',
  rainbow_violet: 'ansi:magenta',
  rainbow_red_shimmer: 'ansi:redBright',
  rainbow_orange_shimmer: 'ansi:yellow',
  rainbow_yellow_shimmer: 'ansi:yellowBright',
  rainbow_green_shimmer: 'ansi:greenBright',
  rainbow_blue_shimmer: 'ansi:cyanBright',
  rainbow_indigo_shimmer: 'ansi:blueBright',
  rainbow_violet_shimmer: 'ansi:magentaBright',
  // Ambient — sem truecolor: cinza claro discreto (campo quase invisível em ANSI).
  ambientLavender: 'ansi:white',
  ambientPeriwinkle: 'ansi:white',
  ambientMint: 'ansi:white',
  ambientRose: 'ansi:white',
  backgroundPanel: 'ansi:white',
  backgroundElement: 'ansi:white',
  border: 'ansi:blackBright',
  borderActive: 'ansi:magenta',
  selectedListItemText: 'ansi:white',
  diffLineNumber: 'ansi:blackBright',
  diffHunkHeader: 'ansi:blackBright',
}

/**
 * Dark ANSI theme using only the 16 standard ANSI colors
 * for terminals without true color support
 */
const darkAnsiTheme: Theme = {
  autoAccept: 'ansi:magentaBright',
  bashBorder: 'ansi:magentaBright',
  claude: 'ansi:redBright',
  claudeShimmer: 'ansi:yellowBright',
  claudeBlue_FOR_SYSTEM_SPINNER: 'ansi:blueBright',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'ansi:blueBright',
  permission: 'ansi:blueBright',
  permissionShimmer: 'ansi:blueBright',
  planMode: 'ansi:cyanBright',
  ide: 'ansi:blue',
  promptBorder: 'ansi:white',
  promptBorderShimmer: 'ansi:whiteBright',
  text: 'ansi:whiteBright',
  inverseText: 'ansi:black',
  inactive: 'ansi:white',
  inactiveShimmer: 'ansi:whiteBright',
  subtle: 'ansi:white',
  suggestion: 'ansi:blueBright',
  remember: 'ansi:blueBright',
  background: 'ansi:cyanBright',
  canvasBackground: 'transparent',
  success: 'ansi:greenBright',
  error: 'ansi:redBright',
  warning: 'ansi:yellowBright',
  merged: 'ansi:magentaBright',
  warningShimmer: 'ansi:yellowBright',
  diffAdded: 'ansi:green',
  diffRemoved: 'ansi:red',
  diffAddedDimmed: 'ansi:green',
  diffRemovedDimmed: 'ansi:red',
  diffAddedWord: 'ansi:greenBright',
  diffRemovedWord: 'ansi:redBright',
  // Agent colors
  red_FOR_SUBAGENTS_ONLY: 'ansi:redBright',
  blue_FOR_SUBAGENTS_ONLY: 'ansi:blueBright',
  green_FOR_SUBAGENTS_ONLY: 'ansi:greenBright',
  yellow_FOR_SUBAGENTS_ONLY: 'ansi:yellowBright',
  purple_FOR_SUBAGENTS_ONLY: 'ansi:magentaBright',
  orange_FOR_SUBAGENTS_ONLY: 'ansi:redBright',
  pink_FOR_SUBAGENTS_ONLY: 'ansi:magentaBright',
  cyan_FOR_SUBAGENTS_ONLY: 'ansi:cyanBright',
  // Grove colors
  professionalBlue: 'rgb(106,155,204)',
  // Chrome colors
  chromeYellow: 'ansi:yellowBright', // Chrome yellow
  // TUI V2 colors
  clawd_body: 'transparent',
  clawd_background: 'transparent',
  userMessageBackground: 'ansi:blackBright',
  userMessageBackgroundHover: 'ansi:white',
  commandMessageBackground: 'transparent',
  messageActionsBackground: 'ansi:blackBright',
  selectionBg: 'ansi:blue', // darker named bg for dark-ansi; bright fgs stay readable
  bashMessageBackgroundColor: 'transparent',

  memoryBackgroundColor: 'transparent',
  rate_limit_fill: 'ansi:yellow',
  rate_limit_empty: 'ansi:white',
  fastMode: 'ansi:redBright',
  fastModeShimmer: 'ansi:redBright',
  briefLabelYou: 'ansi:blueBright',
  briefLabelClaude: 'ansi:redBright',
  rainbow_red: 'ansi:red',
  rainbow_orange: 'ansi:redBright',
  rainbow_yellow: 'ansi:yellow',
  rainbow_green: 'ansi:green',
  rainbow_blue: 'ansi:cyan',
  rainbow_indigo: 'ansi:blue',
  rainbow_violet: 'ansi:magenta',
  rainbow_red_shimmer: 'ansi:redBright',
  rainbow_orange_shimmer: 'ansi:yellow',
  rainbow_yellow_shimmer: 'ansi:yellowBright',
  rainbow_green_shimmer: 'ansi:greenBright',
  rainbow_blue_shimmer: 'ansi:cyanBright',
  rainbow_indigo_shimmer: 'ansi:blueBright',
  rainbow_violet_shimmer: 'ansi:magentaBright',
  // Ambient — sem truecolor: cinza-escuro discreto.
  ambientLavender: 'ansi:blackBright',
  ambientPeriwinkle: 'ansi:blackBright',
  ambientMint: 'ansi:blackBright',
  ambientRose: 'ansi:blackBright',
  backgroundPanel: 'ansi:black',
  backgroundElement: 'ansi:blackBright',
  border: 'ansi:white',
  borderActive: 'ansi:magentaBright',
  selectedListItemText: 'ansi:black',
  diffLineNumber: 'ansi:white',
  diffHunkHeader: 'ansi:white',
}

/**
 * Light daltonized theme (color-blind friendly) using explicit RGB values
 * to avoid inconsistencies from users' custom terminal ANSI color definitions
 */
const lightDaltonizedTheme: Theme = {
  autoAccept: 'rgb(135,0,255)', // Electric violet
  bashBorder: 'rgb(0,102,204)', // Blue instead of pink
  claude: 'rgb(255,153,51)', // Orange adjusted for deuteranopia
  claudeShimmer: 'rgb(255,183,101)', // Lighter orange for shimmer effect
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(51,102,255)', // Bright blue for system spinner
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(101,152,255)', // Lighter bright blue for system spinner shimmer
  permission: 'rgb(51,102,255)', // Bright blue
  permissionShimmer: 'rgb(101,152,255)', // Lighter bright blue for shimmer
  planMode: 'rgb(51,102,102)', // Muted blue-gray (works for color-blind)
  ide: 'rgb(71,130,200)', // Muted blue
  promptBorder: 'rgb(153,153,153)', // Medium gray
  promptBorderShimmer: 'rgb(183,183,183)', // Lighter gray for shimmer
  text: 'rgb(0,0,0)', // Black
  inverseText: 'rgb(255,255,255)', // White
  inactive: 'rgb(102,102,102)', // Dark gray
  inactiveShimmer: 'rgb(142,142,142)', // Lighter gray for shimmer effect
  subtle: 'rgb(175,175,175)', // Light gray
  suggestion: 'rgb(51,102,255)', // Bright blue
  remember: 'rgb(51,102,255)', // Bright blue
  background: 'rgb(0,153,153)', // Cyan (color-blind friendly)
  canvasBackground: 'rgb(0,153,153)',
  success: 'rgb(0,102,153)', // Blue instead of green for deuteranopia
  error: 'rgb(204,0,0)', // Pure red for better distinction
  warning: 'rgb(255,153,0)', // Orange adjusted for deuteranopia
  merged: 'rgb(135,0,255)', // Electric violet (matches autoAccept)
  warningShimmer: 'rgb(255,183,50)', // Lighter orange for shimmer
  diffAdded: 'rgb(153,204,255)', // Light blue instead of green
  diffRemoved: 'rgb(255,204,204)', // Light red
  diffAddedDimmed: 'rgb(209,231,253)', // Very light blue
  diffRemovedDimmed: 'rgb(255,233,233)', // Very light red
  diffAddedWord: 'rgb(51,102,204)', // Medium blue (less intense than deep blue)
  diffRemovedWord: 'rgb(153,51,51)', // Softer red (less intense than deep red)
  // Agent colors (daltonism-friendly)
  red_FOR_SUBAGENTS_ONLY: 'rgb(204,0,0)', // Pure red
  blue_FOR_SUBAGENTS_ONLY: 'rgb(0,102,204)', // Pure blue
  green_FOR_SUBAGENTS_ONLY: 'rgb(0,204,0)', // Pure green
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(255,204,0)', // Golden yellow
  purple_FOR_SUBAGENTS_ONLY: 'rgb(128,0,128)', // True purple
  orange_FOR_SUBAGENTS_ONLY: 'rgb(255,128,0)', // True orange
  pink_FOR_SUBAGENTS_ONLY: 'rgb(255,102,178)', // Adjusted pink
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(0,178,178)', // Adjusted cyan
  // Grove colors
  professionalBlue: 'rgb(106,155,204)',
  // Chrome colors
  chromeYellow: 'rgb(251,188,4)', // Chrome yellow
  // TUI V2 colors
  clawd_body: 'transparent',
  clawd_background: 'transparent',
  userMessageBackground: 'rgb(220, 220, 220)', // Slightly darker grey for optimal contrast
  userMessageBackgroundHover: 'rgb(232, 232, 232)', // ≥230 to quantize distinct from base at 256-color level
  commandMessageBackground: 'transparent',
  messageActionsBackground: 'rgb(210, 216, 226)', // cool gray — darker than userMsg 220, slight blue
  selectionBg: 'rgb(180, 213, 255)', // light selection blue; daltonized fgs are yellows/blues, both readable on light blue
  bashMessageBackgroundColor: 'transparent',

  memoryBackgroundColor: 'transparent',
  rate_limit_fill: 'rgb(51,102,255)', // Bright blue
  rate_limit_empty: 'rgb(23,46,114)', // Dark blue
  fastMode: 'rgb(255,106,0)', // Electric orange (color-blind safe)
  fastModeShimmer: 'rgb(255,150,50)', // Lighter orange for shimmer
  briefLabelYou: 'rgb(37,99,235)', // Blue
  briefLabelClaude: 'rgb(255,153,51)', // Orange adjusted for deuteranopia (matches claude)
  rainbow_red: 'rgb(235,95,87)',
  rainbow_orange: 'rgb(245,139,87)',
  rainbow_yellow: 'rgb(250,195,95)',
  rainbow_green: 'rgb(145,200,130)',
  rainbow_blue: 'rgb(130,170,220)',
  rainbow_indigo: 'rgb(155,130,200)',
  rainbow_violet: 'rgb(200,130,180)',
  rainbow_red_shimmer: 'rgb(250,155,147)',
  rainbow_orange_shimmer: 'rgb(255,185,137)',
  rainbow_yellow_shimmer: 'rgb(255,225,155)',
  rainbow_green_shimmer: 'rgb(185,230,180)',
  rainbow_blue_shimmer: 'rgb(180,205,240)',
  rainbow_indigo_shimmer: 'rgb(195,180,230)',
  rainbow_violet_shimmer: 'rgb(230,180,210)',
  // Ambient — daltonizado: só azul/lavanda neutros, evita verde/rosa ambíguos.
  ambientLavender: 'rgb(222,214,238)',
  ambientPeriwinkle: 'rgb(212,219,242)',
  ambientMint: 'rgb(218,226,238)',
  ambientRose: 'rgb(224,219,238)',
  backgroundPanel: 'rgb(245,245,247)',
  backgroundElement: 'rgb(232,232,236)',
  border: 'rgb(200,200,206)',
  borderActive: 'rgb(135,0,255)',
  selectedListItemText: 'rgb(255,255,255)',
  diffLineNumber: 'rgb(150,150,160)',
  diffHunkHeader: 'rgb(120,120,135)',
}

/**
 * Dark theme using explicit RGB values to avoid inconsistencies
 * from users' custom terminal ANSI color definitions
 */
const darkTheme: Theme = {
  autoAccept: 'rgb(178,145,220)', // clpzcode purple
  bashBorder: 'rgb(178,145,220)', // clpzcode purple
  claude: 'rgb(178,145,220)', // clpzcode purple
  claudeShimmer: 'rgb(200,175,235)', // clpzcode purple shimmer
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(178,145,220)', // clpzcode purple
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(200,175,235)', // clpzcode purple shimmer
  permission: 'rgb(178,145,220)', // clpzcode purple
  permissionShimmer: 'rgb(200,175,235)', // clpzcode purple shimmer
  planMode: 'rgb(178,145,220)', // clpzcode purple
  ide: 'rgb(71,130,200)', // Muted blue
  promptBorder: 'rgb(136,136,136)', // Medium gray
  promptBorderShimmer: 'rgb(166,166,166)', // Lighter gray for shimmer
  text: 'rgb(255,255,255)', // White
  inverseText: 'rgb(0,0,0)', // Black
  inactive: 'rgb(153,153,153)', // Light gray
  inactiveShimmer: 'rgb(193,193,193)', // Lighter gray for shimmer effect
  subtle: 'rgb(80,80,80)', // Dark gray
  suggestion: 'rgb(177,185,249)', // Light blue-purple
  remember: 'rgb(177,185,249)', // Light blue-purple
  background: 'rgb(0,204,204)', // Bright cyan
  canvasBackground: 'transparent',
  success: 'rgb(78,186,101)', // Bright green
  error: 'rgb(255,107,128)', // Bright red
  warning: 'rgb(255,193,7)', // Bright amber
  merged: 'rgb(175,135,255)', // Electric violet (matches autoAccept)
  warningShimmer: 'rgb(255,223,57)', // Lighter amber for shimmer
  diffAdded: 'rgb(34,92,43)', // Dark green
  diffRemoved: 'rgb(122,41,54)', // Dark red
  diffAddedDimmed: 'rgb(71,88,74)', // Very dark green
  diffRemovedDimmed: 'rgb(105,72,77)', // Very dark red
  diffAddedWord: 'rgb(56,166,96)', // Medium green
  diffRemovedWord: 'rgb(179,89,107)', // Softer red (less intense than bright red)
  // Agent colors
  red_FOR_SUBAGENTS_ONLY: 'rgb(220,38,38)', // Red 600
  blue_FOR_SUBAGENTS_ONLY: 'rgb(37,99,235)', // Blue 600
  green_FOR_SUBAGENTS_ONLY: 'rgb(22,163,74)', // Green 600
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(202,138,4)', // Yellow 600
  purple_FOR_SUBAGENTS_ONLY: 'rgb(147,51,234)', // Purple 600
  orange_FOR_SUBAGENTS_ONLY: 'rgb(234,88,12)', // Orange 600
  pink_FOR_SUBAGENTS_ONLY: 'rgb(219,39,119)', // Pink 600
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(8,145,178)', // Cyan 600
  // Grove colors
  professionalBlue: 'rgb(106,155,204)',
  // Chrome colors
  chromeYellow: 'rgb(251,188,4)', // Chrome yellow
  // TUI V2 colors
  clawd_body: 'transparent',
  clawd_background: 'transparent',
  userMessageBackground: 'rgb(55, 55, 55)', // Lighter grey for better visual contrast
  userMessageBackgroundHover: 'rgb(70, 70, 70)',
  commandMessageBackground: 'transparent',
  messageActionsBackground: 'rgb(44, 50, 62)', // cool gray, slight blue
  selectionBg: 'rgb(38, 79, 120)', // classic dark-mode selection blue (VS Code dark default); light fgs stay readable
  bashMessageBackgroundColor: 'transparent',

  memoryBackgroundColor: 'transparent',
  rate_limit_fill: 'rgb(177,185,249)', // Light blue-purple
  rate_limit_empty: 'rgb(80,83,112)', // Medium blue-purple
  fastMode: 'rgb(255,120,20)', // Electric orange for dark bg
  fastModeShimmer: 'rgb(255,165,70)', // Lighter orange for shimmer
  briefLabelYou: 'rgb(122,180,232)', // Light blue
  briefLabelClaude: 'rgb(215,119,87)', // Brand orange
  rainbow_red: 'rgb(235,95,87)',
  rainbow_orange: 'rgb(245,139,87)',
  rainbow_yellow: 'rgb(250,195,95)',
  rainbow_green: 'rgb(145,200,130)',
  rainbow_blue: 'rgb(130,170,220)',
  rainbow_indigo: 'rgb(155,130,200)',
  rainbow_violet: 'rgb(200,130,180)',
  rainbow_red_shimmer: 'rgb(250,155,147)',
  rainbow_orange_shimmer: 'rgb(255,185,137)',
  rainbow_yellow_shimmer: 'rgb(255,225,155)',
  rainbow_green_shimmer: 'rgb(185,230,180)',
  rainbow_blue_shimmer: 'rgb(180,205,240)',
  rainbow_indigo_shimmer: 'rgb(195,180,230)',
  rainbow_violet_shimmer: 'rgb(230,180,210)',
  // Ambient pastéis pré-misturados com o fundo PRETO (cores sólidas, ~20% de luz).
  // Sussurros tingidos em volta do accent roxo rgb(178,145,220); abaixo do `subtle`
  // (rgb(80,80,80)) em peso óptico — vivem, mas nunca disputam com o texto.
  ambientLavender: 'rgb(46,38,55)', // mais próximo do accent (lavanda-roxo)
  ambientPeriwinkle: 'rgb(37,40,54)', // azul-violeta frio
  ambientMint: 'rgb(31,45,39)', // menta fria, contraponto suave
  ambientRose: 'rgb(48,35,42)', // rosa quente, glint ocasional
  backgroundPanel: 'rgb(24,24,28)',
  backgroundElement: 'rgb(36,36,42)',
  border: 'rgb(64,64,72)',
  borderActive: 'rgb(178,145,220)',
  selectedListItemText: 'rgb(0,0,0)',
  diffLineNumber: 'rgb(110,110,122)',
  diffHunkHeader: 'rgb(130,130,145)',
}

/**
 * Dark daltonized theme (color-blind friendly) using explicit RGB values
 * to avoid inconsistencies from users' custom terminal ANSI color definitions
 */
const darkDaltonizedTheme: Theme = {
  autoAccept: 'rgb(175,135,255)', // Electric violet
  bashBorder: 'rgb(51,153,255)', // Bright blue
  claude: 'rgb(255,153,51)', // Orange adjusted for deuteranopia
  claudeShimmer: 'rgb(255,183,101)', // Lighter orange for shimmer effect
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(153,204,255)', // Light blue for system spinner
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(183,224,255)', // Lighter blue for system spinner shimmer
  permission: 'rgb(153,204,255)', // Light blue
  permissionShimmer: 'rgb(183,224,255)', // Lighter blue for shimmer
  planMode: 'rgb(102,153,153)', // Muted gray-teal (works for color-blind)
  ide: 'rgb(71,130,200)', // Muted blue
  promptBorder: 'rgb(136,136,136)', // Medium gray
  promptBorderShimmer: 'rgb(166,166,166)', // Lighter gray for shimmer
  text: 'rgb(255,255,255)', // White
  inverseText: 'rgb(0,0,0)', // Black
  inactive: 'rgb(153,153,153)', // Light gray
  inactiveShimmer: 'rgb(193,193,193)', // Lighter gray for shimmer effect
  subtle: 'rgb(80,80,80)', // Dark gray
  suggestion: 'rgb(153,204,255)', // Light blue
  remember: 'rgb(153,204,255)', // Light blue
  background: 'rgb(0,204,204)', // Bright cyan (color-blind friendly)
  canvasBackground: 'transparent',
  success: 'rgb(51,153,255)', // Blue instead of green
  error: 'rgb(255,102,102)', // Bright red
  warning: 'rgb(255,204,0)', // Yellow-orange for deuteranopia
  merged: 'rgb(175,135,255)', // Electric violet (matches autoAccept)
  warningShimmer: 'rgb(255,234,50)', // Lighter yellow-orange for shimmer
  diffAdded: 'rgb(0,68,102)', // Dark blue
  diffRemoved: 'rgb(102,0,0)', // Dark red
  diffAddedDimmed: 'rgb(62,81,91)', // Dimmed blue
  diffRemovedDimmed: 'rgb(62,44,44)', // Dimmed red
  diffAddedWord: 'rgb(0,119,179)', // Medium blue
  diffRemovedWord: 'rgb(179,0,0)', // Medium red
  // Agent colors (daltonism-friendly, dark mode)
  red_FOR_SUBAGENTS_ONLY: 'rgb(255,102,102)', // Bright red
  blue_FOR_SUBAGENTS_ONLY: 'rgb(102,178,255)', // Bright blue
  green_FOR_SUBAGENTS_ONLY: 'rgb(102,255,102)', // Bright green
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(255,255,102)', // Bright yellow
  purple_FOR_SUBAGENTS_ONLY: 'rgb(178,102,255)', // Bright purple
  orange_FOR_SUBAGENTS_ONLY: 'rgb(255,178,102)', // Bright orange
  pink_FOR_SUBAGENTS_ONLY: 'rgb(255,153,204)', // Bright pink
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(102,204,204)', // Bright cyan
  // Grove colors
  professionalBlue: 'rgb(106,155,204)',
  // Chrome colors
  chromeYellow: 'rgb(251,188,4)', // Chrome yellow
  // TUI V2 colors
  clawd_body: 'transparent',
  clawd_background: 'transparent',
  userMessageBackground: 'rgb(55, 55, 55)', // Lighter grey for better visual contrast
  userMessageBackgroundHover: 'rgb(70, 70, 70)',
  commandMessageBackground: 'transparent',
  messageActionsBackground: 'rgb(44, 50, 62)', // cool gray, slight blue
  selectionBg: 'rgb(38, 79, 120)', // classic dark-mode selection blue (VS Code dark default); light fgs stay readable
  bashMessageBackgroundColor: 'transparent',

  memoryBackgroundColor: 'transparent',
  rate_limit_fill: 'rgb(153,204,255)', // Light blue
  rate_limit_empty: 'rgb(69,92,115)', // Dark blue
  fastMode: 'rgb(255,120,20)', // Electric orange for dark bg (color-blind safe)
  fastModeShimmer: 'rgb(255,165,70)', // Lighter orange for shimmer
  briefLabelYou: 'rgb(122,180,232)', // Light blue
  briefLabelClaude: 'rgb(255,153,51)', // Orange adjusted for deuteranopia (matches claude)
  rainbow_red: 'rgb(235,95,87)',
  rainbow_orange: 'rgb(245,139,87)',
  rainbow_yellow: 'rgb(250,195,95)',
  rainbow_green: 'rgb(145,200,130)',
  rainbow_blue: 'rgb(130,170,220)',
  rainbow_indigo: 'rgb(155,130,200)',
  rainbow_violet: 'rgb(200,130,180)',
  rainbow_red_shimmer: 'rgb(250,155,147)',
  rainbow_orange_shimmer: 'rgb(255,185,137)',
  rainbow_yellow_shimmer: 'rgb(255,225,155)',
  rainbow_green_shimmer: 'rgb(185,230,180)',
  rainbow_blue_shimmer: 'rgb(180,205,240)',
  rainbow_indigo_shimmer: 'rgb(195,180,230)',
  rainbow_violet_shimmer: 'rgb(230,180,210)',
  // Ambient — daltonizado escuro: azul/lavanda neutros pré-misturados com preto.
  ambientLavender: 'rgb(44,38,56)',
  ambientPeriwinkle: 'rgb(36,41,56)',
  ambientMint: 'rgb(36,44,52)',
  ambientRose: 'rgb(44,40,54)',
  backgroundPanel: 'rgb(24,24,28)',
  backgroundElement: 'rgb(36,36,42)',
  border: 'rgb(64,64,72)',
  borderActive: 'rgb(175,135,255)',
  selectedListItemText: 'rgb(0,0,0)',
  diffLineNumber: 'rgb(110,110,122)',
  diffHunkHeader: 'rgb(130,130,145)',
}

/**
 * Pentest-dark theme — professional terminal look for security assessments.
 * Palette: deep black bg, green-tinted text, neon-green accents, red errors.
 * Inspired by classic green-phosphor CRTs but calibrated for readability at
 * 24-bit color. Every semantic color is distinct and high-contrast.
 */
const pentestDarkTheme: Theme = {
  autoAccept: 'rgb(57,255,91)',    // neon green — high-visibility confirm
  bashBorder: 'rgb(255,80,80)',    // alert red — bash is dangerous, flag it
  claude: 'rgb(57,255,91)',        // neon green — primary accent
  claudeShimmer: 'rgb(100,255,130)', // lighter green shimmer
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(57,255,91)', // green spinner
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(100,255,130)',
  permission: 'rgb(255,200,0)',    // amber — request attention before acting
  permissionShimmer: 'rgb(255,225,80)',
  planMode: 'rgb(0,200,200)',      // cyan — strategic/planning mode
  ide: 'rgb(80,160,220)',          // steel blue — IDE integration
  promptBorder: 'rgb(50,110,50)',  // dark green border
  promptBorderShimmer: 'rgb(70,150,70)',
  text: 'rgb(178,235,178)',        // soft green-white — readable on black
  inverseText: 'rgb(0,0,0)',
  inactive: 'rgb(90,130,90)',      // muted green-gray
  inactiveShimmer: 'rgb(120,165,120)',
  subtle: 'rgb(35,55,35)',         // very dark green for bg accents
  suggestion: 'rgb(80,200,255)',   // cyan-blue for suggestions
  remember: 'rgb(80,200,255)',
  background: 'rgb(0,200,200)',    // cyan
  canvasBackground: 'transparent',
  success: 'rgb(57,255,91)',       // neon green — clear success signal
  error: 'rgb(255,60,60)',         // saturated red — clear error signal
  warning: 'rgb(255,165,0)',       // orange — amber warning
  merged: 'rgb(175,135,255)',      // purple — merged/complete state
  warningShimmer: 'rgb(255,205,60)',
  diffAdded: 'rgb(15,70,25)',      // dark green background for additions
  diffRemoved: 'rgb(80,15,15)',    // dark red background for removals
  diffAddedDimmed: 'rgb(30,55,35)',
  diffRemovedDimmed: 'rgb(60,30,30)',
  diffAddedWord: 'rgb(57,255,91)', // neon green word-level add
  diffRemovedWord: 'rgb(255,80,80)', // alert red word-level remove
  // Agent colors — high contrast on dark bg
  red_FOR_SUBAGENTS_ONLY: 'rgb(255,80,80)',
  blue_FOR_SUBAGENTS_ONLY: 'rgb(80,160,255)',
  green_FOR_SUBAGENTS_ONLY: 'rgb(57,255,91)',
  yellow_FOR_SUBAGENTS_ONLY: 'rgb(255,230,0)',
  purple_FOR_SUBAGENTS_ONLY: 'rgb(200,100,255)',
  orange_FOR_SUBAGENTS_ONLY: 'rgb(255,140,0)',
  pink_FOR_SUBAGENTS_ONLY: 'rgb(255,100,180)',
  cyan_FOR_SUBAGENTS_ONLY: 'rgb(0,220,220)',
  // Grove / Chrome
  professionalBlue: 'rgb(80,160,220)',
  chromeYellow: 'rgb(255,200,0)',
  // TUI V2 colors
  clawd_body: 'transparent',
  clawd_background: 'transparent',
  userMessageBackground: 'rgb(20,35,20)',   // very dark green tint
  userMessageBackgroundHover: 'rgb(28,48,28)',
  commandMessageBackground: 'transparent',
  messageActionsBackground: 'rgb(15,30,15)',
  selectionBg: 'rgb(20,80,30)',             // dark green selection
  bashMessageBackgroundColor: 'transparent',
  memoryBackgroundColor: 'transparent',
  rate_limit_fill: 'rgb(57,255,91)',
  rate_limit_empty: 'rgb(30,70,30)',
  fastMode: 'rgb(255,80,80)',               // red fast mode — urgency
  fastModeShimmer: 'rgb(255,130,130)',
  briefLabelYou: 'rgb(80,200,255)',         // cyan — user
  briefLabelClaude: 'rgb(57,255,91)',       // green — assistant
  rainbow_red: 'rgb(255,80,80)',
  rainbow_orange: 'rgb(255,140,0)',
  rainbow_yellow: 'rgb(255,230,0)',
  rainbow_green: 'rgb(57,255,91)',
  rainbow_blue: 'rgb(80,160,255)',
  rainbow_indigo: 'rgb(120,80,255)',
  rainbow_violet: 'rgb(200,80,200)',
  rainbow_red_shimmer: 'rgb(255,140,140)',
  rainbow_orange_shimmer: 'rgb(255,190,80)',
  rainbow_yellow_shimmer: 'rgb(255,245,80)',
  rainbow_green_shimmer: 'rgb(120,255,140)',
  rainbow_blue_shimmer: 'rgb(140,200,255)',
  rainbow_indigo_shimmer: 'rgb(170,140,255)',
  rainbow_violet_shimmer: 'rgb(230,140,230)',
  // Ambient — green-phosphor: glints verdes pré-misturados com preto (coerente
  // com o accent neon-green do tema; sem rosa/lavanda que destoariam do CRT).
  ambientLavender: 'rgb(18,34,22)',
  ambientPeriwinkle: 'rgb(16,32,28)',
  ambientMint: 'rgb(20,38,24)',
  ambientRose: 'rgb(24,36,22)',
  backgroundPanel: 'rgb(12,20,12)',
  backgroundElement: 'rgb(20,32,20)',
  border: 'rgb(40,70,40)',
  borderActive: 'rgb(57,255,91)',
  selectedListItemText: 'rgb(0,0,0)',
  diffLineNumber: 'rgb(80,120,80)',
  diffHunkHeader: 'rgb(90,140,90)',
}

/**
 * opencode — porte fiel da paleta default do opencode: warm orange (#fab283)
 * sobre near-black (#0a0a0a), accent roxo (#9d7cd8), e o conjunto de diff de
 * primeira classe (bg added/removed, highlight intra-linha, hunk header). É o
 * "tema principal" que o dono pediu. Herda do darkTheme (todos os ~90 roles
 * presentes) e sobrescreve os visíveis com os valores do opencode.
 */
const opencodeTheme: Theme = {
  ...darkTheme,
  // Accent único = roxo pastel (suave, não-saturado, legível em dark canvas).
  claude: 'rgb(180,155,230)',
  claudeShimmer: 'rgb(205,185,248)',
  autoAccept: 'rgb(180,155,230)',
  claudeBlue_FOR_SYSTEM_SPINNER: 'rgb(180,155,230)',
  claudeBlueShimmer_FOR_SYSTEM_SPINNER: 'rgb(205,185,248)',
  permission: 'rgb(155,175,230)', // azul-lavanda: "pergunta" ≠ "alarme"
  permissionShimmer: 'rgb(180,195,248)',
  planMode: 'rgb(200,170,245)', // roxo mais claro p/ plan mode
  merged: 'rgb(180,155,230)',
  bashBorder: 'rgb(72,72,72)',
  promptBorder: 'rgb(72,72,72)',
  promptBorderShimmer: 'rgb(96,96,96)',
  // Texto + hierarquia
  text: 'rgb(238,238,238)',
  inactive: 'rgb(128,128,128)',
  inactiveShimmer: 'rgb(160,160,160)',
  subtle: 'rgb(60,60,60)',
  suggestion: 'rgb(92,156,245)', // secondary azul do opencode
  remember: 'rgb(92,156,245)',
  // Semânticas (opencode)
  success: 'rgb(127,216,143)',
  error: 'rgb(224,108,117)',
  warning: 'rgb(245,167,66)',
  warningShimmer: 'rgb(255,190,110)',
  // Superfícies elevadas (darkStep1..3 + border steps)
  clawd_background: 'transparent',
  clawd_body: 'transparent',
  fastMode: 'rgb(220,180,255)', // sinal premium em roxo (era laranja elétrico herdado)
  fastModeShimmer: 'rgb(235,200,255)',
  background: 'rgb(10,10,10)',
  canvasBackground: 'transparent',
  // Non-linear depth ramp: a bigger canvas→panel jump (10→22) makes the panel
  // edge actually visible, while panel→field (22→28) stays a calm recessed step.
  backgroundPanel: 'rgb(22,22,24)',
  backgroundElement: 'rgb(28,28,31)',
  border: 'rgb(72,72,72)',
  borderActive: 'rgb(180,155,230)', // focus = the accent (pastel purple)
  selectedListItemText: 'rgb(10,10,10)',
  // Diff de primeira classe (opencode dark)
  diffAdded: 'rgb(32,48,59)', // diffAddedBg
  diffRemoved: 'rgb(60,40,50)', // diffRemovedBg (luminance-matched to diffAdded so equal hunks look equal)
  diffAddedDimmed: 'rgb(27,43,52)', // diffAddedLineNumberBg
  diffRemovedDimmed: 'rgb(50,36,44)', // diffRemovedLineNumberBg
  diffAddedWord: 'rgb(184,219,135)', // diffHighlightAdded
  diffRemovedWord: 'rgb(226,106,117)', // diffHighlightRemoved
  diffLineNumber: 'rgb(143,143,143)',
  diffHunkHeader: 'rgb(130,139,184)',
  // Chrome de mensagens / seleção
  userMessageBackground: 'rgb(20,20,20)',
  userMessageBackgroundHover: 'rgb(30,30,30)',
  commandMessageBackground: 'transparent',
  messageActionsBackground: 'rgb(28,30,38)',
  selectionBg: 'rgb(40,40,46)',
  bashMessageBackgroundColor: 'transparent',
  memoryBackgroundColor: 'transparent',
  briefLabelClaude: 'rgb(180,155,230)',
  briefLabelYou: 'rgb(92,156,245)',
  // Glints ambientes FRIOS/ROXO (pré-misturados com #0a0a0a) — coerentes com
  // o accent roxo-pastel; sussurram em volta do banner sem competir.
  ambientLavender: 'rgb(26,22,38)',
  ambientPeriwinkle: 'rgb(22,22,38)',
  ambientMint: 'rgb(22,26,36)',
  ambientRose: 'rgb(28,22,42)',
}

export function getTheme(themeName: ThemeName): Theme {
  switch (themeName) {
    case 'light':
      return lightTheme
    case 'light-ansi':
      return lightAnsiTheme
    case 'dark-ansi':
      return darkAnsiTheme
    case 'light-daltonized':
      return lightDaltonizedTheme
    case 'dark-daltonized':
      return darkDaltonizedTheme
    case 'pentest-dark':
      return pentestDarkTheme
    case 'opencode':
      return opencodeTheme
    default:
      return darkTheme
  }
}

// Create a chalk instance with 256-color level for Apple Terminal
// Apple Terminal doesn't handle 24-bit color escape sequences well
const chalkForChart =
  env.terminal === 'Apple_Terminal'
    ? new Chalk({ level: 2 }) // 256 colors
    : chalk

/**
 * Converts a theme color to an ANSI escape sequence for use with asciichart.
 * Uses chalk to generate the escape codes, with 256-color mode for Apple Terminal.
 */
export function themeColorToAnsi(themeColor: string): string {
  const rgbMatch = themeColor.match(/rgb\(\s?(\d+),\s?(\d+),\s?(\d+)\s?\)/)
  if (rgbMatch) {
    const r = parseInt(rgbMatch[1]!, 10)
    const g = parseInt(rgbMatch[2]!, 10)
    const b = parseInt(rgbMatch[3]!, 10)
    // Use chalk.rgb which auto-converts to 256 colors when level is 2
    // Extract just the opening escape sequence by using a marker
    const colored = chalkForChart.rgb(r, g, b)('X')
    return colored.slice(0, colored.indexOf('X'))
  }
  // Fallback to magenta if parsing fails
  return '\x1b[35m'
}
