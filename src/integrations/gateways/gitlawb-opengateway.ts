import { defineGateway } from '../define.js'

export default defineGateway({
  id: 'gitlawb-opengateway',
  label: 'clpzbug Opengateway',
  category: 'aggregating',
  defaultBaseUrl: 'https://opengateway.gitlawb.com/v1',
  defaultModel: 'mimo-v2.5-pro',
  supportsModelRouting: true,
  setup: {
    requiresAuth: true,
    authMode: 'api-key',
    credentialEnvVars: ['OPENGATEWAY_API_KEY'],
  },
  transportConfig: {
    kind: 'openai-compatible',
  },
  preset: {
    id: 'gitlawb-opengateway',
    description: 'clpzbug Opengateway (free partner models)',
    apiKeyEnvVars: ['OPENGATEWAY_API_KEY'],
    modelEnvVars: ['OPENAI_MODEL'],
    vendorId: 'openai',
  },
  validation: {
    kind: 'credential-env',
    routing: {
      matchDefaultBaseUrl: true,
      matchBaseUrlHosts: ['opengateway.gitlawb.com', 'opengateway.fly.dev'],
    },
    credentialEnvVars: ['OPENGATEWAY_API_KEY', 'OPENAI_API_KEY'],
    missingCredentialMessage:
      'Set OPENGATEWAY_API_KEY or OPENAI_API_KEY for clpzbug Opengateway.',
  },
  catalog: {
    source: 'hybrid',
    discovery: { kind: 'openai-compatible', requiresAuth: true },
    discoveryCacheTtl: '1d',
    discoveryRefreshMode: 'background-if-stale',
    allowManualRefresh: true,
    models: [
      { id: 'mimo-v2.5-pro', apiName: 'mimo-v2.5-pro', label: 'Mimo v2.5 Pro', modelDescriptorId: 'mimo-v2.5-pro' },
    ],
  },
  usage: { supported: false },
})
