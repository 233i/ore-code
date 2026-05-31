import type { ToolResult } from "@seekforge/protocol";

export function serializeToolResultForModel(result: ToolResult): string {
  const failure = toolResultFailure(result);
  if (!failure) {
    return JSON.stringify(result);
  }

  return JSON.stringify({
    ...result,
    modelStatus: "failed",
    modelInstruction: `${failure}. Treat this tool result as a failed command. Fix the issue if it is actionable, or explain the failure clearly to the user. Do not summarize it as a successful run.`
  });
}

function toolResultFailure(result: ToolResult): string | null {
  if (result.error) {
    return `Tool failed: ${result.error.message}`;
  }

  if (!result.ok) {
    return "Tool reported ok=false";
  }

  return shellOutputFailure(result.output);
}

function shellOutputFailure(output: unknown): string | null {
  if (!output || typeof output !== "object") {
    return null;
  }

  const record = output as Record<string, unknown>;
  if (record.timedOut === true) {
    return "Shell command timed out";
  }

  const exitCode = typeof record.exitCode === "number" ? record.exitCode : null;
  if (exitCode !== null && exitCode !== 0) {
    return `Shell command exited with non-zero status ${exitCode}`;
  }

  return null;
}
