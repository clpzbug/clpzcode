// Sequências de frames para animações ASCII curadas.
// Princípio de design: cada frame é uma rotação/progressão natural do anterior —
// sem saltos de densidade ou posição. Todos usam braille 2×4 (U+2800–U+28FF).
//
// As melhores animações vêm de três famílias:
//   1. ROTAÇÃO DENSA  — 7 dots girando: ⣾→⣽→⣻→⢿→⡿→⣟→⣯→⣷ (suavíssimo)
//   2. ARCO SIMPLES   — 1 dot percorrendo 8 posições: ⠋→⠙→⠹→⠸→⠼→⠴→⠦→⠧→⠇→⠏
//   3. PULSO SIMÉTRICO — expande e contrai pelo centro: ⠀→⠤→⠶→⣶→⣿→⣶→⠶→⠤→⠀
// Fontes: cli-spinners (npm), ora (sindresorhus), listr2, pesquisa de TUI design.

/**
 * DONE — arco limpo, 2 varreduras completas de ⠋→⠏ e para.
 * Cada frame = dot avançando 36° no círculo: transição perfeitamente suave.
 */
export const DONE_FRAMES = [
  '⠋', '⠙', '⠹', '⠸', '⠼', '⠴',
  '⠋', '⠙', '⠹', '⠸', '⠼', '⠴',
] as const

/**
 * IDLE (subagente/background) — 1 dot orbitando 8 posições, peso mínimo.
 * Sinaliza "vivo mas não trabalhando pesado". Cada passo = 45°.
 */
export const IDLE_FRAMES = [
  '⠂', '⠒', '⠐', '⠰', '⠠', '⠤', '⠄', '⠆',
] as const

/**
 * THINK (raciocínio estendido) — rotação densa de 7 pontos, ⣾→⣷.
 * O padrão mais bem avaliado para "trabalho cognitivo pesado": cada frame
 * é uma rotação exata de 45° dos mesmos 7 dots → sem salto, sem vibração.
 * "dots8" do cli-spinners, padrão do ora v8+. Infinito.
 */
export const THINK_FRAMES = [
  '⣾', '⣽', '⣻', '⢿', '⡿', '⣟', '⣯', '⣷',
] as const

/**
 * TASK_FIRE — pulso lateral esquerda↔direita: sinaliza "disparo".
 * Loops once + settle.
 */
export const TASK_FIRE_FRAMES = [
  '⡇', '⢸', '⡇', '⢸', '⡇', '⢸', '⡇', '⢸',
] as const

/**
 * PERMISSION — 1 dot percorrendo 4 cantos ×3, settle vazio.
 * Traça um quadrado: senso de "conferindo os limites".
 */
export const PERMISSION_FRAMES = [
  '⠁', '⠈', '⢀', '⡀',
  '⠁', '⠈', '⢀', '⡀',
  '⠁', '⠈', '⢀', '⡀',
] as const

/**
 * SCAN (tool running) — arco de 10 frames, o "dots" original do cli-spinners.
 * ⠋→⠏: percorre as 10 posições do dot com step angular uniforme.
 * Considerado o spinner mais universalmente agradável (ora default, listr2).
 */
export const SCAN_FRAMES = [
  '⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏',
] as const

/**
 * UPLOAD — onda diagonal ⡀→⣿→⠈: dados fluindo para cima/direita.
 */
export const UPLOAD_FRAMES = [
  '⡀', '⡄', '⡆', '⡇', '⣇', '⣧', '⣷', '⣿',
  '⣿', '⣾', '⣼', '⣸', '⢸', '⠸', '⠘', '⠈',
] as const

/**
 * WAIT (bloqueado) — pulso simétrico lento pelo centro: ⠀→⠤→⠶→⣶→⣿→↩.
 * Puro fill-expand e retração — sem saltos laterais ou diagonais.
 * fps baixo (6-8) reforça "parado aguardando", não trabalho ativo.
 */
export const WAIT_FRAMES = [
  '⠀', '⠤', '⠶', '⣶', '⣾', '⣿',
  '⣾', '⣶', '⠶', '⠤', '⠀', '⠀',
] as const

/**
 * ATTACK — diagonal CW densa→vazia. Ferramentas ofensivas. Infinito.
 */
export const ATTACK_FRAMES = [
  '⠈', '⠘', '⢘', '⢸', '⣸', '⣼', '⣾', '⣿',
  '⣿', '⡿', '⡇', '⡆', '⡄', '⠄', '⠀', '⠈',
] as const

/**
 * CRACK — alternância rápida de padrões densos. Brute-force/CPU-intenso.
 */
export const CRACK_FRAMES = [
  '⣿', '⢿', '⡿', '⣟', '⣯', '⣷', '⣾', '⣽',
  '⣻', '⣺', '⣹', '⣸', '⣼', '⣾', '⣿', '⠀',
] as const

/**
 * EXFIL — onda diagonal ⠁→⣿→⠀: dados saindo. Infinito.
 */
export const EXFIL_FRAMES = [
  '⠁', '⠃', '⠇', '⡇', '⣇', '⣧', '⣷', '⣿',
  '⢿', '⠿', '⠾', '⠼', '⠸', '⠰', '⠠', '⠀',
] as const

/**
 * PROBE — 1 dot varrendo coluna esquerda topo→base→topo.
 * Peso mínimo: checks rápidos, não scans pesados.
 */
export const PROBE_FRAMES = [
  '⠁', '⠂', '⠄', '⡀', '⠄', '⠂',
] as const

/**
 * PAYLOAD — pulso simétrico puro pelo centro: ⠀→⠤→⠶→⠶→⠤→⠀.
 * Expande e retrai com total simetria — sem saltos de densidade.
 */
export const PAYLOAD_FRAMES = [
  '⠀', '⠤', '⠶', '⣶', '⣶', '⠶', '⠤', '⠀',
] as const

/**
 * FOUND — órbita confirmando, settle center.
 */
export const FOUND_FRAMES = [
  '⠁', '⠈', '⢀', '⡀', '⠄', '⠂',
  '⠂', '⠂', '⠂', '⠂',
] as const

// ORBIT (ORTHOGRAM spinner): one stroke walking a fixed 3-wide cell; every frame
// is exactly 3 columns so the stroke never jitters width. First box-drawing entry.
export const ORBIT_FRAMES = [
  '╶──', '╭──', '─╮ ', '──╮', '──╯', '─╯─', '╰──', '╰─╴',
] as const
