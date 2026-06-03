import { describe, expect, it } from "vitest";
import { executeRegisteredTool } from "./executor";
import type { FileToolHost } from "./file-tools";
import { ToolRegistry } from "./registry";
import { createValidateDataTool, type ValidateDataOutput } from "./validate-data";
import type { ToolContext } from "./spec";

const context: ToolContext = {
  workspacePath: "/workspace",
  mode: "agent",
  trustedWorkspace: false
};

describe("validate_data tool", () => {
  it("validates inline JSON content", async () => {
    const result = await executeRegisteredTool(
      registryWithValidateData(makeHost()),
      "validate_data",
      { format: "json", content: "{\"name\":\"ore-code\"}" },
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.output).toMatchObject({
        valid: true,
        format: "json",
        topLevelType: "object",
        keyCount: 1
      });
    }
  });

  it("reads files and infers TOML format from path", async () => {
    const reads: Array<{ workspacePath: string; path: string }> = [];
    const result = await executeRegisteredTool(
      registryWithValidateData(makeHost(reads, "profile = \"default\"\n[context]\nenableCacheWarmup = true")),
      "validate_data",
      { path: ".ore-code/config.toml" },
      context
    );

    expect(reads).toEqual([{ workspacePath: "/workspace", path: ".ore-code/config.toml" }]);
    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.output).toMatchObject({
        valid: true,
        format: "toml",
        path: ".ore-code/config.toml"
      });
    }
  });

  it("validates YAML maps and lists", async () => {
    const result = await executeRegisteredTool(
      registryWithValidateData(makeHost()),
      "validate_data",
      {
        format: "yaml",
        content: [
          "servers:",
          "  - name: docs",
          "  - name: github"
        ].join("\n")
      },
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.output).toMatchObject({
        valid: true,
        format: "yaml",
        topLevelType: "object"
      });
    }
  });

  it("returns structured errors for invalid content", async () => {
    const result = await executeRegisteredTool(
      registryWithValidateData(makeHost()),
      "validate_data",
      { format: "json", content: "{\"name\":" },
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      const output = result.result.output as ValidateDataOutput;
      expect(output.valid).toBe(false);
      expect(output.errors[0].message).toContain("JSON");
      expect(output.summary).toContain("invalid");
    }
  });

  it("flags invalid YAML indentation or shape", async () => {
    const result = await executeRegisteredTool(
      registryWithValidateData(makeHost()),
      "validate_data",
      {
        format: "yaml",
        content: [
          "servers:",
          "  - docs",
          "  name: misplaced"
        ].join("\n")
      },
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.output).toMatchObject({ valid: false, format: "yaml" });
    }
  });
});

function registryWithValidateData(host: FileToolHost) {
  const registry = new ToolRegistry();
  registry.register(createValidateDataTool(host));
  return registry;
}

function makeHost(
  reads: Array<{ workspacePath: string; path: string }> = [],
  content = "{\"ok\":true}"
): FileToolHost {
  return {
    async readText(input) {
      reads.push(input);
      return { path: input.path, content };
    },
    async listDir() {
      return { entries: [] };
    },
    async searchFiles() {
      return { matches: [], truncated: false };
    },
    async grepFiles() {
      return { matches: [], truncated: false };
    },
    async writeText(input) {
      return { path: input.path, bytesWritten: input.content.length };
    }
  };
}
