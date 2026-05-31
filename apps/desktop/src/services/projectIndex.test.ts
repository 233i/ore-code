import { describe, expect, it } from "vitest";
import type { FileToolHost } from "@seekforge/tools";
import { buildProjectIndexContext, createMemoryProjectIndexStore, refreshProjectIndex } from "./projectIndex";

describe("projectIndex", () => {
  it("does not inject codebase context for short conversational prompts", async () => {
    const result = await buildProjectIndexContext({
      fileHost: makeHost({
        "src/App.tsx": "export function App() { return null; }"
      }),
      prompt: "你是谁",
      priorEvents: [],
      trackedChanges: [],
      workspacePath: "/repo"
    });

    expect(result.block).toBe("");
    expect(result.semanticIndex).toBeNull();
    expect(result.relevantFiles).toEqual([]);
  });

  it("retrieves relevant files, symbols, and recent working set hints", async () => {
    const host = makeHost({
      "apps/desktop/src/App.tsx": [
        "export function App() {",
        "  return null;",
        "}",
        "export function refreshSkills() {}"
      ].join("\n"),
      "apps/desktop/src/services/skillRegistry.ts": [
        "export function scanUserSkills() {}",
        "export interface SkillRecord {}"
      ].join("\n"),
      "apps/desktop/src/services/skillRegistry.test.ts": "it('scans skills', () => {})"
    });

    const result = await buildProjectIndexContext({
      fileHost: host,
      prompt: "修复 skillRegistry 刷新技能后 App.tsx 状态丢失",
      priorEvents: [
        {
          id: "event-1",
          seq: 1,
          threadId: "thread",
          turnId: "turn",
          createdAt: "2026-05-24T00:00:00.000Z",
          type: "file_changed",
          path: "apps/desktop/src/App.tsx",
          changeKind: "updated"
        }
      ],
      trackedChanges: [],
      workspacePath: "/repo"
    });

    expect(result.queryTerms).toContain("skillregistry");
    expect(result.recentPaths).toContain("apps/desktop/src/App.tsx");
    expect(result.relevantFiles.map((file) => file.path)).toContain("apps/desktop/src/App.tsx");
    expect(result.relevantFiles.map((file) => file.path)).toContain("apps/desktop/src/services/skillRegistry.ts");
    expect(result.block).toContain("<codebase_context>");
    expect(result.block).toContain("scanUserSkills");
    expect(result.block).toContain("Recent working set:");
  });

  it("uses tracked changes to suggest impacted test files", async () => {
    const host = makeHost({
      "src/foo.ts": "export function foo() {}",
      "src/foo.test.ts": "import { foo } from './foo';"
    });

    const result = await buildProjectIndexContext({
      fileHost: host,
      prompt: "继续修复 foo",
      priorEvents: [],
      trackedChanges: [
        {
          additions: 1,
          afterContent: "export function foo() { return 1; }",
          beforeContent: "export function foo() {}",
          changeKind: "updated",
          deletions: 1,
          diff: "",
          existedBefore: true,
          id: "change-1",
          path: "src/foo.ts",
          undoable: true
        }
      ],
      workspacePath: "/repo"
    });

    expect(result.relevantFiles.map((file) => file.path)).toContain("src/foo.ts");
    expect(result.block).toContain("src/foo.test.ts");
    expect(result.block).toContain("可能受 src/foo.ts 影响");
  });

  it("reuses the persisted vector index for semantic retrieval", async () => {
    const store = createMemoryProjectIndexStore();
    const firstHost = makeHost({
      "src/auth/session.ts": [
        "export function refreshSessionToken() {",
        "  return loginWithCachedCredentials();",
        "}",
        "function loginWithCachedCredentials() {",
        "  return 'token';",
        "}"
      ].join("\n")
    });

    const refresh = await refreshProjectIndex({
      fileHost: firstHost,
      store,
      workspacePath: "/repo"
    });

    expect(refresh).toMatchObject({ documentCount: 1, status: "ready" });

    const second = await buildProjectIndexContext({
      fileHost: makeHost({}),
      prompt: "refresh token login flow",
      priorEvents: [],
      store,
      trackedChanges: [],
      workspacePath: "/repo"
    });

    expect(second.semanticIndex).toMatchObject({ documentCount: 1, source: "cache" });
    expect(second.relevantFiles.map((file) => file.path)).toContain("src/auth/session.ts");
    expect(second.block).toContain("Persistent vector index: 1 files");
    expect(second.block).toContain("语义向量匹配");
  });

  it("does not build the semantic index synchronously on the turn path when cache is empty", async () => {
    const result = await buildProjectIndexContext({
      fileHost: makeHost({
        "src/auth/session.ts": "export function refreshSessionToken() { return 'token'; }"
      }),
      prompt: "refresh token login flow",
      priorEvents: [],
      store: createMemoryProjectIndexStore(),
      trackedChanges: [],
      workspacePath: "/repo"
    });

    expect(result.semanticIndex).toBeNull();
    expect(result.block).not.toContain("Persistent vector index");
    expect(result.relevantFiles.map((file) => file.path)).toContain("src/auth/session.ts");
  });

  it("refreshes the persistent index incrementally by reusing unchanged documents", async () => {
    const store = createMemoryProjectIndexStore();
    const files = {
      "src/a.ts": "export function alphaFeature() { return 1; }",
      "src/b.ts": "export function betaFeature() { return 2; }"
    };
    const host = makeHost(files);

    const first = await refreshProjectIndex({ fileHost: host, store, workspacePath: "/repo" });

    expect(first).toMatchObject({
      documentCount: 2,
      rebuiltDocuments: 2,
      reusedDocuments: 0,
      status: "ready"
    });

    const second = await refreshProjectIndex({ fileHost: host, store, workspacePath: "/repo" });

    expect(second).toMatchObject({
      documentCount: 2,
      rebuiltDocuments: 0,
      reusedDocuments: 2,
      status: "ready"
    });

    files["src/b.ts"] = "export function betaFeature() { return 3; }";
    const third = await refreshProjectIndex({ fileHost: host, store, workspacePath: "/repo" });

    expect(third).toMatchObject({
      documentCount: 2,
      rebuiltDocuments: 1,
      reusedDocuments: 1,
      status: "ready"
    });
  });

  it("indexes imports and references for symbol graph impact analysis", async () => {
    const store = createMemoryProjectIndexStore();
    const host = makeHost({
      "src/App.tsx": [
        "import { scanUserSkills } from './services/skillRegistry';",
        "export function App() {",
        "  scanUserSkills();",
        "  return null;",
        "}"
      ].join("\n"),
      "src/services/skillRegistry.ts": [
        "export function scanUserSkills() {",
        "  return [];",
        "}"
      ].join("\n")
    });

    await refreshProjectIndex({ fileHost: host, store, workspacePath: "/repo" });
    const index = await store.load("/repo");
    const appDocument = index?.documents.find((document) => document.path === "src/App.tsx");

    expect(appDocument?.dependencies).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "import", target: "./services/skillRegistry" })
      ])
    );
    expect(appDocument?.references).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "call", name: "scanUserSkills" })
      ])
    );

    const result = await buildProjectIndexContext({
      fileHost: host,
      prompt: "修改 src/services/skillRegistry.ts",
      priorEvents: [],
      store,
      trackedChanges: [],
      workspacePath: "/repo"
    });

    expect(result.graph?.impactedFiles.map((file) => file.path)).toContain("src/App.tsx");
    expect(result.relevantFiles.map((file) => file.path)).toContain("src/App.tsx");
    expect(result.block).toContain("Symbol graph / impact:");
    expect(result.block).toContain("src/App.tsx -> src/services/skillRegistry.ts");
  });

  it("uses symbol names to find definitions and callers from the graph", async () => {
    const store = createMemoryProjectIndexStore();
    const host = makeHost({
      "src/App.tsx": [
        "import { scanUserSkills } from './services/skillRegistry';",
        "export function App() {",
        "  scanUserSkills();",
        "}"
      ].join("\n"),
      "src/services/skillRegistry.ts": "export function scanUserSkills() { return []; }"
    });

    await refreshProjectIndex({ fileHost: host, store, workspacePath: "/repo" });

    const result = await buildProjectIndexContext({
      fileHost: host,
      prompt: "scanUserSkills 调用方",
      priorEvents: [],
      store,
      trackedChanges: [],
      workspacePath: "/repo"
    });

    expect(result.relevantFiles.map((file) => file.path)).toContain("src/services/skillRegistry.ts");
    expect(result.relevantFiles.map((file) => file.path)).toContain("src/App.tsx");
    expect(result.block).toContain("references scanUserSkills");
  });
});

function makeHost(files: Record<string, string>): FileToolHost {
  return {
    async readText(input) {
      const content = files[input.path];
      if (content === undefined) {
        throw new Error(`missing file: ${input.path}`);
      }
      return { path: input.path, content };
    },
    async listDir() {
      return { entries: [] };
    },
    async searchFiles(input) {
      const query = input.query.toLowerCase();
      return {
        matches: Object.keys(files)
          .filter((path) => path.toLowerCase().includes(query))
          .slice(0, input.maxResults ?? 50)
          .map((path) => ({
            isDir: false,
            name: path.split(/[\\/]/).pop() ?? path,
            path,
            size: files[path].length
          })),
        truncated: false
      };
    },
    async grepFiles(input) {
      const pattern = input.pattern.toLowerCase();
      const matches = [];
      for (const [path, content] of Object.entries(files)) {
        const lines = content.split(/\r?\n/);
        for (let index = 0; index < lines.length; index += 1) {
          const line = lines[index];
          const matchStart = line.toLowerCase().indexOf(pattern);
          if (matchStart >= 0) {
            matches.push({
              line,
              lineNumber: index + 1,
              matchEnd: matchStart + input.pattern.length,
              matchStart,
              path
            });
          }
        }
      }
      return { matches: matches.slice(0, input.maxResults ?? 50), truncated: false };
    },
    async writeText(input) {
      files[input.path] = input.content;
      return { path: input.path, bytesWritten: input.content.length };
    }
  };
}
