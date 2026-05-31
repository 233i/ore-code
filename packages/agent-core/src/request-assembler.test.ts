import { describe, expect, it } from "vitest";
import {
  assembleRequest,
  assertAppendOnlyRequestPrefix,
  assertStableRequestPrefixSegments,
  checkAppendOnlyRequestPrefix,
  checkStableRequestPrefixSegments,
  diffRequestSegments,
  requestPrefixHash
} from "./request-assembler";
import type { LlmMessage, LlmToolDefinition } from "./llm";

const tools: LlmToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Write a file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" },
          content: { type: "string" }
        }
      }
    }
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a file.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string" }
        }
      }
    }
  }
];

describe("request assembler", () => {
  it("builds a canonical DeepSeek request with stable segment hashes", () => {
    const history: LlmMessage[] = [
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" }
    ];
    const first = assembleRequest({
      systemPrompt: "  Static system prompt.  ",
      projectContext: "<project_context>workspace=/repo</project_context>",
      history,
      userText: "current request",
      tools
    });
    const samePrefix = assembleRequest({
      systemPrompt: "Static system prompt.",
      projectContext: "<project_context>workspace=/repo</project_context>",
      history,
      userText: "different current request",
      tools: [...tools].reverse()
    });

    expect(first.messages).toEqual([
      { role: "system", content: "Static system prompt." },
      { role: "system", content: "<project_context>workspace=/repo</project_context>" },
      { role: "user", content: "old question" },
      { role: "assistant", content: "old answer" },
      { role: "user", content: "current request" }
    ]);
    expect(first.tools?.map((tool) => tool.function.name)).toEqual(["read_file", "write_file"]);
    expect(first.prefixHash).toBe(samePrefix.prefixHash);
    expect(first.promptHash).not.toBe(samePrefix.promptHash);
    expect(first.segments.map((segment) => segment.name)).toEqual([
      "core_prefix",
      "tool_prefix",
      "project_snapshot",
      "conversation_ledger",
      "dynamic_tail"
    ]);
    expect(first.segments.find((segment) => segment.name === "dynamic_tail")).toMatchObject({
      includedInPrefix: false,
      cacheStable: false
    });
  });

  it("changes the prefix hash when a stable prefix segment changes", () => {
    const first = assembleRequest({
      systemPrompt: "Static system prompt.",
      projectContext: "<project_context>workspace=/repo</project_context>",
      userText: "current request",
      tools
    });
    const changedProject = assembleRequest({
      systemPrompt: "Static system prompt.",
      projectContext: "<project_context>workspace=/other</project_context>",
      userText: "current request",
      tools
    });

    expect(first.prefixHash).not.toBe(changedProject.prefixHash);
    expect(first.segments.find((segment) => segment.name === "project_snapshot")?.hash)
      .not.toBe(changedProject.segments.find((segment) => segment.name === "project_snapshot")?.hash);
    expect(diffRequestSegments(first.segments, changedProject.segments)).toMatchObject({
      reason: "project_changed",
      breaksPrefix: true,
      changedSegments: [
        expect.objectContaining({
          name: "project_snapshot",
          reason: "project_changed",
          breaksPrefix: true
        })
      ]
    });
  });

  it("treats appended ledger content as changed but not an automatic cache break", () => {
    const first = assembleRequest({
      systemPrompt: "Static system prompt.",
      projectContext: "<project_context>workspace=/repo</project_context>",
      userText: "first request",
      tools
    });
    const appended = assembleRequest({
      systemPrompt: "Static system prompt.",
      projectContext: "<project_context>workspace=/repo</project_context>",
      history: [
        { role: "user", content: "first request" },
        { role: "assistant", content: "first answer" }
      ],
      userText: "second request",
      tools
    });

    expect(diffRequestSegments(first.segments, appended.segments)).toMatchObject({
      reason: "dynamic_tail_changed",
      breaksPrefix: false,
      changedSegments: expect.arrayContaining([
        expect.objectContaining({
          name: "conversation_ledger",
          reason: "ledger_changed",
          breaksPrefix: false
        })
      ])
    });
    expect(() => assertAppendOnlyRequestPrefix(first, appended)).not.toThrow();
  });

  it("detects prefix invariant violations when prior messages are rewritten", () => {
    const first = assembleRequest({
      systemPrompt: "Static system prompt.",
      projectContext: "<project_context>workspace=/repo</project_context>",
      userText: "first request",
      tools
    });
    const rewritten = assembleRequest({
      systemPrompt: "Static system prompt.",
      projectContext: "<project_context>workspace=/repo</project_context>",
      history: [
        { role: "user", content: "rewritten first request" },
        { role: "assistant", content: "first answer" }
      ],
      userText: "second request",
      tools
    });

    expect(checkAppendOnlyRequestPrefix(first, rewritten)).toMatchObject({
      ok: false,
      reason: "message_rewritten",
      mismatchIndex: 2
    });
    expect(() => assertAppendOnlyRequestPrefix(first, rewritten)).toThrow(/Prefix invariant failed/);
  });

  it("keeps runtime prefix assertions scoped to stable request segments", () => {
    const previous = assembleRequest({
      systemPrompt: "Static system prompt.",
      projectContext: "<project_context>workspace=/repo</project_context>",
      history: [{ role: "user", content: "old question" }],
      userText: "<context>index hits</context>\ncurrent request",
      tools
    });
    const replayed = assembleRequest({
      systemPrompt: "Static system prompt.",
      projectContext: "<project_context>workspace=/repo</project_context>",
      history: [
        { role: "user", content: "old question" },
        { role: "user", content: "current request" },
        { role: "assistant", content: "answer" }
      ],
      userText: "next request",
      tools
    });

    expect(checkAppendOnlyRequestPrefix(previous, replayed)).toMatchObject({
      ok: false,
      reason: "message_rewritten",
      mismatchIndex: 3
    });
    expect(checkStableRequestPrefixSegments(previous, replayed)).toMatchObject({
      ok: true,
      reason: "ok"
    });
    expect(() => assertStableRequestPrefixSegments(previous, replayed)).not.toThrow();
  });

  it("still fails runtime prefix assertions when stable segments change", () => {
    const previous = assembleRequest({
      systemPrompt: "Static system prompt.",
      projectContext: "<project_context>workspace=/repo</project_context>",
      userText: "current request",
      tools
    });
    const changedProject = assembleRequest({
      systemPrompt: "Static system prompt.",
      projectContext: "<project_context>workspace=/other</project_context>",
      userText: "current request",
      tools
    });
    const changedTools = assembleRequest({
      systemPrompt: "Static system prompt.",
      projectContext: "<project_context>workspace=/repo</project_context>",
      userText: "current request",
      tools: tools.slice(0, 1)
    });

    expect(checkStableRequestPrefixSegments(previous, changedProject)).toMatchObject({
      ok: false,
      reason: "message_rewritten"
    });
    expect(() => assertStableRequestPrefixSegments(previous, changedProject)).toThrow(/Project Snapshot changed/);
    expect(checkStableRequestPrefixSegments(previous, changedTools)).toMatchObject({
      ok: false,
      reason: "tool_prefix_changed"
    });
  });

  it("classifies dynamic tail changes as non-prefix changes", () => {
    const first = assembleRequest({
      systemPrompt: "Static system prompt.",
      projectContext: "<project_context>workspace=/repo</project_context>",
      userText: "current request",
      tools
    });
    const changedTail = assembleRequest({
      systemPrompt: "Static system prompt.",
      projectContext: "<project_context>workspace=/repo</project_context>",
      userText: "different current request",
      tools
    });

    expect(diffRequestSegments(first.segments, changedTail.segments)).toMatchObject({
      reason: "dynamic_tail_changed",
      breaksPrefix: false,
      changedSegments: [
        expect.objectContaining({
          name: "dynamic_tail",
          reason: "dynamic_tail_changed",
          breaksPrefix: false
        })
      ]
    });
  });

  it("treats turn N as a byte-stable prefix of turn N+1 when only appending messages", () => {
    const firstMessages: LlmMessage[] = [
      { role: "system", content: "Static system prompt." },
      { role: "system", content: "<project_context>workspace=/repo</project_context>" },
      { role: "user", content: "first request" }
    ];
    const nextMessages: LlmMessage[] = [
      ...firstMessages,
      { role: "assistant", content: "first answer" },
      { role: "user", content: "second request" }
    ];

    expect(requestPrefixHash(nextMessages, tools)).toBe(requestPrefixHash([
      ...firstMessages,
      { role: "assistant", content: "first answer" },
      { role: "user", content: "placeholder ignored by prefix" }
    ], [...tools].reverse()));
  });
});
