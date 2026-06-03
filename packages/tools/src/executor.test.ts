import { describe, expect, it } from "vitest";
import { EchoTool, ShellProbeTool, WorkspaceWriteProbeTool } from "./builtin";
import { executeRegisteredTool } from "./executor";
import { ToolRegistry } from "./registry";
import type { ToolContext, ToolSpec } from "./spec";

const registry = new ToolRegistry();
registry.register(EchoTool);
registry.register(WorkspaceWriteProbeTool);
registry.register(ShellProbeTool);
registry.register({
  name: "network_probe",
  description: "Harness-only network probe.",
  capability: "network",
  approval: "never",
  inputSchema: EchoTool.inputSchema,
  async execute(input) {
    return { callId: "network_probe", ok: true, output: input };
  }
} satisfies ToolSpec);

const baseContext: ToolContext = {
  workspacePath: "/tmp/ore-code",
  mode: "agent",
  trustedWorkspace: false
};

describe("executeRegisteredTool", () => {
  it("allows readonly tools in plan mode", async () => {
    const result = await executeRegisteredTool(
      registry,
      "echo",
      { text: "ok" },
      { ...baseContext, mode: "plan" }
    );

    expect(result.type).toBe("completed");
  });

  it("requires approval for workspace-write tools in plan mode", async () => {
    const result = await executeRegisteredTool(
      registry,
      "workspace_write_probe",
      { path: "src/App.tsx" },
      { ...baseContext, mode: "plan" }
    );

    expect(result.type).toBe("approval-required");
  });

  it("executes workspace-write tools after approval in plan mode", async () => {
    const result = await executeRegisteredTool(
      registry,
      "workspace_write_probe",
      { path: "src/App.tsx" },
      { ...baseContext, mode: "plan" },
      { callId: "workspace_write_probe", decision: "approved-once" }
    );

    expect(result.type).toBe("completed");
  });

  it("auto-runs side-effectful tools in trusted plan mode", async () => {
    const result = await executeRegisteredTool(
      registry,
      "workspace_write_probe",
      { path: "src/App.tsx" },
      { ...baseContext, mode: "plan", trustedWorkspace: true }
    );

    expect(result.type).toBe("completed");
  });

  it("allows no-approval network tools in plan mode", async () => {
    const result = await executeRegisteredTool(
      registry,
      "network_probe",
      { text: "ok" },
      { ...baseContext, mode: "plan" }
    );

    expect(result.type).toBe("completed");
  });

  it("auto-runs read-only shell tools in agent mode", async () => {
    const result = await executeRegisteredTool(
      registry,
      "shell_probe",
      { command: "pnpm test" },
      baseContext
    );

    expect(result.type).toBe("completed");
  });

  it("requires approval for mutating shell tools in agent mode", async () => {
    const result = await executeRegisteredTool(
      registry,
      "shell_probe",
      { command: "pnpm install" },
      baseContext
    );

    expect(result.type).toBe("approval-required");
  });

  it("requires approval for suggested workspace writes in agent mode", async () => {
    const result = await executeRegisteredTool(
      registry,
      "workspace_write_probe",
      { path: "src/App.tsx" },
      baseContext
    );

    expect(result.type).toBe("approval-required");
  });

  it("executes shell tools after approval in agent mode", async () => {
    const result = await executeRegisteredTool(
      registry,
      "shell_probe",
      { command: "pnpm install" },
      baseContext,
      { callId: "shell_probe", decision: "approved-once" }
    );

    expect(result.type).toBe("completed");
  });

  it("executes tools with edited approval input", async () => {
    const result = await executeRegisteredTool(
      registry,
      "shell_probe",
      { command: "pnpm install" },
      baseContext,
      { callId: "shell_probe", decision: "edited", editedInput: { command: "pnpm test" } }
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.output).toMatchObject({ command: "pnpm test" });
    }
  });

  it("auto-runs side-effectful tools in yolo mode without workspace trust checks", async () => {
    const result = await executeRegisteredTool(
      registry,
      "workspace_write_probe",
      { path: "src/App.tsx" },
      { ...baseContext, mode: "yolo", trustedWorkspace: false }
    );

    expect(result.type).toBe("completed");
  });

  it("auto-runs side-effectful tools in yolo mode when workspace is trusted", async () => {
    const result = await executeRegisteredTool(
      registry,
      "workspace_write_probe",
      { path: "src/App.tsx" },
      { ...baseContext, mode: "yolo", trustedWorkspace: true }
    );

    expect(result.type).toBe("completed");
  });

  it("auto-runs high-risk shell commands in trusted yolo mode", async () => {
    const result = await executeRegisteredTool(
      registry,
      "shell_probe",
      { command: "git reset --hard HEAD" },
      { ...baseContext, mode: "yolo", trustedWorkspace: true }
    );

    expect(result.type).toBe("completed");
  });
});
