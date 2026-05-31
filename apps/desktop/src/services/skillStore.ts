import { invoke } from "@tauri-apps/api/core";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { buildSkillMarkdown, validateSkillContent, validateSkillId, type SkillValidationIssue } from "./skillRegistry";
import { isTauriRuntime } from "./fileHost";

export type SkillTemplate = "general" | "review" | "ci" | "docs";

export interface SkillDraft {
  body: string;
  description: string;
  id: string;
  name: string;
  template: SkillTemplate;
}

export interface SkillPathResult {
  rootPath: string;
  skillPath: string;
}

export function createSkillMarkdownFromDraft(draft: SkillDraft) {
  return buildSkillMarkdown({
    name: draft.name,
    description: draft.description,
    body: draft.body || templateBody(draft.template, draft.name)
  });
}

export function validateSkillDraft(draft: SkillDraft, existingIds: string[] = []): SkillValidationIssue[] {
  const issues = [
    ...validateSkillId(draft.id),
    ...validateSkillContent(createSkillMarkdownFromDraft(draft))
  ];
  if (existingIds.includes(draft.id.trim())) {
    issues.push({ code: "skill_id_conflict", message: "这个技能 ID 已存在。", severity: "error" });
  }
  if (!draft.name.trim()) {
    issues.push({ code: "name_empty", message: "技能名称不能为空。", severity: "error" });
  }
  if (!draft.description.trim()) {
    issues.push({ code: "description_empty", message: "技能描述不能为空。", severity: "error" });
  }

  return dedupeIssues(issues);
}

export async function createSkill(draft: SkillDraft): Promise<SkillPathResult> {
  assertTauriSkillStore();
  return invoke<SkillPathResult>("skill_create", {
    id: draft.id.trim(),
    content: createSkillMarkdownFromDraft(draft)
  });
}

export async function updateSkill(input: { content: string; id: string }): Promise<SkillPathResult> {
  assertTauriSkillStore();
  return invoke<SkillPathResult>("skill_update", input);
}

export async function renameSkill(input: { fromId: string; toId: string }): Promise<SkillPathResult> {
  assertTauriSkillStore();
  return invoke<SkillPathResult>("skill_rename", input);
}

export async function trashSkill(id: string): Promise<void> {
  assertTauriSkillStore();
  await invoke("skill_trash", { id });
}

export async function openSkillFolder(rootPath: string): Promise<void> {
  if (!isTauriRuntime()) {
    throw new Error("浏览器预览不支持打开技能目录。");
  }
  await revealItemInDir(rootPath);
}

export function migrateDisabledSkillIdsAfterRename(disabledSkillIds: string[], fromId: string, toId: string) {
  return disabledSkillIds
    .map((id) => id === fromId ? toId : id)
    .filter((id, index, all) => all.indexOf(id) === index)
    .sort();
}

export function removeDisabledSkillId(disabledSkillIds: string[], removedId: string) {
  return disabledSkillIds.filter((id) => id !== removedId);
}

export function templateBody(template: SkillTemplate, name: string) {
  switch (template) {
    case "review":
      return [
        `# ${name}`,
        "",
        "Review the requested code with a focus on correctness, regressions, security, and missing tests.",
        "Lead with concrete findings and reference files or commands when relevant."
      ].join("\n");
    case "ci":
      return [
        `# ${name}`,
        "",
        "Investigate CI failures by locating the failing command, reproducing locally when possible, and making the smallest targeted fix.",
        "Summarize the root cause and the validation command that passed."
      ].join("\n");
    case "docs":
      return [
        `# ${name}`,
        "",
        "Create or update documentation with accurate project terminology, concise structure, and examples that match the repository."
      ].join("\n");
    case "general":
      return [
        `# ${name}`,
        "",
        "Describe when this skill should be used, what context to inspect first, and the workflow to follow."
      ].join("\n");
  }
}

function assertTauriSkillStore() {
  if (!isTauriRuntime()) {
    throw new Error("浏览器预览不支持管理本地技能，请在 Tauri 桌面端运行。");
  }
}

function dedupeIssues(issues: SkillValidationIssue[]) {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.message}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}
