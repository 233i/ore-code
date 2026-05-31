import { useState } from "react";
import { Button, Tag } from "tdesign-react";
import { CopyIcon } from "tdesign-icons-react";
import {
  formatCapacityStatus,
  formatUsageInteger,
  type UsageSummary
} from "../services/usageSummary";

type ContextInspectorPanelProps = {
  usageSummary: UsageSummary;
};

export function ContextInspectorPanel({ usageSummary }: ContextInspectorPanelProps) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const capacity = usageSummary.capacity;
  const percent = capacity ? Math.round(Math.min(1, Math.max(0, capacity.utilization)) * 100) : 0;
  const cacheInspect = usageSummary.cacheInspect;
  const projectIndex = usageSummary.projectIndex;
  const projectDelta = usageSummary.projectDelta;
  const lazyContext = usageSummary.lazyContext;

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(buildContextSummary(usageSummary));
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1400);
    } catch {
      setCopyState("failed");
      window.setTimeout(() => setCopyState("idle"), 1800);
    }
  }

  if (!capacity) {
    return (
      <section className="context-inspector-panel">
        <div className="context-empty-state">
          <strong>暂无上下文数据</strong>
          <p>发送一轮对话后，这里会显示当前请求估算、模型窗口、cache prefix 和历史裁剪状态。</p>
        </div>
      </section>
    );
  }

  const layerTotal = Math.max(1, cacheInspect?.layers.reduce((sum, layer) => sum + layer.tokens, 0) ?? capacity.estimatedInputTokens);

  return (
    <section className="context-inspector-panel">
      <div className="context-inspector-hero">
        <div>
          <span>当前请求估算</span>
          <strong>{percent}%</strong>
          <small>{formatUsageInteger(capacity.estimatedInputTokens)} / {formatUsageInteger(capacity.maxInputTokens)} input tokens</small>
        </div>
        <Button
          icon={<CopyIcon size="14px" />}
          size="small"
          type="button"
          variant="outline"
          onClick={() => void copySummary()}
        >
          {copyState === "copied" ? "已复制" : copyState === "failed" ? "复制失败" : "复制摘要"}
        </Button>
      </div>

      <div className={`context-budget-meter ${capacity.status}`}>
        <span style={{ width: `${percent}%` }} />
      </div>

      <div className="context-metric-grid">
        <Metric label="状态" value={formatCapacityStatus(capacity.status)} />
        <Metric label="模型" value={capacity.model ?? "unknown"} />
        <Metric label="模型窗口" value={formatCompactTokens(capacity.contextWindow ?? 0)} />
        <Metric label="输出预留" value={formatCompactTokens(capacity.maxOutputTokens ?? 0)} />
        <Metric label="Headroom" value={formatCompactTokens(capacity.safetyHeadroomTokens ?? 0)} />
        <Metric label="Reasoning replay" value={formatCompactTokens(capacity.reasoningReplayTokens ?? 0)} />
      </div>

      {projectIndex ? (
        <section className="context-inspector-section">
          <header>
            <strong>项目索引</strong>
            <Tag theme={projectIndex.status === "hit" ? "success" : projectIndex.status === "miss" ? "warning" : "default"} variant="light">
              {projectIndexStatusText(projectIndex.status)}
            </Tag>
          </header>
          <div className="context-strategy-grid">
            <Metric label="参考文件" value={formatUsageInteger(projectIndex.fileCount)} />
            <Metric label="索引来源" value={projectIndex.semanticIndexSource ?? "none"} />
            <Metric label="索引文件" value={formatUsageInteger(projectIndex.semanticIndexDocumentCount ?? 0)} />
            <Metric label="状态" value={projectIndex.message} />
          </div>
          {projectIndex.paths.length > 0 ? (
            <p className="context-seam-message">参考：{projectIndex.paths.slice(0, 5).join("、")}{projectIndex.paths.length > 5 ? " ..." : ""}</p>
          ) : null}
        </section>
      ) : null}

      {projectDelta ? (
        <section className="context-inspector-section">
          <header>
            <strong>Project Delta</strong>
            <Tag theme={projectDelta.errors.length > 0 ? "danger" : projectDelta.changedFiles.length > 0 ? "warning" : "success"} variant="light">
              已进入 Ledger
            </Tag>
          </header>
          <p className="context-seam-message">{projectDelta.summary}</p>
          <div className="context-strategy-grid">
            <Metric label="变更文件" value={formatUsageInteger(projectDelta.changedFiles.length)} />
            <Metric label="读取路径" value={formatUsageInteger(projectDelta.readPaths.length)} />
            <Metric label="测试/检查" value={formatUsageInteger(projectDelta.testResults.length)} />
            <Metric label="错误" value={formatUsageInteger(projectDelta.errors.length)} />
          </div>
          {projectDelta.changedFiles.length > 0 ? (
            <p className="context-seam-message">
              文件变更：{projectDelta.changedFiles.slice(0, 5).map((change) =>
                `${change.changeKind} ${change.path}`
              ).join("、")}{projectDelta.changedFiles.length > 5 ? " ..." : ""}
            </p>
          ) : null}
          {projectDelta.workingSetPaths.length > 0 ? (
            <p className="context-seam-message">
              Working set：{projectDelta.workingSetPaths.slice(0, 6).join("、")}{projectDelta.workingSetPaths.length > 6 ? " ..." : ""}
            </p>
          ) : null}
          {projectDelta.testResults.length > 0 ? (
            <p className="context-seam-message">
              测试：{projectDelta.testResults.slice(0, 3).map((result) =>
                `${result.toolName} ${result.ok ? "ok" : "failed"}${result.exitCode !== undefined ? ` exit=${result.exitCode}` : ""}`
              ).join("、")}
            </p>
          ) : null}
          {projectDelta.errors.length > 0 ? (
            <p className="context-seam-message">
              错误：{projectDelta.errors.slice(0, 3).map((error) =>
                `${error.toolName ?? error.source}: ${error.message}`
              ).join("、")}
            </p>
          ) : null}
        </section>
      ) : null}

      <section className="context-inspector-section">
        <header>
          <strong>请求分层</strong>
          <small>{cacheInspect ? `prefix ${cacheInspect.prefixHash}` : "暂无 cache prefix"}</small>
        </header>
        {cacheInspect ? (
          <>
            <div className={cacheInspect.breaksPrefix ? "context-layer changed" : "context-layer"}>
              <div className="context-layer-row">
                <strong>{cacheInspect.breaksPrefix ? "缓存基线变化" : "缓存基线稳定"}</strong>
                <span>{cacheBreakReasonText(cacheInspect.breakReason)}</span>
              </div>
              <small>{cacheInspect.breakMessage}</small>
            </div>
            <div className="context-layer-list">
              {cacheInspect.layers.map((layer) => (
                <div className={layer.breaksPrefix ? "context-layer changed" : "context-layer"} key={layer.name}>
                  <div className="context-layer-row">
                    <strong>{layer.label}</strong>
                    <span>{formatUsageInteger(layer.tokens)} tokens</span>
                  </div>
                  <div className="context-layer-bar">
                    <span style={{ width: `${Math.max(2, Math.round((layer.tokens / layerTotal) * 100))}%` }} />
                  </div>
                  <small>
                    {layer.includedInPrefix ? "prefix" : "dynamic"}
                    {" · "}
                    {layer.cacheStable ? "stable" : "volatile"}
                    {layer.changedSincePrevious ? ` · ${segmentReasonText(cacheInspect.segmentDiffs.find((diff) => diff.name === layer.name)?.reason)}` : ""}
                    {" · "}
                    {layer.hash}
                  </small>
                </div>
              ))}
            </div>
          </>
        ) : (
          <p className="panel-empty">当前请求没有可展示的分层数据。</p>
        )}
      </section>

      <section className="context-inspector-section">
        <header>
          <strong>历史策略</strong>
          <Tag theme={capacity.compressed ? "warning" : capacity.truncated ? "default" : "success"} variant="light">
            {capacity.compressed ? "已压缩" : capacity.truncated ? "已裁剪" : "原文"}
          </Tag>
        </header>
        <div className="context-strategy-grid">
          <Metric label="省略消息" value={formatUsageInteger(capacity.omittedMessages)} />
          <Metric label="摘要 tokens" value={formatUsageInteger(capacity.summaryTokens)} />
          <Metric label="工具输出压缩" value={capacity.shouldCompressToolOutputs ? "建议" : "无需"} />
          <Metric label="历史压缩" value={capacity.shouldCompressHistory ? "建议" : "无需"} />
          <Metric label="Reasoning 保留" value={reasoningRetentionText(capacity)} />
          <Metric label="Reasoning 修复" value={reasoningHealingText(capacity)} />
          <Metric label="Checkpoint" value={checkpointStatusText(capacity)} />
          <Metric label="新基线" value={checkpointBaselineText(capacity)} />
        </div>
        {capacity.checkpoint ? (
          <p className="context-seam-message">
            {checkpointReasonText(capacity.checkpoint.reason)}：{capacity.checkpoint.message}
          </p>
        ) : null}
        {capacity.seamLevel && capacity.seamLevel !== "ok" ? (
          <p className="context-seam-message">Seam {capacity.seamLevel.toUpperCase()}：{capacity.seamMessage}</p>
        ) : null}
      </section>

      <section className="context-inspector-section">
        <header>
          <strong>Lazy Context</strong>
          <Tag theme={lazyContext.injectedLoads > 0 ? "success" : lazyContext.totalLoads > 0 ? "default" : "default"} variant="light">
            {lazyContext.totalLoads > 0 ? `${lazyContext.totalLoads} loads` : "未加载"}
          </Tag>
        </header>
        <div className="context-strategy-grid">
          <Metric label="已加载" value={formatUsageInteger(lazyContext.totalLoads)} />
          <Metric label="进入 Ledger" value={formatUsageInteger(lazyContext.injectedLoads)} />
          <Metric label="正文字符" value={formatUsageInteger(lazyContext.totalChars)} />
          <Metric label="策略" value="索引优先" />
        </div>
        {lazyContext.sources.length > 0 ? (
          <p className="context-seam-message">
            最近加载：{lazyContext.sources.slice(0, 4).map((source) =>
              `${lazySourceText(source.source)} ${source.title}${source.injected ? " (ledger)" : ""}`
            ).join("、")}
          </p>
        ) : (
          <p className="context-seam-message">Skill、memory、MCP resource 和 MCP prompt 正文会按需加载，避免污染固定 prefix。</p>
        )}
      </section>

      <section className="context-inspector-section">
        <header>
          <strong>Prefix Cache</strong>
          <small>{cacheInspect?.promptHash ? `prompt ${cacheInspect.promptHash}` : "暂无 prompt hash"}</small>
        </header>
        <div className="context-strategy-grid">
          <Metric label="Warmup" value={formatWarmupStatus(cacheInspect?.warmupStatus)} />
          <Metric label="可缓存前缀" value={formatCompactTokens(cacheInspect?.cacheablePrefixTokens ?? 0)} />
          <Metric label="动态层" value={formatCompactTokens(cacheInspect?.dynamicTokens ?? 0)} />
          <Metric label="命中率" value={cacheInspect ? `${Math.round(cacheInspect.cacheHitRatio * 100)}%` : "n/a"} />
        </div>
        {cacheInspect?.warmupMessage ? <p className="context-seam-message">{cacheInspect.warmupMessage}</p> : null}
        {cacheInspect ? (
          <p className="context-seam-message">
            {cacheInspect.breaksPrefix ? "Cache break" : "Cache stable"}：{cacheInspect.breakMessage}
          </p>
        ) : null}
        {cacheInspect?.changedPrefixLayers.length ? (
          <p className="context-seam-message">变化的 prefix 层：{cacheInspect.changedPrefixLayers.join("、")}</p>
        ) : null}
        {cacheInspect?.recentRequestMetadata.length ? (
          <p className="context-seam-message">
            最近 request metadata：{cacheInspect.recentRequestMetadata.map((metadata) =>
              `${metadata.turnId.slice(0, 8)}:${metadata.prefixHash ?? "n/a"}`
            ).join(" / ")}
          </p>
        ) : null}
      </section>

      <section className="context-inspector-section">
        <header>
          <strong>累计用量</strong>
          <small>{formatUsageInteger(usageSummary.totalTokens)} tokens</small>
        </header>
        <div className="context-strategy-grid">
          <Metric label="Total tokens" value={formatUsageInteger(usageSummary.totalTokens)} />
          <Metric label="Cached" value={formatUsageInteger(usageSummary.cachedTokens)} />
          <Metric label="Cache miss" value={formatUsageInteger(usageSummary.cacheMissTokens)} />
          <Metric label="Reasoning" value={formatUsageInteger(usageSummary.reasoningTokens)} />
        </div>
      </section>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="context-metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildContextSummary(usageSummary: UsageSummary) {
  const capacity = usageSummary.capacity;
  if (!capacity) {
    return "No context capacity data.";
  }

  const layers = usageSummary.cacheInspect?.layers
    .map((layer) => `- ${layer.label}: ${layer.tokens} tokens, ${layer.includedInPrefix ? "prefix" : "dynamic"}, ${layer.hash}`)
    .join("\n") ?? "- No cache prefix layers.";

  return [
    "# SeekForge Context Summary",
    `Model: ${capacity.model ?? "unknown"}`,
    `Status: ${capacity.status}`,
    `Input: ${capacity.estimatedInputTokens}/${capacity.maxInputTokens}`,
    `Context window: ${capacity.contextWindow ?? "n/a"}`,
    `Max output reserve: ${capacity.maxOutputTokens ?? "n/a"}`,
    `Safety headroom: ${capacity.safetyHeadroomTokens ?? "n/a"}`,
    `Seam: ${capacity.seamLevel ?? "n/a"} ${capacity.seamMessage ?? ""}`.trim(),
    `History: ${capacity.compressed ? "compressed" : capacity.truncated ? "truncated" : "verbatim"}, omitted=${capacity.omittedMessages}, summaryTokens=${capacity.summaryTokens}`,
    `Reasoning replay tokens: ${capacity.reasoningReplayTokens ?? 0}`,
    `Reasoning retention: ${reasoningRetentionText(capacity)}, ${reasoningHealingText(capacity)}`,
    `Checkpoint: ${checkpointStatusText(capacity)}, ${checkpointBaselineText(capacity)}`,
    usageSummary.cacheInspect
      ? `Cache break: ${usageSummary.cacheInspect.breakReason}, ${usageSummary.cacheInspect.breakMessage}`
      : "Cache break: no cache prefix data",
    usageSummary.projectIndex
      ? `Project index: ${usageSummary.projectIndex.status}, files=${usageSummary.projectIndex.fileCount}, source=${usageSummary.projectIndex.semanticIndexSource ?? "none"}`
      : "Project index: no event",
    usageSummary.projectDelta
      ? `Project delta: ${usageSummary.projectDelta.summary}, workingSet=${usageSummary.projectDelta.workingSetPaths.join(", ")}`
      : "Project delta: no event",
    `Lazy context: loads=${usageSummary.lazyContext.totalLoads}, injected=${usageSummary.lazyContext.injectedLoads}, chars=${usageSummary.lazyContext.totalChars}`,
    "",
    "## Prefix Layers",
    layers
  ].join("\n");
}

function reasoningRetentionText(capacity: NonNullable<UsageSummary["capacity"]>) {
  const retention = capacity.reasoningRetention;
  if (!retention?.enabled) {
    return "未启用";
  }
  return `保留 ${formatUsageInteger(retention.keptMessages)}，清理 ${formatUsageInteger(retention.strippedMessages)}`;
}

function reasoningHealingText(capacity: NonNullable<UsageSummary["capacity"]>) {
  const retention = capacity.reasoningRetention;
  if (!retention?.enabled) {
    return "未启用";
  }
  return retention.healingApplied
    ? `已补 ${formatUsageInteger(retention.healedMessages)}`
    : "无需";
}

function checkpointStatusText(capacity: NonNullable<UsageSummary["capacity"]>) {
  const checkpoint = capacity.checkpoint;
  if (!checkpoint) {
    return "未启用";
  }
  switch (checkpoint.status) {
    case "applied":
      return "已建立新基线";
    case "candidate":
      return "接近阈值";
    case "none":
    default:
      return "未触发";
  }
}

function checkpointBaselineText(capacity: NonNullable<UsageSummary["capacity"]>) {
  const checkpoint = capacity.checkpoint;
  if (!checkpoint) {
    return "n/a";
  }
  if (checkpoint.status === "applied" && checkpoint.inputTokensAfter !== undefined) {
    return `${formatCompactTokens(checkpoint.inputTokensBefore)} -> ${formatCompactTokens(checkpoint.inputTokensAfter)}`;
  }
  return `阈值 ${formatCompactTokens(checkpoint.thresholdTokens)}`;
}

function checkpointReasonText(reason: NonNullable<NonNullable<UsageSummary["capacity"]>["checkpoint"]>["reason"]) {
  switch (reason) {
    case "reasoning_retention":
      return "Reasoning 基线";
    case "provider_limit":
      return "Provider 上限";
    case "manual":
      return "手动检查点";
    case "restore":
      return "恢复边界";
    case "capacity":
    default:
      return "容量检查点";
  }
}

function lazySourceText(source: NonNullable<UsageSummary["lazyContext"]>["sources"][number]["source"]) {
  switch (source) {
    case "skill":
      return "Skill";
    case "memory":
      return "Memory";
    case "mcp_resource":
      return "MCP Resource";
    case "mcp_prompt":
      return "MCP Prompt";
  }
}

function projectIndexStatusText(status: NonNullable<UsageSummary["projectIndex"]>["status"]) {
  switch (status) {
    case "hit":
      return "已命中";
    case "miss":
      return "未命中";
    case "skipped":
      return "未注入";
  }
}

function formatWarmupStatus(status: string | undefined) {
  switch (status) {
    case "warmed":
      return "已预热";
    case "hit":
      return "已命中";
    case "failed":
      return "失败";
    case "unsupported":
      return "不支持";
    case "disabled":
    default:
      return "未启用";
  }
}

function cacheBreakReasonText(reason: string) {
  switch (reason) {
    case "first_request":
      return "首次记录";
    case "core_changed":
      return "Core 变化";
    case "tool_changed":
      return "工具变化";
    case "project_changed":
      return "项目变化";
    case "ledger_changed":
      return "历史变化";
    case "dynamic_tail_changed":
      return "输入变化";
    case "none":
    default:
      return "稳定";
  }
}

function segmentReasonText(reason: string | undefined) {
  switch (reason) {
    case "core_changed":
      return "core changed";
    case "tool_changed":
      return "tool changed";
    case "project_changed":
      return "project changed";
    case "ledger_changed":
      return "ledger changed";
    case "dynamic_tail_changed":
      return "tail changed";
    case "first_request":
      return "first request";
    case "none":
    default:
      return "changed";
  }
}

function formatCompactTokens(value: number) {
  if (!value) {
    return "n/a";
  }

  if (value >= 1_000_000) {
    return `${Math.round(value / 1_000_000)}M`;
  }

  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`;
  }

  return formatUsageInteger(value);
}
