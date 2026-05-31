import {
  formatCapacityStatus,
  formatUsageInteger,
  type UsageSummary
} from "../services/usageSummary";

type UsagePanelProps = {
  usageSummary: UsageSummary;
};

export function UsagePanel({ usageSummary }: UsagePanelProps) {
  return (
    <section className="usage-panel">
      <div className="usage-grid">
        <div>
          <span>Tokens</span>
          <strong>{formatUsageInteger(usageSummary.totalTokens)}</strong>
        </div>
        <div>
          <span>缓存命中</span>
          <strong>{usageSummary.cachedTokens > 0 ? `${Math.round(usageSummary.cacheHitRatio * 100)}%` : "n/a"}</strong>
        </div>
        <div>
          <span>容量</span>
          <strong>{usageSummary.capacity ? `${Math.round(usageSummary.capacity.utilization * 100)}%` : "n/a"}</strong>
        </div>
      </div>
      {usageSummary.capacity ? (
        <div className={`usage-capacity ${usageSummary.capacity.status}`}>
          <span>{formatCapacityStatus(usageSummary.capacity.status)}</span>
          <strong>{formatUsageInteger(usageSummary.capacity.estimatedInputTokens)} / {formatUsageInteger(usageSummary.capacity.maxInputTokens)} input tokens</strong>
          {usageSummary.capacity.seamLevel && usageSummary.capacity.seamLevel !== "ok" ? (
            <small>Seam {usageSummary.capacity.seamLevel.toUpperCase()}：{usageSummary.capacity.seamMessage}</small>
          ) : null}
          {usageSummary.capacity.compressed ? (
            <small>已将 {formatUsageInteger(usageSummary.capacity.omittedMessages)} 条旧消息压缩为约 {formatUsageInteger(usageSummary.capacity.summaryTokens)} tokens 摘要</small>
          ) : usageSummary.capacity.truncated ? (
            <small>上下文裁剪省略了 {formatUsageInteger(usageSummary.capacity.omittedMessages)} 条消息</small>
          ) : null}
        </div>
      ) : null}
      {usageSummary.cacheInspect ? (
        <div className="usage-cache-inspect">
          <span>Cache Inspect</span>
          <strong>prefix {usageSummary.cacheInspect.prefixHash}</strong>
          <small>
            warmup {formatWarmupStatus(usageSummary.cacheInspect.warmupStatus)}
            {" · "}
            hit {formatUsageInteger(usageSummary.cacheInspect.cachedTokens)}
            {" / miss "}
            {formatUsageInteger(usageSummary.cacheInspect.cacheMissTokens)}
            {" · "}
            {usageSummary.cacheInspect.changedPrefixLayers.length > 0
              ? `changed ${usageSummary.cacheInspect.changedPrefixLayers.join("、")}`
              : "stable prefix layers"}
          </small>
        </div>
      ) : null}
      {usageSummary.byModel.length > 0 ? (
        <div className="usage-model-list">
          <span>Model Tokens</span>
          {usageSummary.byModel.map((item) => (
            <div key={item.model}>
              <strong>{item.model}</strong>
              <small>
                hit {formatUsageInteger(item.cachedTokens)}
                {" · miss "}
                {formatUsageInteger(item.cacheMissTokens)}
                {" · out "}
                {formatUsageInteger(item.completionTokens)}
              </small>
            </div>
          ))}
        </div>
      ) : null}
      <div className="usage-list">
        {usageSummary.turns.slice(0, 6).map((item) => (
          <div key={item.turnId}>
            <span>{item.estimated ? "含估算" : "接口返回"}</span>
            <strong>{formatUsageInteger(item.totalTokens)} tokens</strong>
            <small>
              {item.model ?? "unknown model"}
              {" · cache "}
              {Math.round(item.cacheHitRatio * 100)}%
              {" · in "}
              {formatUsageInteger(item.cacheMissTokens)}
              {" + cached "}
              {formatUsageInteger(item.cachedTokens)}
              {" · out "}
              {formatUsageInteger(item.completionTokens)}
            </small>
          </div>
        ))}
        {usageSummary.turns.length === 0 ? <p className="panel-message">暂无 token usage 记录。</p> : null}
      </div>
    </section>
  );
}

function formatWarmupStatus(status: string | undefined) {
  switch (status) {
    case "warmed":
      return "warmed";
    case "hit":
      return "hit";
    case "failed":
      return "failed";
    case "unsupported":
      return "unsupported";
    case "disabled":
    default:
      return "off";
  }
}
