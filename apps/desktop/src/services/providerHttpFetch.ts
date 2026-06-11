import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { FetchInit, FetchLike, StreamResponse } from "@ore-code/agent-core";
import { isTauriRuntime } from "./fileHost";

type ProviderHttpResponse = {
  status: number;
  statusText: string;
  body: string;
};

type ProviderHttpStreamResponse = {
  status: number;
  statusText: string;
  streaming: boolean;
  body?: string | null;
};

type ProviderHttpStreamEvent = {
  streamId: string;
  kind: "chunk" | "done" | "error";
  bytes?: number[] | null;
  error?: string | null;
};

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export function createTauriProviderFetch(timeoutMs = 600_000): FetchLike | undefined {
  if (!isTauriRuntime()) {
    return undefined;
  }

  return async (url: string, init: FetchInit): Promise<StreamResponse> => {
    if (init.signal?.aborted) {
      throw new DOMException("Request aborted", "AbortError");
    }

    if (isStreamingRequest(init.body)) {
      return tauriStreamFetch(url, init, timeoutMs);
    }

    return tauriBufferedFetch(url, init, timeoutMs);
  };
}

export function createArkProviderFetch(): FetchLike {
  const tauriFetch = createTauriProviderFetch();
  if (tauriFetch) {
    return tauriFetch;
  }

  return async () => {
    throw new Error("Ark Coding 需要在 Ore Code 桌面应用中使用；浏览器预览会被火山接口 CORS 阻止。");
  };
}

async function* singleChunkBody(body: string): AsyncIterable<Uint8Array> {
  yield encoder.encode(body);
}

function isStreamingRequest(body: string) {
  try {
    const parsed = JSON.parse(body) as { stream?: unknown };
    return parsed.stream === true;
  } catch {
    return false;
  }
}

async function tauriBufferedFetch(url: string, init: FetchInit, timeoutMs: number): Promise<StreamResponse> {
  const response = await invoke<ProviderHttpResponse>("provider_http_request", {
    request: {
      url,
      headers: init.headers,
      body: init.body,
      timeoutMs
    }
  });

  return {
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    statusText: response.statusText,
    body: singleChunkBody(response.body),
    text: async () => response.body
  };
}

async function tauriStreamFetch(url: string, init: FetchInit, timeoutMs: number): Promise<StreamResponse> {
  const streamId = crypto.randomUUID();
  const body = await ProviderHttpEventBody.create(streamId, init.signal);

  try {
    const response = await invoke<ProviderHttpStreamResponse>("provider_http_stream", {
      request: {
        streamId,
        url,
        headers: init.headers,
        body: init.body,
        timeoutMs
      }
    });

    if (!response.streaming) {
      body.dispose();
      const responseBody = response.body ?? "";
      return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        statusText: response.statusText,
        body: singleChunkBody(responseBody),
        text: async () => responseBody
      };
    }

    return {
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      statusText: response.statusText,
      body,
      text: () => body.text()
    };
  } catch (error) {
    body.dispose();
    throw error;
  }
}

class ProviderHttpEventBody implements AsyncIterable<Uint8Array> {
  private readonly queue: Uint8Array[] = [];
  private readonly signal?: AbortSignal;
  private unlisten?: UnlistenFn;
  private wake?: () => void;
  private done = false;
  private error: Error | null = null;

  private constructor(private readonly streamId: string, signal?: AbortSignal) {
    this.signal = signal;
  }

  static async create(streamId: string, signal?: AbortSignal): Promise<ProviderHttpEventBody> {
    const body = new ProviderHttpEventBody(streamId, signal);
    await body.start();
    return body;
  }

  async start() {
    this.unlisten = await listen<ProviderHttpStreamEvent>("provider_http_stream", (event) => {
      if (event.payload.streamId !== this.streamId) {
        return;
      }
      this.accept(event.payload);
    });

    this.signal?.addEventListener("abort", this.abort);
    if (this.signal?.aborted) {
      this.abort();
    }
  }

  async text(): Promise<string> {
    const chunks: Uint8Array[] = [];
    for await (const chunk of this) {
      chunks.push(chunk);
    }
    const bytes = new Uint8Array(chunks.reduce((total, chunk) => total + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return decoder.decode(bytes);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<Uint8Array> {
    try {
      while (true) {
        if (this.queue.length > 0) {
          yield this.queue.shift()!;
          continue;
        }
        if (this.error) {
          throw this.error;
        }
        if (this.done) {
          return;
        }
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
      }
    } finally {
      this.dispose();
    }
  }

  dispose() {
    this.signal?.removeEventListener("abort", this.abort);
    this.unlisten?.();
    this.unlisten = undefined;
  }

  private accept(event: ProviderHttpStreamEvent) {
    if (event.kind === "chunk") {
      this.queue.push(Uint8Array.from(event.bytes ?? []));
    } else if (event.kind === "done") {
      this.done = true;
    } else {
      this.error = new Error(event.error || "Provider stream failed.");
    }
    this.notify();
  }

  private readonly abort = () => {
    this.error = new DOMException("Request aborted", "AbortError");
    this.notify();
    this.dispose();
  };

  private notify() {
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }
}
