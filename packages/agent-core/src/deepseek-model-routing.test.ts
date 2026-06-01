import { describe, expect, it } from "vitest";
import type { RuntimeEvent } from "@ore-code/protocol";
import {
  DEEPSEEK_V4_FLASH_MODEL,
  DEEPSEEK_V4_PRO_MODEL,
  normalizeDeepSeekModelMode,
  resolveDeepSeekTurnModel
} from "./deepseek-model-routing";

describe("DeepSeek model routing", () => {
  it("defaults invalid values to auto and accepts model-name aliases", () => {
    expect(normalizeDeepSeekModelMode(undefined)).toBe("auto");
    expect(normalizeDeepSeekModelMode("deepseek-v4-pro")).toBe("pro");
    expect(normalizeDeepSeekModelMode("deepseek-v4-flash")).toBe("flash");
    expect(normalizeDeepSeekModelMode("unknown")).toBe("auto");
  });

  it("routes light read-only prompts to Flash in auto mode", () => {
    for (const prompt of ["解释这段代码", "总结项目结构", "搜索文件", "git status", "列出 MCP 工具"]) {
      expect(resolveDeepSeekTurnModel({
        classifier: readonlyClassifier(),
        modelMode: "auto",
        prompt
      })).toMatchObject({
        mode: "auto",
        route: "flash_readonly",
        toolProfile: "readonly",
        resolvedModel: DEEPSEEK_V4_FLASH_MODEL,
        reason: "classifier_readonly"
      });
    }
  });

  it("requires the Flash classifier before routing ambiguous auto prompts", () => {
    expect(resolveDeepSeekTurnModel({ modelMode: "auto", prompt: "解释这段代码" })).toMatchObject({
      mode: "auto",
      route: "pro_agent",
      resolvedModel: DEEPSEEK_V4_PRO_MODEL,
      reason: "classifier_required",
      requiresClassifier: true
    });
  });

  it("answers local time, date, and acknowledgement prompts without a model", () => {
    const recentEvents = [runtimeEvent({ type: "file_changed", path: "src/App.tsx", changeKind: "updated" })];
    const now = new Date("2026-05-28T15:04:00.000Z");

    expect(resolveDeepSeekTurnModel({
      modelMode: "auto",
      now,
      prompt: "现在几点",
      recentEvents,
      timeZone: "Asia/Shanghai"
    })).toMatchObject({
      mode: "auto",
      route: "local",
      toolProfile: "none",
      reason: "local_time",
      localResponse: "现在是 23:04。"
    });
    expect(resolveDeepSeekTurnModel({
      modelMode: "auto",
      now,
      prompt: "现在几点",
      recentEvents,
      timeZone: "Asia/Shanghai"
    }).resolvedModel).toBeUndefined();

    expect(resolveDeepSeekTurnModel({
      modelMode: "auto",
      now,
      prompt: "今天几号",
      recentEvents,
      timeZone: "Asia/Shanghai"
    })).toMatchObject({
      route: "local",
      reason: "local_date",
      localResponse: "今天是 2026年5月28日星期四。"
    });

    expect(resolveDeepSeekTurnModel({ modelMode: "auto", prompt: "好的", recentEvents })).toMatchObject({
      route: "local",
      reason: "local_ack",
      localResponse: "收到。"
    });
  });

  it("does not use local responses for manual modes or attachments", () => {
    expect(resolveDeepSeekTurnModel({ modelMode: "flash", prompt: "现在几点" })).toMatchObject({
      mode: "flash",
      resolvedModel: DEEPSEEK_V4_FLASH_MODEL,
      reason: "manual_flash"
    });

    expect(resolveDeepSeekTurnModel({ modelMode: "auto", prompt: "现在几点", hasAttachments: true })).toMatchObject({
      mode: "auto",
      resolvedModel: DEEPSEEK_V4_PRO_MODEL,
      reason: "attachment_context"
    });
  });

  it("routes recent failure continuations to Pro but keeps read-only follow-ups on Flash", () => {
    const recentEvents = [
      runtimeEvent({ type: "tool_failed", result: { callId: "1", ok: false, error: { code: "failed", message: "failed" } } })
    ];

    expect(resolveDeepSeekTurnModel({ modelMode: "auto", prompt: "继续", recentEvents })).toMatchObject({
      resolvedModel: DEEPSEEK_V4_PRO_MODEL,
      reason: "recent_failure_continuation"
    });

    expect(resolveDeepSeekTurnModel({ modelMode: "auto", prompt: "解释这个错误", recentEvents })).toMatchObject({
      resolvedModel: DEEPSEEK_V4_PRO_MODEL,
      reason: "classifier_required",
      requiresClassifier: true
    });
  });

  it("routes classifier side-effect prompts to Pro in auto mode", () => {
    expect(resolveDeepSeekTurnModel({
      classifier: sideEffectClassifier(),
      modelMode: "auto",
      prompt: "这个任务需要动代码"
    })).toMatchObject({
      mode: "auto",
      route: "pro_agent",
      toolProfile: "full",
      resolvedModel: DEEPSEEK_V4_PRO_MODEL,
      reason: "classifier_side_effect"
    });
  });

  it("routes explicit side-effect prompts to Pro without requiring the classifier", () => {
    for (const prompt of ["修复 bug", "修改文件", "运行测试", "添加 MCP", "重构 App.tsx", "创建自动化", "mcp call tdesign"]) {
      expect(resolveDeepSeekTurnModel({
        modelMode: "auto",
        prompt
      })).toMatchObject({
        mode: "auto",
        route: "pro_agent",
        toolProfile: "full",
        resolvedModel: DEEPSEEK_V4_PRO_MODEL,
        reason: "explicit_pro_intent"
      });
    }
  });

  it("does not let trivial acknowledgements hide side-effect intent", () => {
    expect(resolveDeepSeekTurnModel({
      classifier: sideEffectClassifier(),
      modelMode: "auto",
      prompt: "好的，修改这个文件"
    })).toMatchObject({
      resolvedModel: DEEPSEEK_V4_PRO_MODEL,
      reason: "explicit_pro_intent"
    });

    expect(resolveDeepSeekTurnModel({ modelMode: "auto", prompt: "现在几点，顺便修改文件" })).toMatchObject({
      resolvedModel: DEEPSEEK_V4_PRO_MODEL,
      reason: "explicit_pro_intent"
    });
  });

  it("keeps uncertain or unavailable classifier results on Pro", () => {
    expect(resolveDeepSeekTurnModel({ classifier: null, modelMode: "auto", prompt: "看看这里" })).toMatchObject({
      resolvedModel: DEEPSEEK_V4_PRO_MODEL,
      reason: "classifier_unavailable"
    });

    expect(resolveDeepSeekTurnModel({
      classifier: { confidence: 0.5, intent: "readonly", sideEffectRisk: "none" },
      modelMode: "auto",
      prompt: "看看这里"
    })).toMatchObject({
      resolvedModel: DEEPSEEK_V4_PRO_MODEL,
      reason: "classifier_uncertain"
    });

    expect(resolveDeepSeekTurnModel({
      classifier: { confidence: 0.9, intent: "readonly", sideEffectRisk: "possible" },
      modelMode: "auto",
      prompt: "看看这里"
    })).toMatchObject({
      resolvedModel: DEEPSEEK_V4_PRO_MODEL,
      reason: "classifier_possible_side_effect"
    });
  });

  it("lets manual modes override auto routing", () => {
    expect(resolveDeepSeekTurnModel({ modelMode: "flash", prompt: "修复 bug" })).toMatchObject({
      resolvedModel: DEEPSEEK_V4_FLASH_MODEL,
      reason: "manual_flash"
    });
    expect(resolveDeepSeekTurnModel({ modelMode: "pro", prompt: "总结项目结构" })).toMatchObject({
      resolvedModel: DEEPSEEK_V4_PRO_MODEL,
      reason: "manual_pro"
    });
  });

  it("uses Pro after recent failures, edits, or large context", () => {
    expect(resolveDeepSeekTurnModel({
      modelMode: "auto",
      prompt: "继续",
      recentEvents: [runtimeEvent({ type: "file_changed", path: "src/App.tsx", changeKind: "updated" })]
    })).toMatchObject({ resolvedModel: DEEPSEEK_V4_PRO_MODEL, reason: "recent_edit_continuation" });

    expect(resolveDeepSeekTurnModel({
      modelMode: "auto",
      prompt: "总结",
      contextTextChars: 130_000
    })).toMatchObject({ resolvedModel: DEEPSEEK_V4_PRO_MODEL, reason: "large_context" });
  });
});

function readonlyClassifier() {
  return {
    confidence: 0.92,
    intent: "readonly" as const,
    reason: "read-only inspection",
    sideEffectRisk: "none" as const
  };
}

function sideEffectClassifier() {
  return {
    confidence: 0.92,
    intent: "side_effect" as const,
    reason: "requires mutation",
    sideEffectRisk: "required" as const
  };
}

function runtimeEvent(event: Partial<RuntimeEvent> & Pick<RuntimeEvent, "type">): RuntimeEvent {
  return {
    id: crypto.randomUUID(),
    seq: 0,
    threadId: "thread-1",
    turnId: "turn-1",
    createdAt: new Date().toISOString(),
    ...event
  } as RuntimeEvent;
}
