import type { ToolUseContext } from '../Tool.js'
import type { Command } from '../types/command.js'
import {
  benchmarkModel,
  benchmarkMultipleModels,
  formatBenchmarkResults,
  isBenchmarkSupported,
} from '../utils/model/benchmark.js'
import { getCachedOllamaModelOptions } from '../utils/model/ollamaModels.js'

async function runBenchmark(
  model?: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  context?: any,
): Promise<void> {
  if (!isBenchmarkSupported()) {
    context?.stdout?.write(
      'Benchmark not supported for this provider.\n' +
        'Supported: OpenAI-compatible endpoints (Ollama, NVIDIA NIM, MiniMax)\n',
    )
    return
  }

  let modelsToBenchmark: string[]

  if (model) {
    modelsToBenchmark = [model]
  } else {
    const ollamaModels = getCachedOllamaModelOptions()
    modelsToBenchmark = ollamaModels.slice(0, 3).map((m: any) => m.value)
  }

  context?.stdout?.write(`Benchmarking ${modelsToBenchmark.length} model(s)...\n`)

  const results = await benchmarkMultipleModels(
    modelsToBenchmark,
    (completed, total, result) => {
      context?.stdout?.write(
        `[${completed}/${total}] ${result.model}: ` +
          `${result.success ? result.tokensPerSecond.toFixed(1) + ' tps' : 'FAILED'}\n`,
      )
    },
  )

  context?.stdout?.write('\n' + formatBenchmarkResults(results) + '\n')
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const benchmark: Command = {
  name: 'benchmark',

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async onExecute(context: any): Promise<void> {
    const args = context.args ?? {}
    const model = args.model as string | undefined

    await runBenchmark(model, context)
  },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any as Command