import { describe, expect, it } from "vitest";
import { MockLlmClient } from "./llm";
import { runProviderSmokeTest } from "./provider-smoke";

describe("runProviderSmokeTest", () => {
  it("collects streamed provider output", async () => {
    const result = await runProviderSmokeTest(
      new MockLlmClient([
        { type: "assistant_delta", text: "Ore Code " },
        { type: "assistant_delta", text: "provider check OK" },
        { type: "done", finishReason: "stop" }
      ])
    );

    expect(result).toMatchObject({
      ok: true,
      text: "Ore Code provider check OK",
      finishReason: "stop"
    });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("propagates provider failures", async () => {
    const client = {
      async *streamTurn() {
        throw new Error("provider unavailable");
      }
    };

    await expect(runProviderSmokeTest(client)).rejects.toThrow("provider unavailable");
  });
});
