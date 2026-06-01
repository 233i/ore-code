import type { RuntimeEvent } from "@ore-code/protocol";
import { diffRequestSegments, type RequestSegmentDiffReason } from "@ore-code/agent-core";

export type UsageSummary = {
  totalTokens: number;
  cachedTokens: number;
  cacheMissTokens: number;
  cacheHitRatio: number;
  reasoningTokens: number;
  costUsd: number;
  costCny: number;
  cacheHitInputCostUsd: number;
  cacheMissInputCostUsd: number;
  outputCostUsd: number;
  cacheHitInputCostCny: number;
  cacheMissInputCostCny: number;
  outputCostCny: number;
  estimatedCostUsd: number;
  estimatedCostCny: number;
  providerCostUsd: number;
  providerCostCny: number;
  cacheInspect: {
    prefixHash?: string;
    promptHash?: string;
    cacheablePrefixTokens: number;
    dynamicTokens: number;
    cachedTokens: number;
    cacheMissTokens: number;
    cacheHitRatio: number;
    warmupStatus?: "disabled" | "unsupported" | "hit" | "warmed" | "failed";
    warmupMessage?: string;
    warmupUpdatedAt?: string;
    breakReason: RequestSegmentDiffReason;
    breakMessage: string;
    breaksPrefix: boolean;
    changedPrefixLayers: string[];
    recentRequestMetadata: Array<{
      turnId: string;
      prefixHash?: string;
      promptHash?: string;
      layers: Array<{
        name: string;
        label: string;
        hash: string;
      }>;
    }>;
    segmentDiffs: Array<{
      name: string;
      label: string;
      previousHash?: string;
      currentHash: string;
      changed: boolean;
      breaksPrefix: boolean;
      reason: RequestSegmentDiffReason;
      message: string;
    }>;
    layers: Array<{
      name: string;
      label: string;
      hash: string;
      tokens: number;
      includedInPrefix: boolean;
      cacheStable: boolean;
      changedSincePrevious: boolean;
      breaksPrefix: boolean;
    }>;
  } | null;
  byModel: Array<{
    model: string;
    provider?: string;
    promptTokens: number;
    cachedTokens: number;
    cacheMissTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    cacheHitRatio: number;
    costUsd: number;
    costCny: number;
    cacheHitInputCostUsd: number;
    cacheMissInputCostUsd: number;
    outputCostUsd: number;
    cacheHitInputCostCny: number;
    cacheMissInputCostCny: number;
    outputCostCny: number;
    estimatedCostUsd: number;
    estimatedCostCny: number;
    providerCostUsd: number;
    providerCostCny: number;
  }>;
  capacity: {
    provider?: string;
    model?: string;
    contextWindow?: number;
    estimatedInputTokens: number;
    maxInputTokens: number;
    maxOutputTokens?: number;
    safetyHeadroomTokens?: number;
    reasoningReplayTokens?: number;
    reasoningRetention?: Extract<RuntimeEvent, { type: "context_capacity" }>["reasoningRetention"];
    checkpoint?: Extract<RuntimeEvent, { type: "context_capacity" }>["checkpoint"];
    prefixHash?: string;
    cachePrefix?: Extract<RuntimeEvent, { type: "context_capacity" }>["cachePrefix"];
    cacheWarmupStatus?: Extract<RuntimeEvent, { type: "context_capacity" }>["cacheWarmupStatus"];
    cacheWarmupMessage?: string;
    cacheWarmupUpdatedAt?: string;
    seamLevel?: "ok" | "l1" | "l2" | "l3" | "cycle" | "hard";
    seamMessage?: string;
    shouldCompressToolOutputs?: boolean;
    shouldCompressHistory?: boolean;
    shouldGenerateBriefing?: boolean;
    utilization: number;
    status: "ok" | "warning" | "critical";
    truncated: boolean;
    omittedMessages: number;
    compressed: boolean;
    summaryTokens: number;
  } | null;
  projectIndex: {
    turnId: string;
    status: "hit" | "miss" | "skipped";
    fileCount: number;
    paths: string[];
    semanticIndexSource?: "cache" | "fresh" | "none";
    semanticIndexDocumentCount?: number;
    message: string;
  } | null;
  projectDelta: {
    turnId: string;
    summary: string;
    readPaths: string[];
    changedFiles: Extract<RuntimeEvent, { type: "project_delta" }>["changedFiles"];
    testResults: Extract<RuntimeEvent, { type: "project_delta" }>["testResults"];
    errors: Extract<RuntimeEvent, { type: "project_delta" }>["errors"];
    artifacts: Extract<RuntimeEvent, { type: "project_delta" }>["artifacts"];
    workingSetPaths: string[];
  } | null;
  lazyContext: {
    totalLoads: number;
    injectedLoads: number;
    totalChars: number;
    sources: Array<{
      contentChars: number;
      injected: boolean;
      source: Extract<RuntimeEvent, { type: "lazy_context_loaded" }>["source"];
      sourceId: string;
      summary: string;
      title: string;
      turnId: string;
    }>;
  };
  recent: Array<{
    id: string;
    turnId: string;
    model?: string;
    provider?: string;
    promptTokens: number;
    completionTokens: number;
    cachedTokens: number;
    cacheMissTokens: number;
    reasoningTokens: number;
    cacheHitRatio: number;
    totalTokens: number;
    costUsd: number;
    costCny: number;
    cacheHitInputCostUsd: number;
    cacheMissInputCostUsd: number;
    outputCostUsd: number;
    cacheHitInputCostCny: number;
    cacheMissInputCostCny: number;
    outputCostCny: number;
    estimated: boolean;
  }>;
  turns: Array<{
    turnId: string;
    model?: string;
    provider?: string;
    promptTokens: number;
    cachedTokens: number;
    cacheMissTokens: number;
    completionTokens: number;
    reasoningTokens: number;
    totalTokens: number;
    cacheHitRatio: number;
    costUsd: number;
    costCny: number;
    cacheHitInputCostUsd: number;
    cacheMissInputCostUsd: number;
    outputCostUsd: number;
    cacheHitInputCostCny: number;
    cacheMissInputCostCny: number;
    outputCostCny: number;
    estimatedCostUsd: number;
    estimatedCostCny: number;
    providerCostUsd: number;
    providerCostCny: number;
    estimated: boolean;
  }>;
};

export function deriveUsageSummary(events: RuntimeEvent[]): UsageSummary {
  const usageEvents = events.filter((event) => event.type === "token_usage");
  const capacityEvents = events.filter((event) => event.type === "context_capacity");
  const projectIndexEvents = events.filter((event) => event.type === "codebase_context");
  const projectDeltaEvents = events.filter((event) => event.type === "project_delta");
  const lazyContextEvents = events.filter((event) => event.type === "lazy_context_loaded");
  const totalTokens = usageEvents.reduce((sum, event) => sum + event.totalTokens, 0);
  const cachedTokens = usageEvents.reduce((sum, event) => sum + (event.cachedTokens ?? 0), 0);
  const cacheMissTokens = usageEvents.reduce((sum, event) => sum + (event.cacheMissTokens ?? Math.max(0, event.promptTokens - (event.cachedTokens ?? 0))), 0);
  const reasoningTokens = usageEvents.reduce((sum, event) => sum + (event.reasoningTokens ?? 0), 0);
  const costUsd = sumCost(usageEvents, (event) => event.costUsd);
  const costCny = sumCost(usageEvents, (event) => event.costCny);
  const cacheHitInputCostUsd = sumCost(usageEvents, (event) => event.cacheHitInputCostUsd);
  const cacheMissInputCostUsd = sumCost(usageEvents, (event) => event.cacheMissInputCostUsd);
  const outputCostUsd = sumCost(usageEvents, (event) => event.outputCostUsd);
  const cacheHitInputCostCny = sumCost(usageEvents, (event) => event.cacheHitInputCostCny);
  const cacheMissInputCostCny = sumCost(usageEvents, (event) => event.cacheMissInputCostCny);
  const outputCostCny = sumCost(usageEvents, (event) => event.outputCostCny);
  const estimatedCostUsd = sumCost(usageEvents, (event) => event.estimated ? event.costUsd : 0);
  const estimatedCostCny = sumCost(usageEvents, (event) => event.estimated ? event.costCny : 0);
  const providerCostUsd = sumCost(usageEvents, (event) => !event.estimated ? event.costUsd : 0);
  const providerCostCny = sumCost(usageEvents, (event) => !event.estimated ? event.costCny : 0);
  const latestCapacity = capacityEvents[capacityEvents.length - 1];
  const previousCapacity = capacityEvents[capacityEvents.length - 2];
  const latestUsage = usageEvents[usageEvents.length - 1];
  const latestCachedTokens = latestUsage?.cachedTokens ?? 0;
  const latestCacheMissTokens = latestUsage
    ? latestUsage.cacheMissTokens ?? Math.max(0, latestUsage.promptTokens - latestCachedTokens)
    : 0;

  return {
    totalTokens,
    cachedTokens,
    cacheMissTokens,
    cacheHitRatio: cachedTokens + cacheMissTokens > 0 ? cachedTokens / (cachedTokens + cacheMissTokens) : 0,
    reasoningTokens,
    costUsd,
    costCny,
    cacheHitInputCostUsd,
    cacheMissInputCostUsd,
    outputCostUsd,
    cacheHitInputCostCny,
    cacheMissInputCostCny,
    outputCostCny,
    estimatedCostUsd,
    estimatedCostCny,
    providerCostUsd,
    providerCostCny,
    cacheInspect: deriveCacheInspect(latestCapacity, previousCapacity, {
      cachedTokens: latestCachedTokens,
      cacheMissTokens: latestCacheMissTokens,
      cacheHitRatio: latestCachedTokens + latestCacheMissTokens > 0 ? latestCachedTokens / (latestCachedTokens + latestCacheMissTokens) : 0
    }),
    byModel: summarizeByModel(usageEvents),
    capacity: latestCapacity
      ? {
        provider: latestCapacity.provider,
        model: latestCapacity.model,
        contextWindow: latestCapacity.contextWindow,
        estimatedInputTokens: latestCapacity.estimatedInputTokens,
        maxInputTokens: latestCapacity.maxInputTokens,
        maxOutputTokens: latestCapacity.maxOutputTokens,
        safetyHeadroomTokens: latestCapacity.safetyHeadroomTokens,
        reasoningReplayTokens: latestCapacity.reasoningReplayTokens,
        reasoningRetention: latestCapacity.reasoningRetention,
        checkpoint: latestCapacity.checkpoint,
        prefixHash: latestCapacity.prefixHash,
        cachePrefix: latestCapacity.cachePrefix,
        cacheWarmupStatus: latestCapacity.cacheWarmupStatus,
        cacheWarmupMessage: latestCapacity.cacheWarmupMessage,
        cacheWarmupUpdatedAt: latestCapacity.cacheWarmupUpdatedAt,
        seamLevel: latestCapacity.seamLevel,
        seamMessage: latestCapacity.seamMessage,
        shouldCompressToolOutputs: latestCapacity.shouldCompressToolOutputs,
        shouldCompressHistory: latestCapacity.shouldCompressHistory,
        shouldGenerateBriefing: latestCapacity.shouldGenerateBriefing,
        utilization: latestCapacity.utilization,
        status: latestCapacity.status,
        truncated: latestCapacity.truncated,
        omittedMessages: latestCapacity.omittedMessages,
        compressed: latestCapacity.compressed ?? false,
        summaryTokens: latestCapacity.summaryTokens ?? 0
      }
      : null,
    projectIndex: latestProjectIndexSummary(projectIndexEvents),
    projectDelta: latestProjectDeltaSummary(projectDeltaEvents),
    lazyContext: summarizeLazyContext(lazyContextEvents),
    recent: usageEvents.slice().reverse().map((event) => ({
      id: event.id,
      turnId: event.turnId,
      provider: event.provider,
      model: event.model,
      promptTokens: event.promptTokens,
      completionTokens: event.completionTokens,
      cachedTokens: event.cachedTokens ?? 0,
      cacheMissTokens: event.cacheMissTokens ?? Math.max(0, event.promptTokens - (event.cachedTokens ?? 0)),
      reasoningTokens: event.reasoningTokens ?? 0,
      cacheHitRatio: event.cacheHitRatio ?? (event.promptTokens > 0 ? (event.cachedTokens ?? 0) / event.promptTokens : 0),
      totalTokens: event.totalTokens,
      costUsd: event.costUsd ?? 0,
      costCny: event.costCny ?? 0,
      cacheHitInputCostUsd: event.cacheHitInputCostUsd ?? 0,
      cacheMissInputCostUsd: event.cacheMissInputCostUsd ?? 0,
      outputCostUsd: event.outputCostUsd ?? 0,
      cacheHitInputCostCny: event.cacheHitInputCostCny ?? 0,
      cacheMissInputCostCny: event.cacheMissInputCostCny ?? 0,
      outputCostCny: event.outputCostCny ?? 0,
      estimated: event.estimated ?? false
    })),
    turns: summarizeByTurn(usageEvents)
  };
}

export function formatUsageInteger(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

export function formatUsageUsd(value: number) {
  if (!value) {
    return "$0.000000";
  }
  return `$${value.toFixed(6)}`;
}

export function formatUsageCny(value: number) {
  if (!value) {
    return "¥0.000000";
  }
  return `¥${value.toFixed(6)}`;
}

export function formatCapacityStatus(status: "ok" | "warning" | "critical") {
  switch (status) {
    case "ok":
      return "正常";
    case "warning":
      return "接近输入预算";
    case "critical":
      return "需要压缩或减少上下文";
  }
}

type UsageEvent = Extract<RuntimeEvent, { type: "token_usage" }>;
type ProjectIndexEvent = Extract<RuntimeEvent, { type: "codebase_context" }>;
type ProjectDeltaEvent = Extract<RuntimeEvent, { type: "project_delta" }>;
type LazyContextEvent = Extract<RuntimeEvent, { type: "lazy_context_loaded" }>;

function latestProjectIndexSummary(events: ProjectIndexEvent[]): UsageSummary["projectIndex"] {
  const latest = events[events.length - 1];
  if (!latest) {
    return null;
  }

  return {
    turnId: latest.turnId,
    status: latest.status,
    fileCount: latest.fileCount,
    paths: latest.paths,
    semanticIndexSource: latest.semanticIndexSource,
    semanticIndexDocumentCount: latest.semanticIndexDocumentCount,
    message: latest.message
  };
}

function latestProjectDeltaSummary(events: ProjectDeltaEvent[]): UsageSummary["projectDelta"] {
  const latest = events[events.length - 1];
  if (!latest) {
    return null;
  }

  return {
    turnId: latest.turnId,
    summary: latest.summary,
    readPaths: latest.readPaths,
    changedFiles: latest.changedFiles,
    testResults: latest.testResults,
    errors: latest.errors,
    artifacts: latest.artifacts,
    workingSetPaths: latest.workingSetPaths
  };
}

function summarizeLazyContext(events: LazyContextEvent[]): UsageSummary["lazyContext"] {
  return {
    totalLoads: events.length,
    injectedLoads: events.filter((event) => Boolean(event.content)).length,
    totalChars: events.reduce((sum, event) => sum + event.contentChars, 0),
    sources: events.slice(-12).reverse().map((event) => ({
      contentChars: event.contentChars,
      injected: Boolean(event.content),
      source: event.source,
      sourceId: event.sourceId,
      summary: event.summary,
      title: event.title,
      turnId: event.turnId
    }))
  };
}

function summarizeByModel(events: UsageEvent[]) {
  const byModel = new Map<string, ReturnType<typeof emptyUsageRollup> & { model: string; provider?: string }>();
  for (const event of events) {
    const model = event.model ?? "unknown";
    const current = byModel.get(model) ?? { model, provider: event.provider, ...emptyUsageRollup() };
    addUsageEvent(current, event);
    byModel.set(model, current);
  }

  return [...byModel.values()].sort((left, right) => right.costUsd - left.costUsd);
}

function summarizeByTurn(events: UsageEvent[]): UsageSummary["turns"] {
  const byTurn = new Map<string, ReturnType<typeof emptyUsageRollup> & { turnId: string; model?: string; provider?: string }>();
  for (const event of events) {
    const current = byTurn.get(event.turnId) ?? { turnId: event.turnId, model: event.model, provider: event.provider, ...emptyUsageRollup() };
    current.model = event.model ?? current.model;
    current.provider = event.provider ?? current.provider;
    addUsageEvent(current, event);
    byTurn.set(event.turnId, current);
  }

  return [...byTurn.values()].reverse();
}

function emptyUsageRollup() {
  return {
    promptTokens: 0,
    cachedTokens: 0,
    cacheMissTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    cacheHitRatio: 0,
    costUsd: 0,
    costCny: 0,
    cacheHitInputCostUsd: 0,
    cacheMissInputCostUsd: 0,
    outputCostUsd: 0,
    cacheHitInputCostCny: 0,
    cacheMissInputCostCny: 0,
    outputCostCny: 0,
    estimatedCostUsd: 0,
    estimatedCostCny: 0,
    providerCostUsd: 0,
    providerCostCny: 0,
    estimated: false
  };
}

function addUsageEvent(target: ReturnType<typeof emptyUsageRollup>, event: UsageEvent) {
  const cachedTokens = event.cachedTokens ?? 0;
  const cacheMissTokens = event.cacheMissTokens ?? Math.max(0, event.promptTokens - cachedTokens);
  target.promptTokens += event.promptTokens;
  target.cachedTokens += cachedTokens;
  target.cacheMissTokens += cacheMissTokens;
  target.completionTokens += event.completionTokens;
  target.reasoningTokens += event.reasoningTokens ?? 0;
  target.totalTokens += event.totalTokens;
  target.costUsd = roundCost(target.costUsd + (event.costUsd ?? 0));
  target.costCny = roundCost(target.costCny + (event.costCny ?? 0));
  target.cacheHitInputCostUsd = roundCost(target.cacheHitInputCostUsd + (event.cacheHitInputCostUsd ?? 0));
  target.cacheMissInputCostUsd = roundCost(target.cacheMissInputCostUsd + (event.cacheMissInputCostUsd ?? 0));
  target.outputCostUsd = roundCost(target.outputCostUsd + (event.outputCostUsd ?? 0));
  target.cacheHitInputCostCny = roundCost(target.cacheHitInputCostCny + (event.cacheHitInputCostCny ?? 0));
  target.cacheMissInputCostCny = roundCost(target.cacheMissInputCostCny + (event.cacheMissInputCostCny ?? 0));
  target.outputCostCny = roundCost(target.outputCostCny + (event.outputCostCny ?? 0));
  target.estimatedCostUsd = roundCost(target.estimatedCostUsd + (event.estimated ? event.costUsd ?? 0 : 0));
  target.estimatedCostCny = roundCost(target.estimatedCostCny + (event.estimated ? event.costCny ?? 0 : 0));
  target.providerCostUsd = roundCost(target.providerCostUsd + (event.estimated ? 0 : event.costUsd ?? 0));
  target.providerCostCny = roundCost(target.providerCostCny + (event.estimated ? 0 : event.costCny ?? 0));
  target.cacheHitRatio = target.promptTokens > 0 ? target.cachedTokens / target.promptTokens : 0;
  target.estimated = target.estimated || Boolean(event.estimated);
}

function sumCost(events: UsageEvent[], selector: (event: UsageEvent) => number | undefined) {
  return roundCost(events.reduce((sum, event) => sum + (selector(event) ?? 0), 0));
}

function roundCost(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function deriveCacheInspect(
  latestCapacity: Extract<RuntimeEvent, { type: "context_capacity" }> | undefined,
  previousCapacity: Extract<RuntimeEvent, { type: "context_capacity" }> | undefined,
  usage: { cachedTokens: number; cacheMissTokens: number; cacheHitRatio: number }
): UsageSummary["cacheInspect"] {
  if (!latestCapacity?.cachePrefix) {
    return null;
  }

  const diff = diffRequestSegments(
    previousCapacity?.cachePrefix?.layers,
    latestCapacity.cachePrefix.layers
  );
  const previousByName = new Map(
    (previousCapacity?.cachePrefix?.layers ?? []).map((layer) => [layer.name, layer])
  );
  const diffByName = new Map(diff.allSegments.map((segment) => [segment.name, segment]));
  const layers = latestCapacity.cachePrefix.layers.map((layer) => {
    const previous = previousByName.get(layer.name);
    const changedSincePrevious = Boolean(previous && previous.hash !== layer.hash);
    const layerDiff = diffByName.get(layer.name);
    return {
      name: layer.name,
      label: layer.label,
      hash: layer.hash,
      tokens: layer.tokens,
      includedInPrefix: layer.includedInPrefix,
      cacheStable: layer.cacheStable,
      changedSincePrevious,
      breaksPrefix: layerDiff?.breaksPrefix ?? false
    };
  });

  return {
    prefixHash: latestCapacity.cachePrefix.prefixHash,
    promptHash: latestCapacity.cachePrefix.promptHash,
    cacheablePrefixTokens: latestCapacity.cachePrefix.cacheablePrefixTokens,
    dynamicTokens: latestCapacity.cachePrefix.dynamicTokens,
    cachedTokens: usage.cachedTokens,
    cacheMissTokens: usage.cacheMissTokens,
    cacheHitRatio: usage.cacheHitRatio,
    warmupStatus: latestCapacity.cacheWarmupStatus,
    warmupMessage: latestCapacity.cacheWarmupMessage,
    warmupUpdatedAt: latestCapacity.cacheWarmupUpdatedAt,
    breakReason: diff.reason,
    breakMessage: diff.message,
    breaksPrefix: diff.breaksPrefix,
    changedPrefixLayers: layers.filter((layer) => layer.breaksPrefix).map((layer) => layer.label),
    recentRequestMetadata: [previousCapacity, latestCapacity]
      .filter((event): event is Extract<RuntimeEvent, { type: "context_capacity" }> => Boolean(event?.cachePrefix))
      .map((event) => ({
        turnId: event.turnId,
        prefixHash: event.cachePrefix?.prefixHash,
        promptHash: event.cachePrefix?.promptHash,
        layers: (event.cachePrefix?.layers ?? []).map((layer) => ({
          name: layer.name,
          label: layer.label,
          hash: layer.hash
        }))
      })),
    segmentDiffs: diff.allSegments,
    layers
  };
}
