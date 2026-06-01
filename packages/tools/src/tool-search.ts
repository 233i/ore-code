import { z } from "zod";
import type { ToolCapability, ApprovalRequirement } from "@ore-code/protocol";
import type { ToolRegistry } from "./registry";
import type { ToolSpec } from "./spec";

const ToolSearchInputSchema = z.object({
  query: z.string().min(1).optional(),
  capability: z.string().min(1).optional(),
  maxResults: z.number().int().positive().max(100).optional()
});

export interface ToolSearchResult {
  name: string;
  description: string;
  capability: ToolCapability;
  approval: ApprovalRequirement;
  score: number;
}

export interface ToolSearchOutput {
  query: string;
  results: ToolSearchResult[];
  totalTools: number;
  truncated: boolean;
}

export function createToolSearchTool(registry: ToolRegistry): ToolSpec<z.infer<typeof ToolSearchInputSchema>, ToolSearchOutput> {
  return {
    name: "tool_search",
    description: "Search the currently registered tools by name, description, capability, or approval requirement.",
    capability: "readonly",
    approval: "never",
    inputSchema: ToolSearchInputSchema,
    async execute(input) {
      const query = input.query?.trim() ?? "";
      const capability = input.capability?.trim().toLowerCase();
      const maxResults = input.maxResults ?? 20;
      const tools = registry.list();
      const ranked = tools
        .map((tool) => scoreTool(tool, query, capability))
        .filter((item) => item.score > 0)
        .sort((left, right) => right.score - left.score || left.tool.name.localeCompare(right.tool.name));
      const results = ranked.slice(0, maxResults).map(({ tool, score }) => ({
        name: tool.name,
        description: tool.description,
        capability: tool.capability,
        approval: tool.approval,
        score
      }));

      return {
        callId: "tool_search",
        ok: true,
        output: {
          query,
          results,
          totalTools: tools.length,
          truncated: ranked.length > results.length
        }
      };
    }
  };
}

function scoreTool(tool: ToolSpec, query: string, capability: string | undefined) {
  if (capability && tool.capability.toLowerCase() !== capability) {
    return { tool, score: 0 };
  }

  const normalizedQuery = query.toLowerCase();
  const haystack = `${tool.name} ${tool.description} ${tool.capability} ${tool.approval}`.toLowerCase();
  if (!normalizedQuery) {
    return { tool, score: 1 };
  }

  let score = 0;
  if (tool.name.toLowerCase() === normalizedQuery) score += 100;
  if (tool.name.toLowerCase().includes(normalizedQuery)) score += 50;
  for (const term of normalizedQuery.split(/\s+/).filter(Boolean)) {
    if (tool.name.toLowerCase().includes(term)) score += 20;
    if (haystack.includes(term)) score += 5;
  }
  return { tool, score };
}
