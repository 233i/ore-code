import { describe, expect, it } from "vitest";
import type { ArtifactRecord } from "@seekforge/protocol";
import { executeRegisteredTool } from "./executor";
import { createArtifactTools, type ArtifactToolHost } from "./artifact-tools";
import { ToolRegistry } from "./registry";
import type { ToolContext } from "./spec";

const context: ToolContext = {
  workspacePath: "/workspace",
  mode: "plan",
  trustedWorkspace: false
};

describe("artifact tools", () => {
  it("reads the tail of a stored artifact by default", async () => {
    const result = await executeRegisteredTool(
      registryWithArtifacts(makeHost(textArtifact("artifact-1", "one\ntwo\nthree\nfour"))),
      "retrieve_tool_result",
      { artifactId: "artifact-1", maxLines: 2 },
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result).toMatchObject({
        ok: true,
        output: {
          mode: "tail",
          content: "three\nfour",
          totalLines: 4,
          returnedLines: { start: 3, end: 4 },
          truncated: true
        }
      });
    }
  });

  it("reads a line range from a stored artifact", async () => {
    const result = await executeRegisteredTool(
      registryWithArtifacts(makeHost(textArtifact("artifact-1", "one\ntwo\nthree\nfour"))),
      "retrieve_tool_result",
      { artifactId: "artifact-1", mode: "range", startLine: 2, endLine: 3 },
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.output).toMatchObject({
        content: "two\nthree",
        returnedLines: { start: 2, end: 3 },
        truncated: false
      });
    }
  });

  it("can read stdout or stderr from shell-log artifacts", async () => {
    const result = await executeRegisteredTool(
      registryWithArtifacts(makeHost(shellArtifact("artifact-1", "out-1\nout-2\n", "err-1\n"))),
      "retrieve_tool_result",
      { artifactId: "artifact-1", stream: "stderr", mode: "all" },
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.output).toMatchObject({
        stream: "stderr",
        content: "err-1\n"
      });
    }
  });

  it("returns a structured error for missing artifacts", async () => {
    const result = await executeRegisteredTool(
      registryWithArtifacts(makeHost()),
      "retrieve_tool_result",
      { artifactId: "missing" },
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result).toMatchObject({
        ok: false,
        error: { code: "artifact_not_found" }
      });
    }
  });

  it("caps large selected content by maxChars", async () => {
    const result = await executeRegisteredTool(
      registryWithArtifacts(makeHost(textArtifact("artifact-1", "abcdef"))),
      "retrieve_tool_result",
      { artifactId: "artifact-1", mode: "all", maxChars: 3 },
      context
    );

    expect(result.type).toBe("completed");
    if (result.type === "completed") {
      expect(result.result.output).toMatchObject({
        content: "abc",
        charTruncated: true,
        truncated: true
      });
    }
  });
});

function registryWithArtifacts(host: ArtifactToolHost) {
  const registry = new ToolRegistry();
  for (const tool of createArtifactTools(host)) {
    registry.register(tool);
  }
  return registry;
}

function makeHost(...artifacts: ArtifactRecord[]): ArtifactToolHost {
  const records = new Map(artifacts.map((artifact) => [artifact.id, artifact]));
  return {
    async read(id) {
      const artifact = records.get(id);
      if (!artifact) {
        throw new Error(`Artifact not found: ${id}`);
      }
      return artifact;
    }
  };
}

function textArtifact(id: string, content: string): ArtifactRecord {
  return {
    id,
    type: "text",
    size: content.length,
    createdAt: "2026-05-13T00:00:00.000Z",
    summary: "text artifact",
    content
  };
}

function shellArtifact(id: string, stdout: string, stderr: string): ArtifactRecord {
  const content = [`stdout\n${stdout}`, `stderr\n${stderr}`].join("\n\n");
  return {
    id,
    type: "shell-log",
    size: content.length,
    createdAt: "2026-05-13T00:00:00.000Z",
    summary: "shell artifact",
    sourceCallId: "exec-shell-1",
    content
  };
}
