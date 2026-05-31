import type { ToolCardState } from "../toolCards";
import { numberValue, statusVerb, stringValue } from "./summaryUtils";

export function getStructuredReviewSummary(card: ToolCardState) {
  const input = card.input as Record<string, unknown> | undefined;
  const output = card.result?.output as Record<string, unknown> | undefined;
  const scope = stringValue(output?.scope) || stringValue(input?.scope) || "workspace";
  const source = stringValue(output?.source) || stringValue(input?.path) || scope;

  if (card.result?.error) {
    return card.result.error.message;
  }

  const counts = output?.findingCounts as Record<string, unknown> | undefined;
  const critical = numberValue(counts?.critical) ?? 0;
  const warning = numberValue(counts?.warning) ?? 0;
  const info = numberValue(counts?.info) ?? 0;
  if (card.result?.ok && output) {
    return `评审完成：${source}（${critical} 严重 / ${warning} 警告 / ${info} 提示）`;
  }

  return `${statusVerb(card, "结构化评审")}：${source}`;
}

export function getValidateDataSummary(card: ToolCardState) {
  const input = card.input as Record<string, unknown> | undefined;
  const output = card.result?.output as Record<string, unknown> | undefined;
  const format = stringValue(output?.format) || stringValue(input?.format) || "data";
  const target = stringValue(output?.path) || stringValue(input?.path) || "inline content";

  if (card.result?.error) {
    return card.result.error.message;
  }

  if (output?.valid === true) {
    return `数据校验通过：${target}（${format}）`;
  }
  if (output?.valid === false) {
    const errors = Array.isArray(output.errors) ? output.errors.length : 0;
    return `数据校验失败：${target}（${format}，${errors} 个错误）`;
  }

  return `${statusVerb(card, "校验数据")}：${target}`;
}

export function getCodeExecutionSummary(card: ToolCardState) {
  const output = card.result?.output as Record<string, unknown> | undefined;
  if (output?.passed === true) {
    const duration = numberValue(output.durationMs);
    return duration === null ? "代码执行完成" : `代码执行完成（${duration}ms）`;
  }
  if (output?.passed === false) {
    const exitCode = typeof output.exitCode === "number" ? output.exitCode : null;
    return output.timedOut === true
      ? "代码执行超时"
      : exitCode === null ? "代码执行失败" : `代码执行失败（exit ${exitCode}）`;
  }
  return `${statusVerb(card, "执行代码")}`;
}

export function getToolSearchSummary(card: ToolCardState) {
  const input = card.input as Record<string, unknown> | undefined;
  const output = card.result?.output as Record<string, unknown> | undefined;
  const query = stringValue(output?.query) || stringValue(input?.query) || "全部工具";
  const results = Array.isArray(output?.results) ? output.results.length : null;
  return results === null ? `${statusVerb(card, "搜索工具")}：${query}` : `工具搜索完成：${query}（${results} 项）`;
}

export function getLspSummary(card: ToolCardState) {
  const input = card.input as Record<string, unknown> | undefined;
  const output = card.result?.output as Record<string, unknown> | undefined;
  const symbol = stringValue(output?.symbol) || stringValue(input?.symbol);
  const path = stringValue(output?.path) || stringValue(input?.path);
  const locations = Array.isArray(output?.locations) ? output.locations.length : null;
  const symbols = Array.isArray(output?.symbols) ? output.symbols.length : null;

  if (card.name === "lsp_document_symbols") {
    return symbols === null
      ? `${statusVerb(card, "读取文档符号")}：${path || "文件"}`
      : `文档符号完成：${path || "文件"}（${symbols} 项）`;
  }
  if (card.name === "lsp_hover") {
    return symbol ? `符号信息：${symbol}` : `${statusVerb(card, "查看符号")}：${path || "位置"}`;
  }
  const action = card.name === "lsp_definition" ? "查找定义" : "查找引用";
  return locations === null
    ? `${statusVerb(card, action)}：${symbol || path || "符号"}`
    : `${action}完成：${symbol || "符号"}（${locations} 处）`;
}

export function getRunTestsSummary(card: ToolCardState) {
  const input = card.input as Record<string, unknown> | undefined;
  const output = card.result?.output as Record<string, unknown> | undefined;
  const target = stringValue(output?.target) || stringValue(input?.target) || "auto";
  const command = stringValue(output?.command) || stringValue(input?.command);
  const suffix = command ? `：${command}` : `：${target}`;

  if (output?.passed === true) {
    const duration = numberValue(output.durationMs);
    return duration === null ? `测试通过${suffix}` : `测试通过${suffix}（${duration}ms）`;
  }
  if (output?.passed === false) {
    const exitCode = typeof output.exitCode === "number" ? output.exitCode : null;
    const timedOut = output.timedOut === true;
    return timedOut
      ? `测试超时${suffix}`
      : exitCode === null ? `测试失败${suffix}` : `测试失败${suffix}（exit ${exitCode}）`;
  }

  return `${statusVerb(card, "运行测试")}${suffix}`;
}
