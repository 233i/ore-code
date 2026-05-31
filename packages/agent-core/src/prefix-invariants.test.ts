import { describe, expect, it } from "vitest";
import { requestPrefixHash, requestPromptHash } from "./request-assembler";
import type { LlmMessage, LlmToolDefinition } from "./llm";

const tools: LlmToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file.",
      parameters: { type: "object", properties: { path: { type: "string" } } }
    }
  }
];

describe("prefix invariants", () => {
  it("does not include the dynamic tail in the cache prefix hash", () => {
    const prefixMessages: LlmMessage[] = [
      { role: "system", content: "Static system prompt." },
      { role: "system", content: "<project_context>workspace=/repo</project_context>" },
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" }
    ];

    expect(requestPrefixHash([
      ...prefixMessages,
      { role: "user", content: "current request" }
    ], tools)).toBe(requestPrefixHash([
      ...prefixMessages,
      { role: "user", content: "different current request" }
    ], [...tools].reverse()));
    expect(requestPromptHash([
      ...prefixMessages,
      { role: "user", content: "current request" }
    ], tools)).not.toBe(requestPromptHash([
      ...prefixMessages,
      { role: "user", content: "different current request" }
    ], tools));
  });

  it("changes the prefix hash when prior ledger content is rewritten", () => {
    const first: LlmMessage[] = [
      { role: "system", content: "Static system prompt." },
      { role: "system", content: "<project_context>workspace=/repo</project_context>" },
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "current request" }
    ];
    const rewritten: LlmMessage[] = [
      { role: "system", content: "Static system prompt." },
      { role: "system", content: "<project_context>workspace=/repo</project_context>" },
      { role: "user", content: "old question rewritten" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "current request" }
    ];

    expect(requestPrefixHash(first, tools)).not.toBe(requestPrefixHash(rewritten, tools));
  });
});
