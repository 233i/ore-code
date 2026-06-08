import { describe, expect, it } from "vitest";
import {
  createDeepSeekClient,
  createMimoClient,
  DEFAULT_DEEPSEEK_BASE_URL,
  DEFAULT_DEEPSEEK_MODEL,
  DEFAULT_MIMO_BASE_URL,
  DEFAULT_MIMO_MODEL,
  OpenAiCompatibleLlmClient,
  type FetchInit,
  type StreamResponse
} from "./openai-compatible";
import type { LlmToolDefinition } from "./llm";

const encoder = new TextEncoder();

describe("OpenAiCompatibleLlmClient", () => {
  it("uses DeepSeek V4 Pro defaults for the DeepSeek client factory", async () => {
    const requests: Array<{ url: string; init: FetchInit }> = [];
    const client = createDeepSeekClient({
      apiKey: "test-key",
      fetch: async (url, init) => {
        requests.push({ url, init });
        return streamResponse(["data: [DONE]\n\n"]);
      }
    });

    for await (const chunk of client.streamTurn({
      threadId: "thread-1",
      turnId: "turn-1",
      messages: [{ role: "user", content: "hi" }]
    })) {
      void chunk;
    }

    expect(requests[0].url).toBe(`${DEFAULT_DEEPSEEK_BASE_URL}/chat/completions`);
    expect(JSON.parse(requests[0].init.body)).toMatchObject({
      model: DEFAULT_DEEPSEEK_MODEL
    });
    expect(JSON.parse(requests[0].init.body)).not.toHaveProperty("thinking");
    expect(JSON.parse(requests[0].init.body)).not.toHaveProperty("reasoning_effort");
  });

  it("uses the explicit DeepSeek model passed by the caller", async () => {
    const requests: Array<{ url: string; init: FetchInit }> = [];
    const client = createDeepSeekClient({
      apiKey: "test-key",
      model: "deepseek-v4-flash",
      fetch: async (url, init) => {
        requests.push({ url, init });
        return streamResponse(["data: [DONE]\n\n"]);
      }
    });

    for await (const chunk of client.streamTurn({
      threadId: "thread-1",
      turnId: "turn-1",
      messages: [{ role: "user", content: "hi" }]
    })) {
      void chunk;
    }

    expect(JSON.parse(requests[0].init.body).model).toBe("deepseek-v4-flash");
  });

  it("uses Mimo defaults for the Mimo client factory", async () => {
    const requests: Array<{ url: string; init: FetchInit }> = [];
    const client = createMimoClient({
      apiKey: "test-key",
      fetch: async (url, init) => {
        requests.push({ url, init });
        return streamResponse(["data: [DONE]\n\n"]);
      }
    });

    for await (const chunk of client.streamTurn({
      threadId: "thread-1",
      turnId: "turn-1",
      messages: [{ role: "user", content: "hi" }]
    })) {
      void chunk;
    }

    expect(requests[0].url).toBe(`${DEFAULT_MIMO_BASE_URL}/chat/completions`);
    expect(requests[0].init.headers.authorization).toBe("Bearer test-key");
    expect(JSON.parse(requests[0].init.body)).toMatchObject({
      model: DEFAULT_MIMO_MODEL
    });
    expect(JSON.parse(requests[0].init.body)).not.toHaveProperty("thinking");
    expect(JSON.parse(requests[0].init.body)).not.toHaveProperty("reasoning_effort");
  });

  it("serializes Mimo thinking as on and off without DeepSeek reasoning effort", async () => {
    const requests: Array<{ url: string; init: FetchInit }> = [];

    for (const mimoThinkingLevel of ["off", "on"] as const) {
      const client = createMimoClient({
        apiKey: "test-key",
        mimoThinkingLevel,
        fetch: async (url, init) => {
          requests.push({ url, init });
          return streamResponse(["data: [DONE]\n\n"]);
        }
      });

      for await (const chunk of client.streamTurn({
        threadId: "thread-1",
        turnId: `turn-${mimoThinkingLevel}`,
        messages: [{ role: "user", content: "hi" }]
      })) {
        void chunk;
      }
    }

    expect(JSON.parse(requests[0].init.body)).toMatchObject({
      thinking: { type: "disabled" }
    });
    expect(JSON.parse(requests[0].init.body)).not.toHaveProperty("reasoning_effort");
    expect(JSON.parse(requests[1].init.body)).toMatchObject({
      thinking: { type: "enabled" }
    });
    expect(JSON.parse(requests[1].init.body)).not.toHaveProperty("reasoning_effort");
  });

  it("serializes DeepSeek thinking level controls for chat requests", async () => {
    const requests: Array<{ url: string; init: FetchInit }> = [];

    for (const deepSeekThinkingLevel of ["off", "high", "max"] as const) {
      const client = createDeepSeekClient({
        apiKey: "test-key",
        deepSeekThinkingLevel,
        fetch: async (url, init) => {
          requests.push({ url, init });
          return streamResponse(["data: [DONE]\n\n"]);
        }
      });

      for await (const chunk of client.streamTurn({
        threadId: "thread-1",
        turnId: `turn-${deepSeekThinkingLevel}`,
        messages: [{ role: "user", content: "hi" }]
      })) {
        void chunk;
      }
    }

    expect(JSON.parse(requests[0].init.body)).toMatchObject({
      thinking: { type: "disabled" }
    });
    expect(JSON.parse(requests[0].init.body)).not.toHaveProperty("reasoning_effort");
    expect(JSON.parse(requests[1].init.body)).toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "high"
    });
    expect(JSON.parse(requests[2].init.body)).toMatchObject({
      thinking: { type: "enabled" },
      reasoning_effort: "max"
    });
  });

  it("streams assistant text, reasoning, tool calls, and completion", async () => {
    const requests: Array<{ url: string; init: FetchInit }> = [];
    const client = new OpenAiCompatibleLlmClient({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com/v1/",
      model: "deepseek-chat",
      fetch: async (url, init) => {
        requests.push({ url, init });
        return streamResponse([
          sse({ choices: [{ delta: { reasoning_content: "先看目录" } }] }),
          sse({ choices: [{ delta: { content: "我会检查。" } }] }),
          sse({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-1",
                      type: "function",
                      function: { name: "list_dir", arguments: "{\"path\"" }
                    }
                  ]
                }
              }
            ]
          }),
          sse({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      function: { arguments: ":\".\"}" }
                    }
                  ]
                },
                finish_reason: "tool_calls"
              }
            ]
          }),
          "data: [DONE]\n\n"
        ]);
      }
    });

    const tools: LlmToolDefinition[] = [
      {
        type: "function",
        function: {
          name: "list_dir",
          description: "List directory entries.",
          parameters: { type: "object", properties: { path: { type: "string" } } }
        }
      }
    ];

    const chunks = [];
    for await (const chunk of client.streamTurn({
      threadId: "thread-1",
      turnId: "turn-1",
      messages: [{ role: "user", content: "列目录" }],
      tools
    })) {
      chunks.push(chunk);
    }

    expect(requests[0].url).toBe("https://api.deepseek.com/v1/chat/completions");
    expect(requests[0].init.headers.authorization).toBe("Bearer test-key");
    expect(JSON.parse(requests[0].init.body)).toMatchObject({
      model: "deepseek-chat",
      stream: true,
      stream_options: { include_usage: true },
      tools
    });
    expect(chunks).toEqual([
      { type: "reasoning_delta", text: "先看目录" },
      { type: "assistant_delta", text: "我会检查。" },
      { type: "tool_call", call: { id: "call-1", name: "list_dir", input: { path: "." } } },
      { type: "done", finishReason: "tool_calls" }
    ]);
  });

  it("emits provider usage with cache metrics and estimated cost", async () => {
    const requests: Array<{ url: string; init: FetchInit }> = [];
    const client = new OpenAiCompatibleLlmClient({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-v4-pro",
      fetch: async (url, init) => {
        requests.push({ url, init });
        return streamResponse([
          sse({
            usage: {
              prompt_tokens: 1000,
              completion_tokens: 2000,
              total_tokens: 3000,
              prompt_tokens_details: { cached_tokens: 400 },
              completion_tokens_details: { reasoning_tokens: 600 }
            },
            choices: []
          }),
          "data: [DONE]\n\n"
        ]);
      }
    });

    const chunks = [];
    for await (const chunk of client.streamTurn({
      threadId: "thread-1",
      turnId: "turn-1",
      messages: [{ role: "user", content: "hi" }]
    })) {
      chunks.push(chunk);
    }

    expect(JSON.parse(requests[0].init.body).stream_options).toEqual({ include_usage: true });
    expect(chunks).toEqual([
      {
        type: "usage",
        usage: {
          model: "deepseek-v4-pro",
          promptTokens: 1000,
          completionTokens: 2000,
          totalTokens: 3000,
          cachedTokens: 400,
          cacheHitTokens: 400,
          cacheMissTokens: 600,
          cacheHitRatio: 0.4,
          reasoningTokens: 600,
          costUsd: 0.00239,
          costCny: 0.017208,
          cacheHitInputCostUsd: 0.000028,
          cacheMissInputCostUsd: 0.000162,
          outputCostUsd: 0.0022,
          cacheHitInputCostCny: 0.000202,
          cacheMissInputCostCny: 0.001166,
          outputCostCny: 0.01584
        }
      },
      { type: "done", finishReason: undefined }
    ]);
  });

  it("warms a stable prefix with a non-streaming one-token request", async () => {
    const requests: Array<{ url: string; init: FetchInit }> = [];
    const client = new OpenAiCompatibleLlmClient({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-v4-pro",
      fetch: async (url, init) => {
        requests.push({ url, init });
        return textResponse(JSON.stringify({
          usage: {
            prompt_tokens: 500,
            completion_tokens: 1,
            total_tokens: 501,
            prompt_tokens_details: { cached_tokens: 300 }
          }
        }));
      }
    });

    const usage = await client.warmupPrefix({
      threadId: "thread-1",
      turnId: "turn-1",
      messages: [{ role: "system", content: "static system" }],
      tools: [{
        type: "function",
        function: {
          name: "grep_files",
          description: "Search files.",
          parameters: { type: "object", properties: {} }
        }
      }]
    });

    expect(JSON.parse(requests[0].init.body)).toMatchObject({
      model: "deepseek-v4-pro",
      messages: [{ role: "system", content: "static system" }],
      stream: false,
      max_tokens: 1
    });
    expect(JSON.parse(requests[0].init.body)).not.toHaveProperty("stream_options");
    expect(usage).toMatchObject({
      promptTokens: 500,
      completionTokens: 1,
      cachedTokens: 300,
      cacheMissTokens: 200
    });
  });

  it("runs FIM prefix completion through the completions endpoint without thinking tools", async () => {
    const requests: Array<{ url: string; init: FetchInit }> = [];
    const client = createDeepSeekClient({
      apiKey: "test-key",
      fetch: async (url, init) => {
        requests.push({ url, init });
        return textResponse(JSON.stringify({
          choices: [{ text: "fix: tighten DeepSeek context accounting", finish_reason: "stop" }],
          usage: {
            prompt_tokens: 100,
            completion_tokens: 12,
            total_tokens: 112,
            prompt_cache_hit_tokens: 40,
            prompt_cache_miss_tokens: 60
          }
        }));
      }
    });

    const result = await client.completePrefix({
      threadId: "thread-1",
      turnId: "turn-1",
      prefix: "Write a concise commit message:\n",
      suffix: "\nBody:",
      maxTokens: 8192
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].url).toBe(`${DEFAULT_DEEPSEEK_BASE_URL}/completions`);
    expect(JSON.parse(requests[0].init.body)).toEqual({
      model: DEFAULT_DEEPSEEK_MODEL,
      prompt: "Write a concise commit message:\n",
      suffix: "\nBody:",
      stream: false,
      max_tokens: 4096
    });
    expect(result).toMatchObject({
      text: "fix: tighten DeepSeek context accounting",
      finishReason: "stop",
      mode: "fim",
      usage: {
        promptTokens: 100,
        completionTokens: 12,
        cachedTokens: 40,
        cacheHitTokens: 40,
        cacheMissTokens: 60
      }
    });
  });

  it("falls back to non-streaming chat prefix completion when FIM is unavailable", async () => {
    const requests: Array<{ url: string; init: FetchInit }> = [];
    const client = createDeepSeekClient({
      apiKey: "test-key",
      fetch: async (url, init) => {
        requests.push({ url, init });
        if (url === `${DEFAULT_DEEPSEEK_BASE_URL}/completions`) {
          return {
            ok: false,
            status: 404,
            statusText: "Not Found",
            body: null,
            async text() {
              return "not supported";
            }
          };
        }
        return textResponse(JSON.stringify({
          choices: [{ message: { content: "LGTM, but re-run desktop tests." }, finish_reason: "stop" }],
          usage: {
            prompt_tokens: 80,
            completion_tokens: 9,
            total_tokens: 89
          }
        }));
      }
    });

    const result = await client.completePrefix({
      threadId: "thread-1",
      turnId: "turn-1",
      prefix: "Review comment:",
      maxTokens: 256
    });

    expect(requests.map((request) => request.url)).toEqual([
      `${DEFAULT_DEEPSEEK_BASE_URL}/completions`,
      `${DEFAULT_DEEPSEEK_BASE_URL}/chat/completions`
    ]);
    expect(JSON.parse(requests[1].init.body)).toMatchObject({
      model: DEFAULT_DEEPSEEK_MODEL,
      stream: false,
      max_tokens: 256,
      messages: [
        { role: "user", content: "Continue the following prefix. Return only the completion." },
        { role: "assistant", content: "Review comment:", prefix: true }
      ]
    });
    expect(result).toMatchObject({
      text: "LGTM, but re-run desktop tests.",
      mode: "chat-prefix-fallback"
    });
  });

  it("serializes assistant tool calls and tool results for follow-up requests", async () => {
    const requests: Array<{ url: string; init: FetchInit }> = [];
    const client = new OpenAiCompatibleLlmClient({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      fetch: async (url, init) => {
        requests.push({ url, init });
        return streamResponse(["data: [DONE]\n\n"]);
      }
    });

    for await (const chunk of client.streamTurn({
      threadId: "thread-1",
      turnId: "turn-1",
      messages: [
        { role: "user", content: "列目录" },
        {
          role: "assistant",
          content: "我会检查。",
          reasoningContent: "需要先列目录。",
          toolCalls: [{ id: "call-1", name: "list_dir", input: { path: "." } }]
        },
        {
          role: "tool",
          toolCallId: "call-1",
          content: "{\"ok\":true}"
        }
      ]
    })) {
      void chunk;
    }

    expect(JSON.parse(requests[0].init.body).messages).toEqual([
      { role: "user", content: "列目录" },
      {
        role: "assistant",
        content: "我会检查。",
        reasoning_content: "需要先列目录。",
        tool_calls: [
          {
            id: "call-1",
            type: "function",
            function: { name: "list_dir", arguments: "{\"path\":\".\"}" }
          }
        ]
      },
      { role: "tool", tool_call_id: "call-1", content: "{\"ok\":true}" }
    ]);
  });

  it("adds a reasoning_content placeholder for DeepSeek thinking tool-call messages when absent", async () => {
    const requests: Array<{ url: string; init: FetchInit }> = [];
    const client = createDeepSeekClient({
      apiKey: "test-key",
      fetch: async (url, init) => {
        requests.push({ url, init });
        return streamResponse(["data: [DONE]\n\n"]);
      }
    });

    for await (const chunk of client.streamTurn({
      threadId: "thread-1",
      turnId: "turn-1",
      messages: [
        { role: "user", content: "列目录" },
        {
          role: "assistant",
          content: "",
          toolCalls: [{ id: "call-1", name: "list_dir", input: { path: "." } }]
        },
        {
          role: "tool",
          toolCallId: "call-1",
          content: "{\"ok\":true}"
        }
      ]
    })) {
      void chunk;
    }

    expect(JSON.parse(requests[0].init.body).messages[1]).toMatchObject({
      role: "assistant",
      content: null,
      reasoning_content: "(reasoning omitted)",
      tool_calls: [
        {
          id: "call-1",
          type: "function",
          function: { name: "list_dir", arguments: "{\"path\":\".\"}" }
        }
      ]
    });
  });

  it("preserves reasoning_content on assistant history messages without tool calls", async () => {
    const requests: Array<{ url: string; init: FetchInit }> = [];
    const client = createDeepSeekClient({
      apiKey: "test-key",
      fetch: async (url, init) => {
        requests.push({ url, init });
        return streamResponse(["data: [DONE]\n\n"]);
      }
    });

    for await (const chunk of client.streamTurn({
      threadId: "thread-1",
      turnId: "turn-2",
      messages: [
        { role: "user", content: "解释一下" },
        {
          role: "assistant",
          content: "最终解释。",
          reasoningContent: "先组织解释结构。"
        },
        { role: "user", content: "继续" }
      ]
    })) {
      void chunk;
    }

    expect(JSON.parse(requests[0].init.body).messages[1]).toEqual({
      role: "assistant",
      content: "最终解释。",
      reasoning_content: "先组织解释结构。"
    });
  });

  it("treats streamed tool calls without finish_reason as a tool-call turn", async () => {
    const client = new OpenAiCompatibleLlmClient({
      apiKey: "test-key",
      baseUrl: "https://api.deepseek.com/v1",
      model: "deepseek-chat",
      fetch: async () =>
        streamResponse([
          sse({
            choices: [
              {
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call-1",
                      type: "function",
                      function: { name: "list_dir", arguments: "{\"path\":\".\"}" }
                    }
                  ]
                }
              }
            ]
          }),
          "data: [DONE]\n\n"
        ])
    });

    const chunks = [];
    for await (const chunk of client.streamTurn({
      threadId: "thread-1",
      turnId: "turn-1",
      messages: [{ role: "user", content: "列目录" }]
    })) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual([
      { type: "tool_call", call: { id: "call-1", name: "list_dir", input: { path: "." } } },
      { type: "done", finishReason: "tool_calls" }
    ]);
  });

  it("surfaces provider errors with response body context", async () => {
    const client = createDeepSeekClient({
      apiKey: "bad-key",
      fetch: async () => ({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        body: null,
        async text() {
          return "invalid api key";
        }
      })
    });

    await expect(async () => {
      for await (const chunk of client.streamTurn({
        threadId: "thread-1",
        turnId: "turn-1",
        messages: [{ role: "user", content: "hi" }]
      })) {
        void chunk;
        // consume stream
      }
    }).rejects.toThrow("401 Unauthorized - invalid api key");
  });

  it("adds a DeepSeek reasoning replay hint for thinking tool-call history errors", async () => {
    const client = createDeepSeekClient({
      apiKey: "bad-history",
      fetch: async () => ({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        body: null,
        async text() {
          return "messages with tool_calls must include reasoning_content";
        }
      })
    });

    await expect(async () => {
      for await (const chunk of client.streamTurn({
        threadId: "thread-1",
        turnId: "turn-1",
        messages: [{ role: "user", content: "hi" }]
      })) {
        void chunk;
      }
    }).rejects.toThrow("requires assistant tool-call history to replay reasoning_content");
  });
});

function sse(value: unknown): string {
  return `data: ${JSON.stringify(value)}\n\n`;
}

function streamResponse(chunks: string[]): StreamResponse {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body: {
      async *[Symbol.asyncIterator]() {
        for (const chunk of chunks) {
          yield encoder.encode(chunk);
        }
      }
    },
    async text() {
      return "";
    }
  };
}

function textResponse(body: string): StreamResponse {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    body: null,
    async text() {
      return body;
    }
  };
}
