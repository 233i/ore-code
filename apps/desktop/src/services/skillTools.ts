import { z } from "zod";
import type { ToolSpec } from "@ore-code/tools";
import { invoke } from "@tauri-apps/api/core";
import type { SkillPathResult } from "./skillStore";
import { validateSkillContent, validateSkillId } from "./skillRegistry";
import { isTauriRuntime } from "./fileHost";

export interface InstallSkillOutput extends SkillPathResult {
  installScope: "global";
}

const InstallSkillInputSchema = z.object({
  id: z.string().min(2).max(64),
  content: z.string().min(1)
});

type InstallSkillInput = z.infer<typeof InstallSkillInputSchema>;

type SkillInstaller = (input: InstallSkillInput) => Promise<SkillPathResult>;

export function createInstallSkillTool(installer: SkillInstaller = installSkillGlobally): ToolSpec<InstallSkillInput, InstallSkillOutput> {
  return {
    name: "install_skill",
    description: [
      "Install an Ore Code skill into the global user skill directory (~/.ore-code/skills).",
      "Use this instead of write_file, apply_patch, or shell commands when the user asks to install or create a skill.",
      "Never install skills into the selected workspace .ore-code/skills directory."
    ].join(" "),
    capability: "workspace-write",
    approval: "suggest",
    inputSchema: InstallSkillInputSchema,
    async execute(input) {
      const idIssues = validateSkillId(input.id);
      const contentIssues = validateSkillContent(input.content);
      const blockingIssue = [...idIssues, ...contentIssues].find((issue) => issue.severity === "error");
      if (blockingIssue) {
        return {
          callId: "install_skill",
          ok: false,
          error: {
            code: blockingIssue.code,
            message: blockingIssue.message
          }
        };
      }

      try {
        const result = await installer({ id: input.id.trim(), content: input.content });
        return {
          callId: "install_skill",
          ok: true,
          output: {
            ...result,
            installScope: "global"
          }
        };
      } catch (error) {
        return {
          callId: "install_skill",
          ok: false,
          error: {
            code: "skill_install_failed",
            message: error instanceof Error ? error.message : String(error)
          }
        };
      }
    }
  };
}

async function installSkillGlobally(input: InstallSkillInput) {
  if (!isTauriRuntime()) {
    throw new Error("浏览器预览不支持安装本地技能，请在 Tauri 桌面端运行。");
  }
  return invoke<SkillPathResult>("skill_create", {
    id: input.id,
    content: input.content
  });
}
