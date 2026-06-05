/**
 * System memory ceiling — the real RAM this process may use, honouring a cgroup
 * limit (containers) over the host's total RAM, plus the V8 old-space sizing
 * shared with the launcher (bin/clpzcode). Centralizing the formula keeps the
 * in-process governor and the launcher agreeing on the heap ceiling.
 */
import { totalmem } from 'os'
import { readFileSync } from 'fs'

const MB = 1024 * 1024

/**
 * cgroup memory limit in bytes, or null when unlimited/unavailable. Under a
 * container, os.totalmem() reports HOST RAM, not the cgroup cap — sizing the
 * heap off that lets V8 grow many multiples past the real limit and the kernel
 * OOM-kills on RSS before any in-process tier fires. v2: /sys/fs/cgroup/memory.max
 * ("max" = unlimited). v1: memory.limit_in_bytes (a ~2^63 sentinel = unlimited).
 * Only honour a limit strictly below host total (a limit >= total is no cap).
 */
export function readCgroupMemLimitBytes(): number | null {
  const total = totalmem()
  try {
    const raw = readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim()
    if (raw === 'max') return null
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0 && n < total) return n
  } catch {
    // not cgroup v2 — try v1
  }
  try {
    const raw = readFileSync('/sys/fs/cgroup/memory/memory.limit_in_bytes', 'utf8').trim()
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0 && n < total) return n
  } catch {
    // no cgroup info available
  }
  return null
}

/** Effective total memory in bytes: min(cgroup limit, host total). */
export function getEffectiveTotalMemBytes(): number {
  const cg = readCgroupMemLimitBytes()
  const total = totalmem()
  return cg != null ? Math.min(cg, total) : total
}

/**
 * V8 old-space ceiling (MB) for a machine with `effectiveTotalMb` of usable RAM.
 * ~70% of available, capped at 16 GB. The 4 GB floor applies ONLY when the box
 * is big enough to afford it (>= 6 GB) — on a small VM/container, forcing 4 GB
 * would license V8 past the real limit and invite the OOM-killer. Pure so it can
 * be unit-tested with synthetic sizes. Mirrored inline in the dep-free launcher.
 */
export function computeHeapCeilingMb(effectiveTotalMb: number): number {
  const target = Math.floor(effectiveTotalMb * 0.7)
  const floored = effectiveTotalMb >= 6144 ? Math.max(4096, target) : target
  return Math.min(16384, Math.max(512, floored))
}

/** Heap ceiling (MB) sized to this machine's effective (cgroup-aware) RAM. */
export function resolveHeapCeilingMb(): number {
  return computeHeapCeilingMb(Math.floor(getEffectiveTotalMemBytes() / MB))
}
