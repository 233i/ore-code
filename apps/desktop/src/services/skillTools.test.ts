import { describe, expect, it } from "vitest";
import { createInstallSkillTool } from "./skillTools";

describe("skillTools", () => {
  it("installs skills through the global skill installer", async () => {
    const calls: Array<{ content: string; id: string }> = [];
    const tool = createInstallSkillTool(async (input) => {
      calls.push(input);
      return {
        rootPath: `/Users/test/.ore-code/skills/${input.id}`,
        skillPath: `/Users/test/.ore-code/skills/${input.id}/SKILL.md`
      };
    });

    const result = await tool.execute({
      id: "reviewer",
      content: [
        "---",
        "name: Reviewer",
        "description: Review code",
        "---",
        "",
        "# Reviewer",
        "Review code."
      ].join("\n")
    }, { mode: "agent", trustedWorkspace: true, workspacePath: "/repo" });

    expect(result).toMatchObject({
      ok: true,
      output: {
        installScope: "global",
        skillPath: "/Users/test/.ore-code/skills/reviewer/SKILL.md"
      }
    });
    expect(calls).toEqual([
      expect.objectContaining({ id: "reviewer" })
    ]);
  });

  it("rejects invalid skill ids before writing", async () => {
    const tool = createInstallSkillTool(async () => {
      throw new Error("should not write");
    });

    const result = await tool.execute({
      id: "../bad",
      content: "# Bad\ncontent"
    }, { mode: "agent", trustedWorkspace: true, workspacePath: "/repo" });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: "skill_id_format"
      }
    });
  });
});
