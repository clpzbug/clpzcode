import { getInitialSettings } from '../utils/settings/settings.js'

export function getSpinnerVerbs(): string[] {
  const settings = getInitialSettings()
  const config = settings.spinnerVerbs
  if (!config) {
    return SPINNER_VERBS
  }
  if (config.mode === 'replace') {
    return config.verbs.length > 0 ? config.verbs : SPINNER_VERBS
  }
  return [...SPINNER_VERBS, ...config.verbs]
}

export const SPINNER_VERBS = [
  'scanning',
  'probing',
  'fuzzing',
  'mapping',
  'tracing',
  'pivoting',
  'sniffing',
  'staging',
  'hooking',
  'injecting',
  'routing',
  'forking',
  'parsing',
  'crawling',
  'threading',
  'chaining',
  'patching',
  'diffing',
  'reversing',
  'debugging',
  'shadowing',
  'mirroring',
  'tunneling',
  'spoofing',
  'replaying',
  'dumping',
  'logging',
  'caching',
  'encoding',
  'decoding',
  'binding',
  'listening',
  'resolving',
  'querying',
  'streaming',
  'seeding',
  'glitching',
  'looping',
  'polling',
  'trapping',
  'mounting',
  'syncing',
  'branching',
  'compiling',
  'linking',
  'drifting',
  'ghosting',
  'evading',
  'bypassing',
  'weaving',
  'sinking',
  'bleeding',
  'leaking',
  'dropping',
  'catching',
  'wrapping',
  'signing',
  'verifying',
  'timing',
  'hashing',
  'indexing',
  'buffering',
]
