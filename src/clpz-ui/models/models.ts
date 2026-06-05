import type { ModelInfo, ReasoningEffort } from "../types/index";

// Model catalog for the clpzcode frontend picker, derived from the REAL clpzcode
// model catalog (src/utils/model/modelOptions.ts) rather than a hardcoded xAI
// list. Each clpzcode ModelOption is mapped to the TUI ModelInfo shape the App
// consumes. The `id` we expose is the clpzcode model setting/value, so it round
// trips straight through agentBridge.setModel() -> QueryEngine mainLoopModel.
//
// getModelOptions() touches config/auth/provider state that is not available at
// module-load time ("Config accessed before allowed."), so the catalog is built
// lazily and memoized on first successful build. A small hardcoded fallback (the
// xAI/Grok models the original clpzcode picker offered via the xai provider)
// keeps the App functional if the real catalog cannot be read yet.

const PROVIDER_PREFIX_RE = /^(x-ai|xai)\//i;

// Only the current flagship is kept as the static fallback. grok-4 / grok-3 /
// grok-code-fast-1 were RETIRED (May 2026) and would return API errors if shown;
// the full, live model list comes from getXaiModelOptions() (xAI /v1/models) once
// connected. Don't hardcode dead ids here.
const FALLBACK_MODELS: ModelInfo[] = [
  {
    id: "grok-4.3",
    name: "Grok 4.3",
    contextWindow: 1_000_000,
    inputPrice: 0,
    outputPrice: 0,
    reasoning: true,
    description: "xAI Grok 4.3 flagship reasoning model",
  },
];

// Resolve the contextWindow for a clpzcode model value/string. We avoid pulling
// the heavy clpzcode model-context module into the TUI subtree; family +
// [1m]/1M heuristics are sufficient for the App's display + getContextStats.
function contextWindowFor(value: string): number {
  const v = value.toLowerCase();
  if (/\[(1|2)m\]/.test(v) || /\b1m\b/.test(v) || v.includes("1m context")) {
    return 1_000_000;
  }
  if (v.includes("haiku")) return 200_000;
  if (v.includes("grok")) return 1_000_000;
  // IMPORTANT: a model being *capable* of 1M (modelSupports1M) is NOT the same
  // as the window in effect. The engine only sends the 1M beta header for ids
  // with a [1m] suffix (handled by the top check), so the plain "Sonnet"/"Opus"
  // run at the standard 200K. The one exception is the server-side 1M
  // experiment for Sonnet 4.6 (coral_reef), which the engine also treats as 1M.
  try {
    const { getSonnet1mExpTreatmentEnabled } =
      require("../../utils/context.js") as typeof import("../../utils/context.js");
    if (getSonnet1mExpTreatmentEnabled(resolveCapabilityModel(value))) return 1_000_000;
  } catch {
    /* fall through to family default */
  }
  // Sonnet / Opus / Codex / GPT and unknown families default to 200K.
  return 200_000;
}

// Whether a model is a reasoning model (drives the picker's reasoning badge).
function reasoningFor(value: string, description: string): boolean {
  const v = `${value} ${description}`.toLowerCase();
  if (v.includes("haiku")) return false;
  if (v.includes("non-reasoning")) return false;
  if (v.includes("opus") || v.includes("sonnet")) return true;
  if (v.includes("reasoning")) return true;
  if (v.includes("grok")) return true;
  return false;
}

// Resolve a catalog id (which may be a bare alias like 'sonnet'/'opus') to the
// concrete model string the engine checks capabilities against. Falls back to
// the input when parsing is unavailable (non-clpzcode context) or fails.
function resolveCapabilityModel(modelId: string): string {
  try {
    const { parseUserSpecifiedModel } =
      require("../../utils/model/model.js") as typeof import("../../utils/model/model.js");
    return parseUserSpecifiedModel(modelId) || modelId;
  } catch {
    return modelId;
  }
}

let cachedModels: ModelInfo[] | null = null;
let cachedDefaultId: string | null = null;

// Build the Opus version options the standard getModelOptions() picker omits by
// account TIER (a Claude subscriber's picker shows only one Opus row). We reuse
// the engine's own exported primitives — getModelStrings() for the concrete,
// round-trippable model string and getOpus46PricingSuffix() for the price tail —
// and reproduce the exact label/description templates from modelOptions.ts'
// internal getOpus48/47/46Option (those functions are not exported). Each entry
// carries a distinct concrete id (e.g. 'claude-opus-4-8') so the picker can
// select and round-trip it via agentBridge.setModel().
function getExtraOpusOptions(): import("../../utils/model/modelOptions.js").ModelOption[] {
  const { getModelStrings } =
    require("../../utils/model/modelStrings.js") as typeof import("../../utils/model/modelStrings.js");
  const { getOpus46PricingSuffix } =
    require("../../utils/model/model.js") as typeof import("../../utils/model/model.js");
  const strings = getModelStrings();
  const suffix = getOpus46PricingSuffix(false);
  return [
    {
      value: strings.opus48,
      label: "Opus 4.8",
      description: `Opus 4.8 · Most capable for complex work${suffix}`,
    },
    {
      value: strings.opus47,
      label: "Opus 4.7",
      description: `Opus 4.7 · Most capable for complex work${suffix}`,
    },
    {
      value: strings.opus46,
      label: "Opus 4.6",
      description: `Opus 4.6 · Most capable for complex work${suffix}`,
    },
  ];
}

function buildCatalog(): { models: ModelInfo[]; defaultId: string } {
  // Lazy require so the clpzcode model modules (and their config access) only
  // load once the engine boot has enabled config reading.
  const {
    getModelOptions,
  } = require("../../utils/model/modelOptions.js") as typeof import("../../utils/model/modelOptions.js");
  const {
    getDefaultMainLoopModelSetting,
    parseUserSpecifiedModel,
  } = require("../../utils/model/model.js") as typeof import("../../utils/model/model.js");
  const {
    getXaiModelOptions,
  } = require("../../utils/model/multiProviderOptions.js") as typeof import("../../utils/model/multiProviderOptions.js");
  const {
    modelSupportsEffort,
  } = require("../../utils/effort.js") as typeof import("../../utils/effort.js");

  // The Default option carries value: null. Resolve it to the concrete default
  // model setting so the exposed id is a real string the engine understands.
  const defaultSetting = getDefaultMainLoopModelSetting();
  const defaultId = String(defaultSetting);

  // Show ALL of the account's models: the standard picker options, every Opus
  // version (added for the Heavy/full-access plan), and the live xAI/Grok models
  // when connected (getXaiModelOptions() returns null when xAI is disconnected,
  // in which case nothing is added). Dedup happens by resolved id below.
  const xaiOptions = getXaiModelOptions();
  const options = [
    ...getModelOptions(),
    ...getExtraOpusOptions(),
    ...(xaiOptions ?? []),
  ];
  const seen = new Set<string>();
  const models: ModelInfo[] = [];

  for (const opt of options) {
    const id = opt.value === null ? defaultId : String(opt.value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    models.push({
      id,
      name: opt.label,
      description: opt.description,
      contextWindow: contextWindowFor(id),
      inputPrice: 0,
      outputPrice: 0,
      reasoning: reasoningFor(id, opt.description),
      supportsReasoningEffort: modelSupportsEffort(resolveCapabilityModel(id)),
    });
  }

  // Guard against an empty/degenerate catalog: always offer at least the
  // resolved default so the picker is never blank.
  if (models.length === 0) {
    const resolved = parseUserSpecifiedModel(defaultSetting);
    models.push({
      id: defaultId,
      name: "Default",
      description: resolved,
      contextWindow: contextWindowFor(defaultId),
      inputPrice: 0,
      outputPrice: 0,
      reasoning: reasoningFor(defaultId, ""),
      supportsReasoningEffort: modelSupportsEffort(resolveCapabilityModel(defaultId)),
    });
  }

  return { models, defaultId };
}

function ensureCatalog(): ModelInfo[] {
  if (cachedModels) return cachedModels;
  try {
    const { models, defaultId } = buildCatalog();
    cachedModels = models;
    cachedDefaultId = defaultId;
    return cachedModels;
  } catch {
    // Config not ready yet (or non-clpzcode context): serve the fallback list
    // without memoizing, so a later access can pick up the real catalog.
    return FALLBACK_MODELS;
  }
}

function ensureDefaultId(): string {
  ensureCatalog();
  return cachedDefaultId ?? FALLBACK_MODELS[0]?.id ?? "grok-4.3";
}

// Drop the memoized catalog so the next MODELS access rebuilds it. Call after
// prefetchXaiModels() resolves: otherwise the catalog is frozen to whatever was
// cached before the async xAI /v1/models fetch landed, so live models (the real,
// current Grok list) never reach the picker until the process restarts.
export function invalidateModelCatalog(): void {
  cachedModels = null;
  cachedDefaultId = null;
}

// MODELS is consumed directly by the App (map/filter/findIndex/length). Back it
// with a Proxy that lazily (re)builds the catalog on each access until the real
// clpzcode catalog is available, then serves the memoized array.
export const MODELS: ModelInfo[] = new Proxy([] as ModelInfo[], {
  get(_target, prop, receiver) {
    const list = ensureCatalog();
    const value = Reflect.get(list, prop, receiver);
    return typeof value === "function" ? value.bind(list) : value;
  },
  has(_target, prop) {
    return prop in ensureCatalog();
  },
  ownKeys() {
    return Reflect.ownKeys(ensureCatalog());
  },
  getOwnPropertyDescriptor(_target, prop) {
    return Reflect.getOwnPropertyDescriptor(ensureCatalog(), prop);
  },
});

// DEFAULT_MODEL must be a real id present in MODELS (the App does
// MODELS.findIndex(m => m.id === DEFAULT_MODEL)). It is resolved lazily via a
// getter on the module namespace would not work for a `const`, so callers read
// it through getDefaultModelId(); we still export DEFAULT_MODEL as a value for
// the existing import sites by computing it on first module evaluation only when
// config is ready, falling back otherwise. To keep it always-correct we expose
// it as a getter-backed binding.
export const DEFAULT_MODEL: string = ((): string => {
  // Best-effort eager resolution; falls back if config isn't ready yet. Call
  // sites that need the live value (after boot) should prefer the functions
  // below, but DEFAULT_MODEL is also re-resolved by getModelInfo/normalize.
  return ensureDefaultId();
})();

function buildAliasMap(): Map<string, string> {
  const aliasMap = new Map<string, string>();
  for (const model of ensureCatalog()) {
    aliasMap.set(model.id.toLowerCase(), model.id);
  }
  // Family aliases the clpzcode engine understands. Only map to a concrete id
  // when that id is present in the catalog, so picker identity stays valid.
  const families: Array<[string, RegExp]> = [
    ["sonnet", /sonnet/i],
    ["opus", /opus/i],
    ["haiku", /haiku/i],
  ];
  const list = ensureCatalog();
  for (const [alias, re] of families) {
    if (aliasMap.has(alias)) continue;
    const match = list.find((m) => re.test(m.id) || re.test(m.name));
    if (match) aliasMap.set(alias, match.id);
  }
  return aliasMap;
}

export function normalizeModelId(modelId: string): string {
  const trimmed = modelId.trim();
  if (!trimmed) return trimmed;

  const withoutProviderPrefix = trimmed.replace(PROVIDER_PREFIX_RE, "");
  const aliasMap = buildAliasMap();
  return aliasMap.get(withoutProviderPrefix.toLowerCase()) ?? withoutProviderPrefix;
}

export function getModelInfo(modelId: string): ModelInfo | undefined {
  const normalized = normalizeModelId(modelId);
  return ensureCatalog().find((m) => m.id === normalized);
}

export function getModelIds(): string[] {
  return ensureCatalog().map((m) => m.id);
}

export function isKnownModelId(modelId: string): boolean {
  return !!getModelInfo(modelId);
}

export function getSupportedReasoningEfforts(modelId: string): ReasoningEffort[] {
  // Derive the picker's effort choices from the REAL clpzcode capability
  // helpers so they match what resolveAppliedEffort() will actually send.
  // Lazy require mirrors buildCatalog(): the engine boot must have enabled
  // config reading before these touch provider/auth state.
  const {
    modelSupportsEffort,
    modelSupportsMaxEffort,
    modelUsesOpenAIEffort,
  } = require("../../utils/effort.js") as typeof import("../../utils/effort.js");
  // The engine parses the model setting (e.g. the bare alias 'sonnet' or
  // 'opus') into a concrete model string before checking effort capability
  // (QueryEngine resolves userSpecifiedModel -> parseUserSpecifiedModel). Mirror
  // that here so the picker's choices match what the engine actually sends; the
  // raw alias 'sonnet' fails modelSupportsEffort() but 'claude-sonnet-4-6' passes.
  const resolved = resolveCapabilityModel(normalizeModelId(modelId));
  if (!modelSupportsEffort(resolved)) return [];
  if (modelUsesOpenAIEffort(resolved)) {
    return ["low", "medium", "high", "xhigh"];
  }
  const efforts: ReasoningEffort[] = ["low", "medium", "high"];
  if (modelSupportsMaxEffort(resolved)) {
    efforts.push("max");
  }
  return efforts;
}

export function getEffectiveReasoningEffort(modelId: string, override?: ReasoningEffort): ReasoningEffort | undefined {
  const supported = getSupportedReasoningEfforts(modelId);
  if (supported.length === 0) return undefined;
  if (override && supported.includes(override)) return override;
  const defaultEffort = getModelInfo(modelId)?.defaultReasoningEffort;
  if (defaultEffort && supported.includes(defaultEffort)) return defaultEffort;
  // Default to the highest supported effort: deep work is the norm here, so a
  // fresh session should reason at max ('max' for Claude, 'xhigh' for grok)
  // unless the user dials it down in the picker.
  if (supported.includes("max")) return "max";
  if (supported.includes("xhigh")) return "xhigh";
  if (supported.includes("high")) return "high";
  return supported[0];
}
