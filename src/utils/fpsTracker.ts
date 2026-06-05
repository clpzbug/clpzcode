export type FpsMetrics = {
  averageFps: number
  low1PctFps: number
}

const FPS_RESERVOIR_SIZE = 1024

export class FpsTracker {
  private frameDurations: number[] = []
  private frameCount = 0
  private firstRenderTime: number | undefined
  private lastRenderTime: number | undefined

  record(durationMs: number): void {
    const now = performance.now()
    if (this.firstRenderTime === undefined) {
      this.firstRenderTime = now
    }
    this.lastRenderTime = now
    this.frameCount++
    // Reservoir sampling (Algorithm R) bounds memory while keeping the duration
    // distribution representative for p99 (mirrors stats.tsx RESERVOIR_SIZE=1024).
    if (this.frameDurations.length < FPS_RESERVOIR_SIZE) {
      this.frameDurations.push(durationMs)
    } else {
      const j = Math.floor(Math.random() * this.frameCount)
      if (j < FPS_RESERVOIR_SIZE) {
        this.frameDurations[j] = durationMs
      }
    }
  }

  getMetrics(): FpsMetrics | undefined {
    if (
      this.frameDurations.length === 0 ||
      this.firstRenderTime === undefined ||
      this.lastRenderTime === undefined
    ) {
      return undefined
    }

    const totalTimeMs = this.lastRenderTime - this.firstRenderTime
    if (totalTimeMs <= 0) {
      return undefined
    }

    const totalFrames = this.frameCount
    const averageFps = totalFrames / (totalTimeMs / 1000)

    const sorted = this.frameDurations.slice().sort((a, b) => b - a)
    const p99Index = Math.max(0, Math.ceil(sorted.length * 0.01) - 1)
    const p99FrameTimeMs = sorted[p99Index]!
    const low1PctFps = p99FrameTimeMs > 0 ? 1000 / p99FrameTimeMs : 0

    return {
      averageFps: Math.round(averageFps * 100) / 100,
      low1PctFps: Math.round(low1PctFps * 100) / 100,
    }
  }
}
