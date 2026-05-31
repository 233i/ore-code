import { invoke } from "@tauri-apps/api/core";
import {
  normalizeFetchedText,
  mergeWebSearchOutputs,
  parseBingResults,
  parseDuckDuckGoLiteResults,
  searchErrorOutput,
  type WebFetchOutput,
  type WebSearchOutput,
  type WebToolHost
} from "@seekforge/tools";
import { isTauriRuntime } from "./fileHost";

type TauriWebFetchOutput = {
  url: string;
  finalUrl: string;
  status: number;
  contentType?: string;
  body: string;
  truncated: boolean;
};

const SEARCH_FETCH_CHARS = 120_000;
const DEFAULT_SEARCH_SOURCES = ["duckduckgo-lite", "bing"] as const;

export function createRuntimeWebHost(): WebToolHost {
  if (isTauriRuntime()) {
    return createTauriWebHost();
  }

  return createBrowserWebHost();
}

function createTauriWebHost(): WebToolHost {
  return {
    async fetchUrl(input): Promise<WebFetchOutput> {
      const raw = await invoke<TauriWebFetchOutput>("web_fetch_url", {
        url: input.url,
        timeoutMs: input.timeoutMs,
        maxBytes: Math.max(input.maxChars * 4, input.maxChars)
      });
      const normalized = normalizeFetchedText({
        url: raw.url,
        finalUrl: raw.finalUrl,
        status: raw.status,
        contentType: raw.contentType,
        body: raw.body,
        maxChars: input.maxChars
      });
      return {
        ...normalized,
        truncated: normalized.truncated || raw.truncated
      };
    },
    async search(input): Promise<WebSearchOutput> {
      const sources = input.sources ?? [...DEFAULT_SEARCH_SOURCES];
      const outputs = await Promise.all(sources.map(async (source) => {
        try {
          const raw = await invoke<TauriWebFetchOutput>("web_fetch_url", {
            url: searchSourceUrl(source, input.query),
            timeoutMs: input.timeoutMs,
            maxBytes: SEARCH_FETCH_CHARS
          });
          return parseSearchSource(source, raw.body, input.query, input.maxResults);
        } catch (error) {
          return searchErrorOutput(input.query, source, error);
        }
      }));
      return mergeWebSearchOutputs(input.query, outputs, input.maxResults);
    }
  };
}

function createBrowserWebHost(): WebToolHost {
  return {
    async fetchUrl(input): Promise<WebFetchOutput> {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), input.timeoutMs);
      try {
        const response = await fetch(input.url, {
          redirect: "follow",
          signal: controller.signal,
          headers: { accept: "text/html,text/plain,application/json;q=0.8,*/*;q=0.5" }
        });
        const body = await response.text();
        return normalizeFetchedText({
          url: input.url,
          finalUrl: response.url,
          status: response.status,
          contentType: response.headers.get("content-type") ?? undefined,
          body,
          maxChars: input.maxChars
        });
      } finally {
        window.clearTimeout(timer);
      }
    },
    async search(input): Promise<WebSearchOutput> {
      const sources = input.sources ?? [...DEFAULT_SEARCH_SOURCES];
      const outputs = await Promise.all(sources.map(async (source) => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), input.timeoutMs);
        try {
          const response = await fetch(searchSourceUrl(source, input.query), {
            redirect: "follow",
            signal: controller.signal,
            headers: { accept: "text/html" }
          });
          return parseSearchSource(source, await response.text(), input.query, input.maxResults);
        } catch (error) {
          return searchErrorOutput(input.query, source, error);
        } finally {
          window.clearTimeout(timer);
        }
      }));
      return mergeWebSearchOutputs(input.query, outputs, input.maxResults);
    }
  };
}

function searchSourceUrl(source: string, query: string) {
  switch (source) {
    case "bing":
      return bingSearchUrl(query);
    case "duckduckgo-lite":
    default:
      return duckDuckGoLiteUrl(query);
  }
}

function parseSearchSource(source: string, html: string, query: string, maxResults: number) {
  switch (source) {
    case "bing":
      return parseBingResults(html, query, maxResults);
    case "duckduckgo-lite":
    default:
      return parseDuckDuckGoLiteResults(html, query, maxResults);
  }
}

function duckDuckGoLiteUrl(query: string) {
  const params = new URLSearchParams({ q: query });
  return `https://lite.duckduckgo.com/lite/?${params.toString()}`;
}

function bingSearchUrl(query: string) {
  const params = new URLSearchParams({ q: query, setlang: "en-US", mkt: "en-US" });
  return `https://www.bing.com/search?${params.toString()}`;
}
