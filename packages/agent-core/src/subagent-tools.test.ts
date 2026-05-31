import { describe, expect, it } from "vitest";
import { EchoTool, ToolRegistry } from "@seekforge/tools";
import { createSubagentTools, SubagentManager } from "./subagent-tools";
import { createCodingSystemPrompt } from "./prompts";
import type { LlmClient, LlmTurnInput, ModelStreamChunk } from "./llm";

describe("SubagentManager tools", () => {
  it("spawns and waits for a child agent turn", async () => {
    const manager = new SubagentManager({
      async createClient() {
        return new EchoChildClient();
      },
      createRegistry() {
        const registry = new ToolRegistry();
        registry.register(EchoTool);
        return registry;
      }
    });
    const [spawnTool, waitTool] = createSubagentTools(manager);

    const spawned = await spawnTool.execute(
      { prompt: "inspect auth flow", name: "auth" },
      { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
    );
    const agentId = (spawned.output as { id: string }).id;
    const waited = await waitTool.execute(
      { agentId, timeoutMs: 1000 },
      { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
    );

    expect(spawned.output).toMatchObject({ name: "auth", status: "running" });
    expect(waited.output).toMatchObject({
      name: "auth",
      status: "completed",
      output: "child done: inspect auth flow",
      turnCount: 1
    });
  });

  it("continues a completed agent with send_input", async () => {
    const inputs: LlmTurnInput[] = [];
    const manager = new SubagentManager({
      async createClient() {
        return new CapturingChildClient(inputs);
      },
      createRegistry() {
        return new ToolRegistry();
      }
    });
    const [spawnTool, waitTool, sendTool] = createSubagentTools(manager);

    const spawned = await spawnTool.execute(
      { prompt: "first" },
      { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
    );
    const agentId = (spawned.output as { id: string }).id;
    await waitTool.execute(
      { agentId, timeoutMs: 1000 },
      { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
    );
    await sendTool.execute(
      { agentId, prompt: "second" },
      { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
    );
    const waited = await waitTool.execute(
      { agentId, timeoutMs: 1000 },
      { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
    );

    expect(waited.output).toMatchObject({
      status: "completed",
      turnCount: 2
    });
    expect(inputs[1].messages.filter((message) => message.role !== "system").map((message) => message.content)).toEqual([
      "first",
      "child done: first",
      "second"
    ]);
  });

  it("passes the strengthened output contract to child agent turns", async () => {
    const inputs: LlmTurnInput[] = [];
    const manager = new SubagentManager({
      async createClient() {
        return new CapturingChildClient(inputs);
      },
      createRegistry() {
        return new ToolRegistry();
      },
      systemPrompt: (context) => createCodingSystemPrompt({
        workspacePath: context.workspacePath,
        mode: context.mode
      })
    });
    const [spawnTool, waitTool] = createSubagentTools(manager);

    const spawned = await spawnTool.execute(
      { prompt: "inspect auth flow", name: "auth" },
      { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
    );
    const agentId = (spawned.output as { id: string }).id;
    await waitTool.execute(
      { agentId, timeoutMs: 1000 },
      { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
    );

    const systemPrompt = inputs[0]?.messages.find((message) => message.role === "system")?.content ?? "";
    expect(systemPrompt).toContain("Sub-agent output contract:");
    expect(systemPrompt).toContain("SUMMARY, EVIDENCE, CHANGES, RISKS, and BLOCKERS");
    expect(systemPrompt).toContain("EVIDENCE lists only concrete files, commands, tool results, line references, or artifact ids you actually observed");
    expect(systemPrompt).toContain("After the structured report, stop");
    expect(systemPrompt).toContain("Never claim a file was read, a command was executed, a write was made, or validation passed unless the tool log confirms it");
    expect(systemPrompt).toContain("You are running as sub-agent");
    expect(systemPrompt).toContain("Role policy: general helper");
  });

  it("supports finite roles and injects role-specific prompts", async () => {
    const inputs: LlmTurnInput[] = [];
    const manager = new SubagentManager({
      async createClient() {
        return new CapturingChildClient(inputs);
      },
      createRegistry() {
        return new ToolRegistry();
      },
      systemPrompt: (context) => createCodingSystemPrompt({
        workspacePath: context.workspacePath,
        mode: context.mode
      })
    });
    const [spawnTool, waitTool] = createSubagentTools(manager);

    const spawned = await spawnTool.execute(
      { prompt: "review auth diff", name: "auth-review", role: "reviewer" },
      { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
    );
    const agentId = (spawned.output as { id: string }).id;
    await waitTool.execute(
      { agentId, timeoutMs: 1000 },
      { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
    );

    expect(spawned.output).toMatchObject({ role: "reviewer", maxConcurrent: 4 });
    const systemPrompt = inputs[0]?.messages.find((message) => message.role === "system")?.content ?? "";
    expect(systemPrompt).toContain("Role policy: reviewer");
    expect(systemPrompt).toContain("Review only; do not edit files");
  });

  it("passes model preference through model resolution and snapshots", async () => {
    const modelSeenByClient: Array<string | undefined> = [];
    const manager = new SubagentManager({
      async createClient(_context, agent) {
        modelSeenByClient.push(agent.model);
        return new EchoChildClient();
      },
      createRegistry() {
        return new ToolRegistry();
      },
      model: (_context, agent) => agent.modelPreference === "pro" ? "deepseek-v4-pro" : "deepseek-v4-flash"
    });
    const [spawnTool, waitTool] = createSubagentTools(manager);

    const spawned = await spawnTool.execute(
      { prompt: "implement bounded fix", role: "worker", modelPreference: "pro" },
      { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
    );
    const agentId = (spawned.output as { id: string }).id;
    const waited = await waitTool.execute(
      { agentId, timeoutMs: 1000 },
      { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
    );

    expect(modelSeenByClient).toEqual(["deepseek-v4-pro"]);
    expect(waited.output).toMatchObject({
      role: "worker",
      model: "deepseek-v4-pro",
      modelPreference: "pro",
      activeCount: 0,
      maxConcurrent: 4
    });
  });

  it("rejects unknown subagent roles", async () => {
    const manager = new SubagentManager({
      async createClient() {
        return new EchoChildClient();
      },
      createRegistry() {
        return new ToolRegistry();
      }
    });
    const [spawnTool] = createSubagentTools(manager);

    await expect(spawnTool.execute(
      { prompt: "inspect", role: "architect" },
      { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
    )).rejects.toThrow();
  });

  it("emits a parent runtime event when a child agent completes", async () => {
    const runtimeEvents: Array<{ type: string; [key: string]: unknown }> = [];
    const manager = new SubagentManager({
      async createClient() {
        return new EchoChildClient();
      },
      createRegistry() {
        return new ToolRegistry();
      }
    });
    const [spawnTool, waitTool] = createSubagentTools(manager);

    const spawned = await spawnTool.execute(
      { prompt: "inspect auth flow", name: "auth" },
      {
        workspacePath: "/workspace",
        mode: "agent",
        trustedWorkspace: false,
        onRuntimeEvent: (event) => runtimeEvents.push(event)
      }
    );
    const agentId = (spawned.output as { id: string }).id;
    await waitTool.execute(
      { agentId, timeoutMs: 1000 },
      { workspacePath: "/workspace", mode: "agent", trustedWorkspace: false }
    );

    expect(runtimeEvents).toEqual([
      expect.objectContaining({
        type: "subagent_completed",
        agentId,
        name: "auth",
        role: "general",
        status: "completed",
        summary: "child done: inspect auth flow",
        eventCount: expect.any(Number)
      })
    ]);
  });
});

class EchoChildClient implements LlmClient {
  async *streamTurn(input: LlmTurnInput): AsyncIterable<ModelStreamChunk> {
    const prompt = input.messages[input.messages.length - 1]?.content ?? "";
    yield { type: "assistant_delta", text: `child done: ${prompt}` };
    yield { type: "done" };
  }
}

class CapturingChildClient implements LlmClient {
  constructor(private readonly inputs: LlmTurnInput[]) {}

  async *streamTurn(input: LlmTurnInput): AsyncIterable<ModelStreamChunk> {
    this.inputs.push(input);
    const prompt = input.messages[input.messages.length - 1]?.content ?? "";
    yield { type: "assistant_delta", text: `child done: ${prompt}` };
    yield { type: "done" };
  }
}
