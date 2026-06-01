import type { LlmClient, ModelFinishReason } from "./llm";

export interface ProviderSmokeResult {
  ok: boolean;
  text: string;
  finishReason?: ModelFinishReason;
  durationMs: number;
}

export async function runProviderSmokeTest(client: LlmClient): Promise<ProviderSmokeResult> {
  const startedAt = Date.now();
  let text = "";
  let finishReason: ModelFinishReason | undefined;

  for await (const chunk of client.streamTurn({
    threadId: `provider-smoke-${crypto.randomUUID()}`,
    turnId: `turn-${crypto.randomUUID()}`,
    messages: [
      {
        role: "system",
        content: "You are a provider connectivity checker. Reply with one short sentence."
      },
      {
        role: "user",
        content: "Reply exactly with: Ore Code provider check OK"
      }
    ]
  })) {
    if (chunk.type === "assistant_delta" || chunk.type === "reasoning_delta") {
      text += chunk.text;
    }

    if (chunk.type === "done") {
      finishReason = chunk.finishReason;
      if (chunk.finalText) {
        text += chunk.finalText;
      }
    }
  }

  return {
    ok: true,
    text: text.trim(),
    finishReason,
    durationMs: Date.now() - startedAt
  };
}
