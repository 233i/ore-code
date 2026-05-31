import { describe, expect, it } from "vitest";
import { MockLlmClient, type LlmClient, type LlmTurnInput, type ModelStreamChunk } from "@seekforge/agent-core";
import { ToolRegistry } from "@seekforge/tools";
import {
  formatDeepSeekProOrchestrationContext,
  parseDeepSeekExplorationPlan,
  runDeepSeekProOrchestratedExploration,
  shouldUseDeepSeekProOrchestration
} from "./deepSeekProOrchestrator";

describe("deepSeekProOrchestrator", () => {
  it("parses and caps Pro exploration plans", () => {
    const plan = parseDeepSeekExplorationPlan(JSON.stringify({
      strategy: "inspect independently",
      prompts: Array.from({ length: 8 }, (_, index) => ({
        title: `probe-${index}`,
        prompt: `inspect area ${index}`
      }))
    }));

    expect(plan.strategy).toBe("inspect independently");
    expect(plan.prompts).toHaveLength(4);
    expect(plan.prompts[0]).toEqual({ title: "probe-0", prompt: "inspect area 0" });
  });

  it("returns an empty plan for malformed planner output", () => {
    expect(parseDeepSeekExplorationPlan("no json")).toEqual({ strategy: "", prompts: [] });
  });

  it("uses orchestration only for complex Pro work", () => {
    expect(shouldUseDeepSeekProOrchestration({
      prompt: "修改变量名",
      routingReason: "explicit_pro_intent"
    })).toBe(false);

    expect(shouldUseDeepSeekProOrchestration({
      prompt: "系统性排查自动模型路由为什么总是走 Pro，并给出修复方案",
      routingReason: "classifier_side_effect"
    })).toBe(true);

    expect(shouldUseDeepSeekProOrchestration({
      contextTextChars: 13_000,
      prompt: "修复这个问题",
      routingReason: "explicit_pro_intent"
    })).toBe(true);

    expect(shouldUseDeepSeekProOrchestration({
      prompt: "总结超大上下文",
      routingReason: "large_context"
    })).toBe(false);
  });

  it("runs Pro planning then Flash parallel exploration", async () => {
    const calls: Array<{ modelOverride?: string; reason: string }> = [];
    const childInputs: LlmTurnInput[] = [];

    const result = await runDeepSeekProOrchestratedExploration({
      createConfiguredProviderClient: async (reason, options) => {
        calls.push({ reason, modelOverride: options?.modelOverride });
        if (options?.modelOverride === "deepseek-v4-pro") {
          return new MockLlmClient([
            {
              type: "assistant_delta",
              text: JSON.stringify({
                strategy: "split read-only discovery",
                prompts: [
                  { title: "hooks", prompt: "inspect hooks evidence" },
                  { title: "tests", prompt: "inspect tests evidence" }
                ]
              })
            },
            { type: "done" }
          ]);
        }
        return new StaticChildClient(childInputs);
      },
      readonlyRegistry: new ToolRegistry(),
      toolContext: { mode: "agent", trustedWorkspace: false, workspacePath: "/workspace" },
      userPrompt: "修复模型路由"
    });

    expect(result?.plan.prompts.map((item) => item.title)).toEqual(["hooks", "tests"]);
    expect(result?.rlm).toMatchObject({
      childModel: "deepseek-v4-flash",
      promptCount: 2,
      okCount: 2
    });
    expect(result?.contextBlock).toContain("<pro_orchestrated_exploration>");
    expect(result?.contextBlock).toContain("child answer: inspect hooks evidence");
    expect(calls.map((call) => call.modelOverride)).toEqual([
      "deepseek-v4-pro",
      "deepseek-v4-flash",
      "deepseek-v4-flash"
    ]);
    expect(childInputs).toHaveLength(2);
  });

  it("formats failed Flash probes without dropping successful evidence", () => {
    const context = formatDeepSeekProOrchestrationContext({
      strategy: "check two areas",
      prompts: [
        { title: "ok area", prompt: "inspect ok" },
        { title: "bad area", prompt: "inspect bad" }
      ]
    }, {
      childModel: "deepseek-v4-flash",
      durationMs: 10,
      failedCount: 1,
      okCount: 1,
      promptCount: 2,
      results: [
        { durationMs: 1, index: 0, ok: true, promptPreview: "inspect ok", text: "found evidence" },
        { durationMs: 1, error: "failed", index: 1, ok: false, promptPreview: "inspect bad", text: "" }
      ],
      totalCostCny: 0,
      totalCostUsd: 0
    });

    expect(context).toContain("ok area: ok");
    expect(context).toContain("found evidence");
    expect(context).toContain("bad area: failed");
    expect(context).toContain("error: failed");
  });
});

class StaticChildClient implements LlmClient {
  constructor(private readonly inputs: LlmTurnInput[]) {}

  async *streamTurn(input: LlmTurnInput): AsyncIterable<ModelStreamChunk> {
    this.inputs.push(input);
    const userMessages = input.messages.filter((message) => message.role === "user");
    const user = userMessages[userMessages.length - 1]?.content ?? "";
    yield { type: "assistant_delta", text: `child answer: ${user}` };
    yield { type: "done" };
  }
}
