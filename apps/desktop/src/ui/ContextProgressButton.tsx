import { useState, type CSSProperties } from "react";
import { Popup } from "tdesign-react";
import {
  formatCapacityStatus,
  formatUsageInteger,
  type UsageSummary
} from "../services/usageSummary";

type ContextProgressButtonProps = {
  isRunning: boolean;
  onOpenInspector: () => void;
  usageSummary: UsageSummary;
};

export function ContextProgressButton({ isRunning, onOpenInspector, usageSummary }: ContextProgressButtonProps) {
  const [visible, setVisible] = useState(false);
  const capacity = usageSummary.capacity;
  const utilization = capacity ? Math.min(1, Math.max(0, capacity.utilization)) : 0;
  const percent = Math.round(utilization * 100);
  const status = capacity?.status ?? "empty";
  const ringStyle = { "--context-progress": `${percent * 3.6}deg` } as CSSProperties;

  function openInspector() {
    setVisible(false);
    onOpenInspector();
  }

  return (
    <Popup
      destroyOnClose
      overlayInnerClassName="composer-menu-popover context-progress-popover"
      placement="top-right"
      trigger="click"
      visible={visible}
      onVisibleChange={setVisible}
      content={(
        <div className="context-progress-panel">
          <header>
            <span>当前请求估算</span>
            <strong>{capacity ? `${percent}%` : "暂无数据"}</strong>
          </header>
          <div className="context-progress-meter">
            <span className={`context-progress-ring ${status}`} style={ringStyle}>
              {isRunning ? <span className="context-running-dot" aria-hidden="true" /> : <span>{capacity ? percent : "--"}</span>}
            </span>
            <div>
              <strong>{capacity ? formatCapacityStatus(capacity.status) : "等待首次请求"}</strong>
              <small>
                {capacity
                  ? `${formatUsageInteger(capacity.estimatedInputTokens)} / ${formatUsageInteger(capacity.maxInputTokens)} input tokens`
                  : "发送一轮对话后会显示容量估算。"}
              </small>
            </div>
          </div>
          {capacity ? (
            <div className="context-progress-inline">
              <span>窗口 {capacity.contextWindow ? formatCompactTokens(capacity.contextWindow) : "n/a"}</span>
              <span>输出 {capacity.maxOutputTokens ? formatCompactTokens(capacity.maxOutputTokens) : "n/a"}</span>
              <span>Headroom {capacity.safetyHeadroomTokens ? formatCompactTokens(capacity.safetyHeadroomTokens) : "n/a"}</span>
            </div>
          ) : null}
          {capacity?.seamLevel && capacity.seamLevel !== "ok" ? (
            <p>Seam {capacity.seamLevel.toUpperCase()}：{capacity.seamMessage}</p>
          ) : null}
          {capacity ? <p>{historyPolicyText(capacity)}</p> : null}
          {usageSummary.projectIndex ? (
            <p>
              项目索引：{projectIndexStatusText(usageSummary.projectIndex.status)}
              {usageSummary.projectIndex.status === "hit" ? `，参考 ${usageSummary.projectIndex.fileCount} 个文件` : ""}
            </p>
          ) : null}
          <div className="context-progress-stats">
            <div>
              <span>累计 tokens</span>
              <strong>{formatUsageInteger(usageSummary.totalTokens)}</strong>
            </div>
            <div>
              <span>缓存命中</span>
              <strong>{usageSummary.cachedTokens > 0 ? `${Math.round(usageSummary.cacheHitRatio * 100)}%` : "n/a"}</strong>
            </div>
            <div>
              <span>Reasoning</span>
              <strong>{usageSummary.reasoningTokens > 0 ? formatUsageInteger(usageSummary.reasoningTokens) : "n/a"}</strong>
            </div>
          </div>
          {usageSummary.cacheInspect ? (
            <p>
              Prefix cache：{Math.round(usageSummary.cacheInspect.cacheHitRatio * 100)}%
              {usageSummary.cacheInspect.changedPrefixLayers.length > 0
                ? `，变化层 ${usageSummary.cacheInspect.changedPrefixLayers.length} 个`
                : "，前缀稳定"}
            </p>
          ) : null}
          {usageSummary.recent.length > 0 ? (
            <div className="context-progress-recent">
              {usageSummary.recent.slice(0, 1).map((item) => (
              <div key={item.id}>
                <span>最近</span>
                <strong>{formatUsageInteger(item.totalTokens)} tokens</strong>
                <small>{item.model ?? "unknown"} · cache {Math.round(item.cacheHitRatio * 100)}%</small>
              </div>
              ))}
            </div>
          ) : null}
          <button className="context-progress-open" type="button" onClick={openInspector}>
            打开上下文检查器
          </button>
        </div>
      )}
    >
      <button
        aria-label={capacity ? `上下文进度 ${percent}%` : "上下文进度"}
        className={`context-progress-trigger ${status}`}
        style={ringStyle}
        title={capacity ? `上下文 ${percent}%` : "上下文进度"}
        type="button"
      >
        <span className="context-progress-trigger-ring">
          {isRunning ? <span className="context-running-dot" aria-hidden="true" /> : <span />}
        </span>
        <span className="context-progress-trigger-text">{capacity ? `${percent}%` : "--"}</span>
      </button>
    </Popup>
  );
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

function formatCompactTokens(value: number) {
  if (value >= 1_000_000) {
    return `${Math.round(value / 1_000_000)}M`;
  }

  if (value >= 1_000) {
    return `${Math.round(value / 1_000)}K`;
  }

  return formatUsageInteger(value);
}

function historyPolicyText(capacity: NonNullable<UsageSummary["capacity"]>) {
  if (capacity.compressed) {
    return `History：已压缩 ${formatUsageInteger(capacity.omittedMessages)} 条，摘要约 ${formatUsageInteger(capacity.summaryTokens)} tokens。`;
  }

  if (capacity.truncated) {
    return `History：已裁剪 ${formatUsageInteger(capacity.omittedMessages)} 条旧消息。`;
  }

  return "History：原文保留。";
}
