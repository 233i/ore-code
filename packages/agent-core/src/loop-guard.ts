import type { ToolCall } from "@ore-code/protocol";

const IDENTICAL_CALL_BLOCK_THRESHOLD = 3;
const FAILURE_WARN_THRESHOLD = 3;
const FAILURE_HALT_THRESHOLD = 8;

export type LoopGuardAttempt =
  | { type: "proceed"; callHash: string }
  | { type: "block"; callHash: string; message: string; failureCount?: number };

export type LoopGuardOutcome =
  | { type: "continue"; failureCount: number }
  | { type: "warn"; failureCount: number; message: string }
  | { type: "halt"; failureCount: number; message: string };

export class LoopGuard {
  private readonly callCounts = new Map<string, number>();
  private readonly failureCounts = new Map<string, number>();

  recordAttempt(call: ToolCall): LoopGuardAttempt {
    const callHash = hashCall(call);
    const failureCount = this.failureCounts.get(call.name) ?? 0;
    if (failureCount >= FAILURE_HALT_THRESHOLD) {
      return {
        type: "block",
        callHash,
        failureCount,
        message: `Stop retrying ${call.name}: it has failed ${failureCount} consecutive times this turn. Choose a different approach.`
      };
    }

    const key = `${call.name}:${callHash}`;
    const count = (this.callCounts.get(key) ?? 0) + 1;
    this.callCounts.set(key, count);
    if (count >= IDENTICAL_CALL_BLOCK_THRESHOLD) {
      return {
        type: "block",
        callHash,
        message: `Blocked repeated tool call: ${call.name} has already run with the same input ${count} times this turn. Change the input or choose a different tool.`
      };
    }

    return { type: "proceed", callHash };
  }

  recordOutcome(toolName: string, ok: boolean): LoopGuardOutcome {
    if (ok) {
      this.failureCounts.set(toolName, 0);
      return { type: "continue", failureCount: 0 };
    }

    const failureCount = (this.failureCounts.get(toolName) ?? 0) + 1;
    this.failureCounts.set(toolName, failureCount);
    if (failureCount >= FAILURE_HALT_THRESHOLD) {
      return {
        type: "halt",
        failureCount,
        message: `Stop retrying ${toolName}: it has failed ${failureCount} consecutive times this turn. Choose a different approach.`
      };
    }
    if (failureCount === FAILURE_WARN_THRESHOLD) {
      return {
        type: "warn",
        failureCount,
        message: `${toolName} has failed ${failureCount} consecutive times this turn. Verify the cause before retrying.`
      };
    }

    return { type: "continue", failureCount };
  }
}

export function hashCall(call: ToolCall): string {
  return stableHash(canonicalJson(call.input));
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }

  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function stableHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}
