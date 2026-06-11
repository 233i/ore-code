import { afterEach, describe, expect, it, vi } from "vitest";
import { createTauriProviderFetch } from "./providerHttpFetch";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: [] as Array<(event: { payload: unknown }) => void>,
  unlisten: vi.fn()
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: mocks.invoke
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_event: string, callback: (event: { payload: unknown }) => void) => {
    mocks.listeners.push(callback);
    return mocks.unlisten;
  })
}));

const encoder = new TextEncoder();
const decoder = new TextDecoder();

describe("provider HTTP fetch", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    mocks.invoke.mockReset();
    mocks.listeners.length = 0;
    mocks.unlisten.mockReset();
  });

  it("streams Tauri provider chunks through the response body", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    vi.stubGlobal("crypto", { randomUUID: () => "stream-1" });
    mocks.invoke.mockResolvedValueOnce({
      status: 200,
      statusText: "OK",
      streaming: true,
      body: null
    });

    const fetch = createTauriProviderFetch();
    expect(fetch).toBeTruthy();
    const response = await fetch!("https://ark.example.test/api/coding/v3/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer test-key" },
      body: '{"stream":true}',
      signal: undefined
    });
    const iterator = (response.body as AsyncIterable<Uint8Array>)[Symbol.asyncIterator]();

    const firstChunk = iterator.next();
    emitChunk("stream-1", "data: first\n\n");
    expect(decoder.decode((await firstChunk).value)).toBe("data: first\n\n");

    const secondChunk = iterator.next();
    emitChunk("stream-1", "data: second\n\n");
    expect(decoder.decode((await secondChunk).value)).toBe("data: second\n\n");

    const done = iterator.next();
    emitDone("stream-1");
    expect(await done).toMatchObject({ done: true });
    expect(mocks.unlisten).toHaveBeenCalledTimes(1);
  });

  it("keeps non-stream requests buffered", async () => {
    vi.stubGlobal("window", { __TAURI_INTERNALS__: {} });
    mocks.invoke.mockResolvedValueOnce({
      status: 200,
      statusText: "OK",
      body: "{\"ok\":true}"
    });

    const fetch = createTauriProviderFetch();
    const response = await fetch!("https://ark.example.test/api/coding/v3/chat/completions", {
      method: "POST",
      headers: { authorization: "Bearer test-key" },
      body: '{"stream":false}',
      signal: undefined
    });

    expect(await response.text()).toBe("{\"ok\":true}");
    expect(mocks.listeners).toHaveLength(0);
  });
});

function emitChunk(streamId: string, text: string) {
  mocks.listeners.forEach((listener) => {
    listener({
      payload: {
        streamId,
        kind: "chunk",
        bytes: Array.from(encoder.encode(text)),
        error: null
      }
    });
  });
}

function emitDone(streamId: string) {
  mocks.listeners.forEach((listener) => {
    listener({
      payload: {
        streamId,
        kind: "done",
        bytes: null,
        error: null
      }
    });
  });
}
