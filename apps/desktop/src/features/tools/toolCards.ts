import type { RuntimeEvent, ToolCall, ToolResult } from "@seekforge/protocol";

export type ToolCardStatus = "requested" | "approval" | "running" | "completed" | "failed";

export interface ToolCardState {
  id: string;
  turnId: string;
  callId: string;
  name: string;
  status: ToolCardStatus;
  input?: unknown;
  result?: ToolResult;
  approvalDecision?: string;
  commandOutput?: ToolCommandOutput;
}

export interface ToolCommandOutput {
  stdout: string;
  stderr: string;
  truncated: boolean;
}

const MAX_COMMAND_OUTPUT_CHARS_PER_STREAM = 12000;

export function deriveToolCards(events: RuntimeEvent[]): ToolCardState[] {
  const cards = new Map<string, ToolCardState>();

  for (const event of events) {
    if (event.type === "tool_call_requested") {
      upsertCall(cards, event.turnId, event.call, "requested");
    }

    if (event.type === "approval_requested") {
      upsertCall(cards, event.turnId, event.call, "approval");
    }

    if (event.type === "approval_decided") {
      const card = cards.get(cardId(event.turnId, event.decision.callId));
      if (card) {
        card.approvalDecision = event.decision.decision;
      }
    }

    if (event.type === "tool_started") {
      upsertCall(cards, event.turnId, event.call, "running");
    }

    if (event.type === "command_output_delta") {
      appendCommandOutput(cards, event.turnId, event.callId, event.stream, event.text);
    }

    if (event.type === "tool_completed" || event.type === "tool_failed") {
      const id = cardId(event.turnId, event.result.callId);
      const existing = cards.get(id);
      cards.set(id, {
        id,
        turnId: event.turnId,
        callId: event.result.callId,
        name: existing?.name ?? event.result.callId,
        input: existing?.input,
        approvalDecision: existing?.approvalDecision,
        ...(existing?.commandOutput ? { commandOutput: existing.commandOutput } : {}),
        status: toolResultStatus(event.result, event.type),
        result: event.result
      });
    }
  }

  return [...cards.values()];
}

function upsertCall(cards: Map<string, ToolCardState>, turnId: string, call: ToolCall, status: ToolCardStatus) {
  const id = cardId(turnId, call.id);
  const existing = cards.get(id);
  cards.set(id, {
    id,
    turnId,
    callId: call.id,
    name: call.name,
    input: call.input,
    approvalDecision: existing?.approvalDecision,
    ...(existing?.commandOutput ? { commandOutput: existing.commandOutput } : {}),
    result: existing?.result,
    status
  });
}

function appendCommandOutput(
  cards: Map<string, ToolCardState>,
  turnId: string,
  callId: string,
  stream: "stdout" | "stderr",
  text: string
) {
  const id = cardId(turnId, callId);
  const existing = cards.get(id);
  const currentOutput = existing?.commandOutput ?? { stdout: "", stderr: "", truncated: false };
  const nextStream = trimCommandOutputTail(currentOutput[stream] + text);

  cards.set(id, {
    id,
    turnId,
    callId,
    name: existing?.name ?? callId,
    input: existing?.input,
    approvalDecision: existing?.approvalDecision,
    commandOutput: {
      ...currentOutput,
      [stream]: nextStream.text,
      truncated: currentOutput.truncated || nextStream.truncated
    },
    result: existing?.result,
    status: existing?.status ?? "running"
  });
}

function trimCommandOutputTail(text: string) {
  if (text.length <= MAX_COMMAND_OUTPUT_CHARS_PER_STREAM) {
    return { text, truncated: false };
  }

  return {
    text: text.slice(text.length - MAX_COMMAND_OUTPUT_CHARS_PER_STREAM),
    truncated: true
  };
}

function cardId(turnId: string, callId: string) {
  return `${turnId}:${callId}`;
}

function toolResultStatus(result: ToolResult, eventType: "tool_completed" | "tool_failed"): ToolCardStatus {
  if (eventType === "tool_failed" || result.error || !result.ok || shellOutputFailed(result.output)) {
    return "failed";
  }

  return "completed";
}

function shellOutputFailed(output: unknown) {
  if (!output || typeof output !== "object") {
    return false;
  }

  const record = output as Record<string, unknown>;
  const exitCode = typeof record.exitCode === "number" ? record.exitCode : null;
  return record.timedOut === true || (exitCode !== null && exitCode !== 0);
}
