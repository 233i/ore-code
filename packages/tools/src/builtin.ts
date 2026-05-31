import { z } from "zod";
import type { ToolSpec } from "./spec";

export const EchoTool: ToolSpec<{ text: string }, { text: string }> = {
  name: "echo",
  description: "Harness-only echo tool used to validate the tool pipeline.",
  capability: "readonly",
  approval: "never",
  inputSchema: z.object({ text: z.string() }),
  async execute(input) {
    return {
      callId: "echo",
      ok: true,
      output: input
    };
  }
};

export const WorkspaceWriteProbeTool: ToolSpec<{ path: string }, { path: string }> = {
  name: "workspace_write_probe",
  description: "Harness-only workspace-write probe used to validate approval policy.",
  capability: "workspace-write",
  approval: "suggest",
  inputSchema: z.object({ path: z.string().min(1) }),
  async execute(input) {
    return {
      callId: "workspace_write_probe",
      ok: true,
      output: input
    };
  }
};

export const ShellProbeTool: ToolSpec<{ command: string }, { command: string }> = {
  name: "shell_probe",
  description: "Harness-only shell probe used to validate shell approval policy.",
  capability: "shell",
  approval: "required",
  inputSchema: z.object({ command: z.string().min(1) }),
  async execute(input) {
    return {
      callId: "shell_probe",
      ok: true,
      output: input
    };
  }
};
