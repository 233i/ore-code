import { describe, expect, it } from "vitest";
import {
  createFetchUrlTool,
  createWebSearchTool,
  mergeWebSearchOutputs,
  parseBingResults,
  normalizeFetchedText,
  parseDuckDuckGoLiteResults,
  searchErrorOutput,
  type WebToolHost
} from "./web-tools";

describe("web tools", () => {
  it("fetch_url normalizes html into readable text", async () => {
    const host: WebToolHost = {
      async fetchUrl(input) {
        return normalizeFetchedText({
          url: input.url,
          finalUrl: input.url,
          status: 200,
          contentType: "text/html",
          body: "<html><head><title>Example</title></head><body><h1>Hello</h1><p>World</p></body></html>",
          maxChars: input.maxChars
        });
      },
      async search() {
        throw new Error("not used");
      }
    };

    const result = await createFetchUrlTool(host).execute({ url: "https://example.com", maxChars: 100 }, context());

    expect(result.ok).toBe(true);
    expect(result.output).toMatchObject({
      title: "Example",
      status: 200,
      text: expect.stringContaining("Hello")
    });
  });

  it("web_search returns parsed DuckDuckGo Lite results", async () => {
    const host: WebToolHost = {
      async fetchUrl() {
        throw new Error("not used");
      },
      async search(input) {
        return parseDuckDuckGoLiteResults(`
          <tr><td><a href="/l/?kh=-1&uddg=https%3A%2F%2Fexample.com%2Fdocs">Example &amp; Docs</a></td></tr>
          <tr><td class="result-snippet">Useful docs snippet.</td></tr>
        `, input.query, input.maxResults);
      }
    };

    const result = await createWebSearchTool(host).execute({ query: "example docs" }, context());

    expect(result.output?.results[0]).toMatchObject({
      citationId: "web:1",
      source: "duckduckgo-lite",
      title: "Example & Docs",
      url: "https://example.com/docs"
    });
    expect(result.output?.citations[0]).toMatchObject({
      id: "web:1",
      url: "https://example.com/docs"
    });
  });

  it("parses Bing results and merges multi-source citations", () => {
    const duck = parseDuckDuckGoLiteResults(`
      <tr><td><a href="/l/?uddg=https%3A%2F%2Fexample.com%2Fdocs">Example Docs</a></td></tr>
      <tr><td class="result-snippet">Duck snippet.</td></tr>
    `, "example docs", 5);
    const bing = parseBingResults(`
      <li class="b_algo"><h2><a href="https://example.com/docs">Duplicate Docs</a></h2><p>Bing duplicate.</p></li>
      <li class="b_algo"><h2><a href="https://example.org/guide">Example Guide</a></h2><p>Bing guide snippet.</p></li>
    `, "example docs", 5);

    const merged = mergeWebSearchOutputs("example docs", [duck, bing, searchErrorOutput("example docs", "failed-source", "timeout")], 5);

    expect(merged.sources).toEqual([
      { id: "duckduckgo-lite", ok: true, resultCount: 1 },
      { id: "bing", ok: true, resultCount: 2 },
      { id: "failed-source", ok: false, resultCount: 0, error: "timeout" }
    ]);
    expect(merged.results.map((result) => result.url)).toEqual([
      "https://example.com/docs",
      "https://example.org/guide"
    ]);
    expect(merged.citations.map((citation) => citation.id)).toEqual(["web:1", "web:2"]);
  });

  it("rejects non-http fetch URLs", async () => {
    const host: WebToolHost = {
      async fetchUrl() {
        throw new Error("not used");
      },
      async search() {
        throw new Error("not used");
      }
    };

    await expect(createFetchUrlTool(host).execute({ url: "file:///etc/passwd" }, context())).rejects.toThrow("http");
  });
});

function context() {
  return {
    workspacePath: "/workspace",
    mode: "agent" as const,
    trustedWorkspace: true
  };
}
