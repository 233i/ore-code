import { z } from "zod";
import type { ToolSpec } from "./spec";

const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_CHARS = 20_000;
const MAX_CHARS = 80_000;
const DEFAULT_SEARCH_RESULTS = 6;
const MAX_SEARCH_RESULTS = 10;

const FetchUrlInputSchema = z.object({
  url: z.string().url(),
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional(),
  maxChars: z.number().int().positive().max(MAX_CHARS).optional()
});

const WebSearchInputSchema = z.object({
  query: z.string().trim().min(1),
  maxResults: z.number().int().positive().max(MAX_SEARCH_RESULTS).optional(),
  timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional(),
  sources: z.array(z.enum(["duckduckgo-lite", "bing"])).min(1).optional()
});

export interface WebToolHost {
  fetchUrl(input: { url: string; timeoutMs: number; maxChars: number }): Promise<WebFetchOutput>;
  search(input: { query: string; maxResults: number; timeoutMs: number; sources?: Array<"duckduckgo-lite" | "bing"> }): Promise<WebSearchOutput>;
}

export interface WebFetchOutput {
  url: string;
  finalUrl: string;
  status: number;
  ok: boolean;
  contentType?: string;
  title?: string;
  text: string;
  truncated: boolean;
  citation: WebCitation;
}

export interface WebSearchOutput {
  query: string;
  source: string;
  sources: WebSearchSourceStatus[];
  results: WebSearchResult[];
  citations: WebCitation[];
  truncated: boolean;
}

export interface WebSearchResult {
  id: string;
  citationId: string;
  title: string;
  url: string;
  snippet: string;
  source: string;
  sourceRank: number;
}

export interface WebSearchSourceStatus {
  id: string;
  ok: boolean;
  resultCount: number;
  error?: string;
}

export interface WebCitation {
  id: string;
  title?: string;
  url: string;
  source: string;
  snippet?: string;
}

export function createFetchUrlTool(
  host: WebToolHost
): ToolSpec<z.infer<typeof FetchUrlInputSchema>, WebFetchOutput> {
  return {
    name: "fetch_url",
    description: "Fetch a public http(s) URL and return readable text with status, title, and truncation metadata.",
    capability: "network",
    approval: "never",
    inputSchema: FetchUrlInputSchema,
    async execute(input) {
      const output = await host.fetchUrl({
        url: normalizeHttpUrl(input.url),
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxChars: input.maxChars ?? DEFAULT_MAX_CHARS
      });
      return {
        callId: "fetch_url",
        ok: true,
        output
      };
    }
  };
}

export function createWebSearchTool(
  host: WebToolHost
): ToolSpec<z.infer<typeof WebSearchInputSchema>, WebSearchOutput> {
  return {
    name: "web_search",
    description: "Search the web across multiple public sources and return ranked results with citation ids, titles, URLs, snippets, and source status.",
    capability: "network",
    approval: "never",
    inputSchema: WebSearchInputSchema,
    async execute(input) {
      const output = await host.search({
        query: input.query.trim(),
        maxResults: input.maxResults ?? DEFAULT_SEARCH_RESULTS,
        timeoutMs: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        sources: input.sources
      });
      return {
        callId: "web_search",
        ok: true,
        output
      };
    }
  };
}

export function createWebTools(host: WebToolHost): ToolSpec[] {
  return [createWebSearchTool(host), createFetchUrlTool(host)];
}

export function normalizeFetchedText(input: { url: string; finalUrl?: string; status: number; contentType?: string; body: string; maxChars: number }): WebFetchOutput {
  const title = extractTitle(input.body);
  const readable = looksLikeHtml(input.contentType, input.body) ? htmlToText(input.body) : input.body;
  const truncated = readable.length > input.maxChars;
  const finalUrl = input.finalUrl || input.url;
  return {
    url: input.url,
    finalUrl,
    status: input.status,
    ok: input.status >= 200 && input.status < 400,
    contentType: input.contentType,
    title,
    text: truncated ? readable.slice(0, input.maxChars) : readable,
    truncated,
    citation: {
      id: "web:1",
      title,
      url: finalUrl,
      source: "fetch_url",
      snippet: firstSnippet(readable)
    }
  };
}

export function parseDuckDuckGoLiteResults(html: string, query: string, maxResults: number): WebSearchOutput {
  const results: WebSearchResult[] = [];
  const rows = html.split(/<tr[^>]*>/i);

  for (const row of rows) {
    const link = row.match(/<a[^>]+href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) {
      continue;
    }

    const url = decodeDuckDuckGoUrl(decodeHtml(link[2]));
    if (!isHttpUrl(url) || url.includes("duckduckgo.com/y.js")) {
      continue;
    }

    const title = cleanText(link[3]);
    const snippet = cleanText(
      row
        .replace(link[0], " ")
        .replace(/<a[\s\S]*?<\/a>/gi, " ")
    );
    if (!title || results.some((result) => result.url === url)) {
      continue;
    }

    results.push(toSearchResult("duckduckgo-lite", results.length + 1, title, url, snippet));
    if (results.length >= maxResults) {
      break;
    }
  }

  return buildSearchOutput(query, [{ id: "duckduckgo-lite", ok: true, resultCount: results.length }], results, maxResults);
}

export function parseBingResults(html: string, query: string, maxResults: number): WebSearchOutput {
  const results: WebSearchResult[] = [];
  const blocks = html.split(/<li[^>]+class=(["'])[^"']*\bb_algo\b[^"']*\1[^>]*>/i);

  for (const block of blocks) {
    const link = block.match(/<h2[^>]*>\s*<a[^>]+href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/i)
      ?? block.match(/<a[^>]+href=(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/i);
    if (!link) {
      continue;
    }

    const url = decodeHtml(link[2]);
    if (!isHttpUrl(url) || url.includes("bing.com/ck/a")) {
      continue;
    }

    const title = cleanText(link[3]);
    const snippetMatch = block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = snippetMatch ? cleanText(snippetMatch[1]) : "";
    if (!title || results.some((result) => result.url === url)) {
      continue;
    }

    results.push(toSearchResult("bing", results.length + 1, title, url, snippet));
    if (results.length >= maxResults) {
      break;
    }
  }

  return buildSearchOutput(query, [{ id: "bing", ok: true, resultCount: results.length }], results, maxResults);
}

export function mergeWebSearchOutputs(query: string, outputs: WebSearchOutput[], maxResults: number): WebSearchOutput {
  const sources = outputs.flatMap((output) => output.sources);
  const results: WebSearchResult[] = [];

  for (const output of outputs) {
    for (const result of output.results) {
      const normalizedUrl = normalizeResultUrl(result.url);
      if (results.some((existing) => normalizeResultUrl(existing.url) === normalizedUrl)) {
        continue;
      }
      results.push({
        ...result,
        id: `result:${results.length + 1}`,
        citationId: `web:${results.length + 1}`
      });
      if (results.length >= maxResults) {
        break;
      }
    }
    if (results.length >= maxResults) {
      break;
    }
  }

  return buildSearchOutput(query, sources, results, maxResults);
}

export function searchErrorOutput(query: string, source: string, error: unknown): WebSearchOutput {
  return buildSearchOutput(
    query,
    [{ id: source, ok: false, resultCount: 0, error: error instanceof Error ? error.message : String(error) }],
    [],
    0
  );
}

function buildSearchOutput(
  query: string,
  sources: WebSearchSourceStatus[],
  results: WebSearchResult[],
  maxResults: number
): WebSearchOutput {
  const normalizedResults = results.slice(0, maxResults).map((result, index) => ({
    ...result,
    id: `result:${index + 1}`,
    citationId: `web:${index + 1}`
  }));

  return {
    query,
    source: sources.map((source) => source.id).join(","),
    sources,
    results: normalizedResults,
    citations: normalizedResults.map((result) => ({
      id: result.citationId,
      title: result.title,
      url: result.url,
      source: result.source,
      snippet: result.snippet
    })),
    truncated: results.length >= maxResults
  };
}

function toSearchResult(source: string, sourceRank: number, title: string, url: string, snippet: string): WebSearchResult {
  return {
    id: `result:${source}:${sourceRank}`,
    citationId: `web:${source}:${sourceRank}`,
    title,
    url,
    snippet,
    source,
    sourceRank
  };
}

function normalizeHttpUrl(url: string) {
  const parsed = new URL(url);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Only http(s) URLs are supported.");
  }
  return parsed.toString();
}

function isHttpUrl(value: string) {
  try {
    normalizeHttpUrl(value);
    return true;
  } catch {
    return false;
  }
}

function looksLikeHtml(contentType: string | undefined, body: string) {
  return contentType?.toLowerCase().includes("html") || /<html|<!doctype html|<body/i.test(body);
}

function extractTitle(html: string) {
  const match = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? cleanText(match[1]) : undefined;
}

function htmlToText(html: string) {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|section|article|header|footer|li|tr|h[1-6])>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function cleanText(value: string) {
  return htmlToText(value).replace(/\s+/g, " ").trim();
}

function firstSnippet(value: string) {
  const text = value.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 280) : undefined;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([a-f0-9]+);/gi, (_, code) => String.fromCharCode(Number.parseInt(code, 16)));
}

function decodeDuckDuckGoUrl(url: string) {
  try {
    const parsed = new URL(url, "https://duckduckgo.com");
    const uddg = parsed.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : parsed.toString();
  } catch {
    return url;
  }
}

function normalizeResultUrl(url: string) {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}
