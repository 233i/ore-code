import { describe, expect, it } from "vitest";
import type { FileToolHost } from "@ore-code/tools";
import { renderSkillIndex, renderSkillPromptFromCommand, scanUserSkills, skillSlashCommands, suggestSkillsForPrompt, userSkillRootPath, type SkillRecord } from "./skillRegistry";

describe("skillRegistry", () => {
  it("scans user-level SKILL.md files and maps enabled skills to slash commands", async () => {
    const result = await scanUserSkills({
      disabledSkillIds: [],
      fileHost: makeSkillHost({
        ".ore-code/skills/reviewer/SKILL.md": [
          "---",
          "name: Reviewer",
          "description: Review current changes",
          "---",
          "# Reviewer",
          "Check bugs and tests."
        ].join("\n")
      }),
      userHomePath: "/Users/test"
    });

    expect(result.errors).toEqual([]);
    expect(result.skills[0]).toMatchObject({
      enabled: true,
      id: "reviewer",
      name: "Reviewer",
      description: "Review current changes"
    });

    const [command] = skillSlashCommands(result.skills);
    expect(command).toMatchObject({
      name: "/reviewer",
      skillId: "reviewer",
      lazyContext: expect.objectContaining({
        source: "skill",
        sourceId: "reviewer",
        content: expect.stringContaining("Check bugs and tests.")
      })
    });
    expect(renderSkillPromptFromCommand(command, "src/App.tsx")).toContain("# 用户任务\nsrc/App.tsx");
    expect(renderSkillPromptFromCommand(command, "src/App.tsx")).not.toContain("Check bugs and tests.");
    expect(renderSkillIndex(result.skills)).toContain("/reviewer: Reviewer");
    expect(renderSkillIndex(result.skills)).toContain("resources: 无资源");
  });

  it("does not expose disabled skills as slash commands", async () => {
    const result = await scanUserSkills({
      disabledSkillIds: ["reviewer"],
      fileHost: makeSkillHost({
        ".ore-code/skills/reviewer/SKILL.md": "# Reviewer\nReview current changes."
      }),
      userHomePath: "/Users/test"
    });

    expect(result.skills[0].enabled).toBe(false);
    expect(skillSlashCommands(result.skills)).toEqual([]);
  });

  it("reports missing SKILL.md files without blocking valid skills", async () => {
    const result = await scanUserSkills({
      disabledSkillIds: [],
      fileHost: makeSkillHost({
        ".ore-code/skills/good/SKILL.md": "# Good\nUseful skill."
      }, ["bad"]),
      userHomePath: "/Users/test"
    });

    expect(result.skills.map((skill) => skill.id)).toEqual(["good"]);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].path).toBe(".ore-code/skills/bad/SKILL.md");
  });

  it("treats a missing skills root as an empty skill catalog", async () => {
    const result = await scanUserSkills({
      disabledSkillIds: [],
      fileHost: {
        ...makeSkillHost({}),
        async listDir() {
          throw new Error("No such file or directory");
        }
      },
      userHomePath: "/Users/test"
    });

    expect(result).toEqual({ errors: [], skills: [] });
  });

  it("falls back to scanning the absolute skills root when the relative root is empty", async () => {
    const calls: Array<{ path: string; workspacePath: string }> = [];
    const result = await scanUserSkills({
      disabledSkillIds: [],
      fileHost: {
        ...makeSkillHost({}),
        async listDir(input) {
          calls.push({ workspacePath: input.workspacePath, path: input.path });
          if (input.workspacePath === "/Users/test" && input.path === ".ore-code/skills") {
            return { entries: [] };
          }
          if (input.workspacePath === "/Users/test/.ore-code/skills" && input.path === ".") {
            return {
              entries: [
                {
                  name: "find-skills",
                  path: "/Users/test/.ore-code/skills/find-skills",
                  isDir: true
                }
              ]
            };
          }

          return { entries: [] };
        },
        async readText(input) {
          if (input.path !== "/Users/test/.ore-code/skills/find-skills/SKILL.md") {
            throw new Error(`missing file: ${input.path}`);
          }

          return {
            path: input.path,
            content: [
              "---",
              "name: Find Skills",
              "description: Find installable skills",
              "---",
              "# Find Skills",
              "Locate useful skills."
            ].join("\n")
          };
        }
      },
      userHomePath: "/Users/test"
    });

    expect(calls).toContainEqual({ workspacePath: "/Users/test", path: ".ore-code/skills" });
    expect(calls).toContainEqual({ workspacePath: "/Users/test/.ore-code/skills", path: "." });
    expect(result.errors).toEqual([]);
    expect(result.skills).toHaveLength(1);
    expect(result.skills[0]).toMatchObject({
      id: "find-skills",
      name: "Find Skills",
      rootPath: "/Users/test/.ore-code/skills/find-skills"
    });
  });

  it("uses Windows path separators when scanning user skills on Windows", async () => {
    const calls: Array<{ path: string; workspacePath: string }> = [];
    const result = await scanUserSkills({
      disabledSkillIds: [],
      fileHost: {
        ...makeSkillHost({}),
        async listDir(input) {
          calls.push({ workspacePath: input.workspacePath, path: input.path });
          if (input.workspacePath === "C:\\Users\\test" && input.path === ".ore-code\\skills") {
            return { entries: [] };
          }
          if (input.workspacePath === "C:\\Users\\test\\.ore-code\\skills" && input.path === ".") {
            return {
              entries: [
                {
                  name: "find-skills",
                  path: "C:\\Users\\test\\.ore-code\\skills\\find-skills",
                  isDir: true
                }
              ]
            };
          }

          return { entries: [] };
        },
        async readText(input) {
          if (input.path !== "C:\\Users\\test\\.ore-code\\skills\\find-skills\\SKILL.md") {
            throw new Error(`missing file: ${input.path}`);
          }

          return {
            path: input.path,
            content: "# Find Skills\nLocate useful skills."
          };
        }
      },
      userHomePath: "C:\\Users\\test"
    });

    expect(calls).toContainEqual({ workspacePath: "C:\\Users\\test", path: ".ore-code\\skills" });
    expect(calls).toContainEqual({ workspacePath: "C:\\Users\\test\\.ore-code\\skills", path: "." });
    expect(result.errors).toEqual([]);
    expect(result.skills[0]).toMatchObject({
      id: "find-skills",
      rootPath: "C:\\Users\\test\\.ore-code\\skills\\find-skills",
      skillPath: "C:\\Users\\test\\.ore-code\\skills\\find-skills\\SKILL.md"
    });
  });

  it("formats the global skill root with platform separators", () => {
    expect(userSkillRootPath("/Users/test")).toBe("/Users/test/.ore-code/skills");
    expect(userSkillRootPath("C:\\Users\\test")).toBe("C:\\Users\\test\\.ore-code\\skills");
  });

  it("suggests skills by id, name, and description", () => {
    const skills = [
      skill({ id: "reviewer", name: "Reviewer", description: "Review current changes" }),
      skill({ id: "ci-debug", name: "CI Debug", description: "Debug failing GitHub Actions" }),
      skill({ id: "docs", name: "Documents", description: "Create document files" })
    ];

    expect(suggestSkillsForPrompt("reviewer please", skills)).toEqual([
      { id: "reviewer", name: "Reviewer", reason: "匹配技能 ID" }
    ]);
    expect(suggestSkillsForPrompt("CI Debug this failure", skills)).toEqual([
      { id: "ci-debug", name: "CI Debug", reason: "匹配技能名称" }
    ]);
    expect(suggestSkillsForPrompt("failing workflow", skills)).toEqual([
      { id: "ci-debug", name: "CI Debug", reason: "匹配技能说明" }
    ]);
  });

  it("does not suggest skills for slash commands or disabled skills", () => {
    const skills = [
      skill({ id: "reviewer", name: "Reviewer", description: "Review current changes", enabled: false }),
      skill({ id: "ci-debug", name: "CI Debug", description: "Debug failing GitHub Actions" })
    ];

    expect(suggestSkillsForPrompt("/reviewer src/App.tsx", skills)).toEqual([]);
    expect(suggestSkillsForPrompt("reviewer", skills)).toEqual([]);
  });
});

function skill(input: Pick<SkillRecord, "id" | "name" | "description"> & { enabled?: boolean }): SkillRecord {
  return {
    content: "# Skill",
    resourceSummary: "无资源",
    resources: [],
    rootPath: `.ore-code/skills/${input.id}`,
    skillPath: `.ore-code/skills/${input.id}/SKILL.md`,
    updatedAt: null,
    validationIssues: [],
    enabled: input.enabled ?? true,
    ...input
  };
}

function makeSkillHost(files: Record<string, string>, extraRoots: string[] = []): FileToolHost {
  return {
    async readText(input) {
      if (!(input.path in files)) {
        throw new Error(`missing file: ${input.path}`);
      }

      return { path: input.path, content: files[input.path] };
    },
    async listDir(input) {
      if (input.path !== ".ore-code/skills") {
        return { entries: [] };
      }

      const roots = new Set([
        ...Object.keys(files)
          .filter((path) => path.startsWith(".ore-code/skills/"))
          .map((path) => path.split("/").slice(0, 3).join("/")),
        ...extraRoots.map((root) => `.ore-code/skills/${root}`)
      ]);

      return {
        entries: [...roots].map((path) => ({
          name: path.split("/").slice(-1)[0] ?? path,
          path,
          isDir: true
        }))
      };
    },
    async searchFiles() {
      return { matches: [], truncated: false };
    },
    async grepFiles() {
      return { matches: [], truncated: false };
    },
    async writeText(input) {
      files[input.path] = input.content;
      return { path: input.path, bytesWritten: input.content.length };
    }
  };
}
