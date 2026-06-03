import type { FileToolHost } from "@ore-code/tools";
import type { SlashCommand } from "../ui/slashCommands";

export interface SkillRecord {
  content: string;
  description: string;
  enabled: boolean;
  id: string;
  name: string;
  resourceSummary: string;
  resources: SkillResourceRecord[];
  rootPath: string;
  skillPath: string;
  updatedAt: string | null;
  validationIssues: SkillValidationIssue[];
}

export interface SkillScanError {
  path: string;
  message: string;
}

export interface SkillScanResult {
  errors: SkillScanError[];
  skills: SkillRecord[];
}

export interface SkillSuggestion {
  id: string;
  name: string;
  reason: string;
}

export type SkillResourceKind = "script" | "example" | "template";

export interface SkillResourceRecord {
  kind: SkillResourceKind;
  name: string;
  path: string;
  preview: string;
  readable: boolean;
  size?: number;
}

export interface SkillValidationIssue {
  code: string;
  message: string;
  severity: "error" | "warning";
}

export const USER_SKILL_ROOT_PATH = ".ore-code/skills";
const SKILL_FILE_NAME = "SKILL.md";
const RESOURCE_PREVIEW_LIMIT = 4096;
const RESOURCE_KINDS: Array<{ dir: string; kind: SkillResourceKind; label: string }> = [
  { dir: "scripts", kind: "script", label: "scripts" },
  { dir: "examples", kind: "example", label: "examples" },
  { dir: "templates", kind: "template", label: "templates" }
];

export async function scanUserSkills(input: {
  disabledSkillIds: string[];
  fileHost: FileToolHost;
  userHomePath: string;
}): Promise<SkillScanResult> {
  const errors: SkillScanError[] = [];
  const disabledSkillIds = new Set(input.disabledSkillIds);
  const rootCandidates = skillRootCandidates(input.userHomePath);
  let entries;
  let activeRoot = rootCandidates[0];

  for (const candidate of rootCandidates) {
    try {
      const candidateEntries = await input.fileHost.listDir({
        workspacePath: candidate.workspacePath,
        path: candidate.path
      });
      entries = candidateEntries;
      activeRoot = candidate;
      if (candidateEntries.entries.some((entry) => entry.isDir)) {
        break;
      }
    } catch (error) {
      if (isMissingSkillRoot(error)) {
        continue;
      }

      return {
        errors: [{ path: candidate.label, message: errorMessage(error) }],
        skills: []
      };
    }
  }

  if (!entries) {
    return { errors: [], skills: [] };
  }

  const skills: SkillRecord[] = [];
  const skillRoots = entries.entries.filter((entry) => entry.isDir);

  for (const root of skillRoots) {
    const skillPath = joinWorkspacePath(root.path, SKILL_FILE_NAME);
    try {
      const raw = await input.fileHost.readText({ workspacePath: activeRoot.workspacePath, path: skillPath });
      const id = normalizeSkillId(root.name || pathBasename(root.path) || root.path);
      const metadata = parseSkillMarkdown(raw.content, id);
      const resources = await scanSkillResources({
        fileHost: input.fileHost,
        rootPath: root.path,
        userHomePath: activeRoot.workspacePath
      });
      skills.push({
        content: raw.content,
        description: metadata.description,
        enabled: !disabledSkillIds.has(id),
        id,
        name: metadata.name,
        resources,
        resourceSummary: summarizeResources(resources),
        rootPath: root.path,
        skillPath,
        updatedAt: null,
        validationIssues: validateSkillContent(raw.content)
      });
    } catch (error) {
      errors.push({ path: skillPath, message: errorMessage(error) });
    }
  }

  skills.sort((left, right) => left.name.localeCompare(right.name));
  return { errors, skills };
}

function skillRootCandidates(userHomePath: string) {
  const relativeRoot = relativeSkillRootPath(userHomePath);
  const absoluteRoot = userSkillRootPath(userHomePath);
  return [
    {
      label: `~/${USER_SKILL_ROOT_PATH}`,
      path: relativeRoot,
      workspacePath: userHomePath
    },
    {
      label: absoluteRoot,
      path: ".",
      workspacePath: absoluteRoot
    }
  ];
}

export function userSkillRootPath(userHomePath: string) {
  return joinWorkspacePath(userHomePath, relativeSkillRootPath(userHomePath));
}

export function skillSlashCommands(records: SkillRecord[]): SlashCommand[] {
  return records
    .filter((record) => record.enabled)
    .map((record) => ({
      category: "tools" as const,
      name: `/${record.id}`,
      description: `使用技能：${record.name}`,
      usage: `/${record.id} [task]`,
      skillId: record.id,
      lazyContext: renderSkillLazyContext(record),
      skillPrompt: renderSkillPrompt(record, "{{args}}")
    }));
}

export function renderSkillPromptFromCommand(command: SlashCommand, args: string): string | null {
  if (!command.skillPrompt) {
    return null;
  }

  return command.skillPrompt
    .replace(/\{\{args\}\}/g, args)
    .replace(/\{\{ input \}\}/g, args)
    .replace(/\{\{input\}\}/g, args)
    .trim();
}

export function suggestSkillsForPrompt(prompt: string, records: SkillRecord[], max = 3): SkillSuggestion[] {
  const query = prompt.trim().toLowerCase();
  if (!query || query.startsWith("/")) {
    return [];
  }

  const suggestions: SkillSuggestion[] = [];
  for (const record of records) {
    if (!record.enabled) {
      continue;
    }

    const reason = skillMatchReason(query, record);
    if (!reason) {
      continue;
    }

    suggestions.push({ id: record.id, name: record.name, reason });
    if (suggestions.length >= max) {
      break;
    }
  }

  return suggestions;
}

function renderSkillPrompt(skill: SkillRecord, argsToken: string) {
  return [
    `请使用已加载的 Ore Code Skill 完成用户任务。`,
    "",
    `# Skill: ${skill.name}`,
    `ID：/${skill.id}`,
    skill.description ? `说明：${skill.description}` : "说明：无",
    "技能正文通过 lazy_context_loaded 注入 Conversation Ledger；不要把技能正文复制进当前用户消息。",
    "",
    "# 用户任务",
    argsToken
  ].filter(Boolean).join("\n");
}

export function renderSkillIndex(records: SkillRecord[]): string {
  const enabled = records.filter((record) => record.enabled);
  if (enabled.length === 0) {
    return "";
  }
  return [
    "Skills:",
    ...enabled.map((skill) => [
      `- /${skill.id}: ${skill.name}`,
      skill.description ? `  description: ${oneLine(skill.description, 180)}` : "",
      `  resources: ${skill.resourceSummary}`,
      skill.resources.length > 0
        ? `  resource_index: ${skill.resources.map((resource) => `${resource.kind}:${resource.path}`).join(", ")}`
        : ""
    ].filter(Boolean).join("\n"))
  ].join("\n");
}

function renderSkillLazyContext(skill: SkillRecord): NonNullable<SlashCommand["lazyContext"]> {
  return {
    source: "skill",
    sourceId: skill.id,
    title: `Skill /${skill.id}: ${skill.name}`,
    summary: skill.description || skillExcerpt(skill.content) || `Ore Code skill ${skill.id}`,
    content: [
      `# Skill: ${skill.name}`,
      `ID: /${skill.id}`,
      skill.description ? `Description: ${skill.description}` : "",
      "",
      "## SKILL.md",
      "```markdown",
      skill.content.trim(),
      "```",
      renderSkillResourceIndex(skill)
    ].filter(Boolean).join("\n")
  };
}

function skillMatchReason(query: string, skill: SkillRecord) {
  if (skill.id.toLowerCase().includes(query) || query.includes(skill.id.toLowerCase())) {
    return "匹配技能 ID";
  }

  if (skill.name.toLowerCase().includes(query) || query.includes(skill.name.toLowerCase())) {
    return "匹配技能名称";
  }

  const description = skill.description.toLowerCase();
  if (description && (description.includes(query) || query.split(/\s+/).some((word) => word.length >= 3 && description.includes(word)))) {
    return "匹配技能说明";
  }

  const bodyHeadings = [...stripFrontmatter(skill.content).matchAll(/^#{1,3}\s+(.+)$/gm)]
    .map((match) => match[1])
    .join(" ")
    .toLowerCase();
  if (textMatchesQuery(bodyHeadings, query)) {
    return "匹配技能内容";
  }

  if (skill.resources.some((resource) => textMatchesQuery(`${resource.name} ${resource.path}`, query))) {
    return "匹配技能资源";
  }

  return null;
}

function parseSkillMarkdown(content: string, fallbackId: string) {
  const frontmatter = parseFrontmatter(content);
  const body = frontmatter.body;
  const heading = /^#\s+(.+)$/m.exec(body)?.[1]?.trim();
  const firstParagraph = body
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line && !line.startsWith("#"));

  return {
    name: frontmatter.values.name || heading || humanizeSkillId(fallbackId),
    description: frontmatter.values.description || firstParagraph || ""
  };
}

function parseFrontmatter(content: string) {
  if (!content.startsWith("---")) {
    return { body: content, values: {} as Record<string, string>, issues: [] as SkillValidationIssue[], hasFrontmatter: false };
  }

  const end = content.indexOf("\n---", 3);
  if (end === -1) {
    return {
      body: content,
      values: {} as Record<string, string>,
      issues: [{ code: "frontmatter_unclosed", message: "frontmatter 缺少结束 ---。", severity: "warning" as const }],
      hasFrontmatter: true
    };
  }

  const raw = content.slice(3, end).trim();
  const values: Record<string, string> = {};
  const issues: SkillValidationIssue[] = [];
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }
    const match = /^([A-Za-z][A-Za-z0-9_-]*):\s*(.+)$/.exec(line.trim());
    if (match) {
      values[match[1]] = match[2].replace(/^["']|["']$/g, "").trim();
    } else {
      issues.push({ code: "frontmatter_syntax", message: `frontmatter 行格式无法解析：${line.trim()}`, severity: "warning" });
    }
  }

  return { body: content.slice(end + 4), values, issues, hasFrontmatter: true };
}

function normalizeSkillId(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "") || "skill";
}

function humanizeSkillId(value: string) {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}

function joinWorkspacePath(root: string, child: string) {
  const separator = pathSeparatorFor(root);
  const trimmedRoot = root.replace(/[\\/]+$/, "");
  const normalizedChild = child.split(/[\\/]+/).filter(Boolean).join(separator);
  return trimmedRoot ? `${trimmedRoot}${separator}${normalizedChild}` : normalizedChild;
}

function relativeSkillRootPath(referencePath: string) {
  return USER_SKILL_ROOT_PATH.split("/").join(pathSeparatorFor(referencePath));
}

function pathBasename(path: string) {
  return path.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? path;
}

function pathSeparatorFor(path: string) {
  return isWindowsLikePath(path) ? "\\" : "/";
}

function isWindowsLikePath(path: string) {
  return /^[A-Za-z]:[\\/]/.test(path) || path.includes("\\");
}

export function validateSkillId(value: string): SkillValidationIssue[] {
  const id = value.trim();
  const issues: SkillValidationIssue[] = [];
  if (id.length < 2 || id.length > 64) {
    issues.push({ code: "skill_id_length", message: "技能 ID 长度必须为 2-64 个字符。", severity: "error" });
  }
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(id)) {
    issues.push({ code: "skill_id_format", message: "技能 ID 只能使用小写字母、数字和连字符，且不能以连字符开头或结尾。", severity: "error" });
  }
  return issues;
}

export function validateSkillContent(content: string): SkillValidationIssue[] {
  const frontmatter = parseFrontmatter(content);
  const body = frontmatter.body.trim();
  const issues: SkillValidationIssue[] = [...frontmatter.issues];

  if (!frontmatter.hasFrontmatter) {
    issues.push({ code: "frontmatter_missing", message: "缺少标准 frontmatter，旧技能仍可使用。", severity: "warning" });
  }
  if (!frontmatter.values.name) {
    issues.push({ code: "name_missing", message: "建议在 frontmatter 中声明 name。", severity: "warning" });
  }
  if (!frontmatter.values.description) {
    issues.push({ code: "description_missing", message: "建议在 frontmatter 中声明 description。", severity: "warning" });
  }
  if (!body) {
    issues.push({ code: "body_missing", message: "SKILL.md 需要包含正文说明。", severity: "error" });
  }

  return issues;
}

export function buildSkillMarkdown(input: { body: string; description: string; name: string }) {
  return [
    "---",
    `name: ${quoteFrontmatterValue(input.name)}`,
    `description: ${quoteFrontmatterValue(input.description)}`,
    "---",
    "",
    input.body.trim() || "# Instructions",
    ""
  ].join("\n");
}

async function scanSkillResources(input: {
  fileHost: FileToolHost;
  rootPath: string;
  userHomePath: string;
}): Promise<SkillResourceRecord[]> {
  const resources: SkillResourceRecord[] = [];

  for (const resourceKind of RESOURCE_KINDS) {
    const dirPath = joinWorkspacePath(input.rootPath, resourceKind.dir);
    let entries;
    try {
      entries = await input.fileHost.listDir({ workspacePath: input.userHomePath, path: dirPath });
    } catch (error) {
      if (isMissingSkillRoot(error)) {
        continue;
      }
      resources.push({
        kind: resourceKind.kind,
        name: resourceKind.dir,
        path: dirPath,
        preview: errorMessage(error),
        readable: false
      });
      continue;
    }

    for (const entry of entries.entries.filter((item) => !item.isDir)) {
      let preview = "";
      let readable = true;
      if ((entry.size ?? 0) <= RESOURCE_PREVIEW_LIMIT) {
        try {
          const raw = await input.fileHost.readText({ workspacePath: input.userHomePath, path: entry.path });
          preview = isProbablyText(raw.content) ? raw.content.slice(0, RESOURCE_PREVIEW_LIMIT) : "";
          readable = Boolean(preview || raw.content.length === 0);
        } catch {
          readable = false;
        }
      }

      resources.push({
        kind: resourceKind.kind,
        name: entry.name,
        path: entry.path,
        preview,
        readable,
        size: entry.size
      });
    }
  }

  return resources.sort((left, right) => `${left.kind}:${left.name}`.localeCompare(`${right.kind}:${right.name}`));
}

function summarizeResources(resources: SkillResourceRecord[]) {
  if (resources.length === 0) {
    return "无资源";
  }

  return RESOURCE_KINDS
    .map(({ kind, label }) => {
      const count = resources.filter((resource) => resource.kind === kind).length;
      return count > 0 ? `${label} ${count}` : "";
    })
    .filter(Boolean)
    .join(" · ");
}

function renderSkillResourceIndex(skill: SkillRecord) {
  if (skill.resources.length === 0) {
    return "";
  }

  return [
    "",
    "## Skill resource index",
    "这些资源位于技能目录下，只作为索引。需要正文时再用文件工具按路径读取；不要因为资源存在就自动执行脚本。",
    "",
    "Resource list:",
    ...skill.resources.map((resource) => `- ${resource.kind}: ${resource.path}${resource.size ? ` (${formatBytes(resource.size)})` : ""}`)
  ].join("\n");
}

function stripFrontmatter(content: string) {
  if (!content.startsWith("---")) {
    return content.trim();
  }

  const end = content.indexOf("\n---", 3);
  if (end === -1) {
    return content.trim();
  }

  return content.slice(end + 4).trim();
}

function quoteFrontmatterValue(value: string) {
  return JSON.stringify(value.trim());
}

function isProbablyText(content: string) {
  return !content.includes("\0") && !content.includes("\uFFFD");
}

function textMatchesQuery(text: string, query: string) {
  if (!text) {
    return false;
  }
  return text.includes(query) || query.split(/\s+/).some((word) => word.length >= 3 && text.includes(word));
}

function skillExcerpt(content: string) {
  return stripFrontmatter(content)
    .replace(/^#{1,6}\s+/gm, "")
    .trim()
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "";
}

function oneLine(value: string, maxChars: number) {
  const normalized = value.trim().replace(/\s+/g, " ");
  return normalized.length <= maxChars ? normalized : `${normalized.slice(0, Math.max(0, maxChars - 3))}...`;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 102.4) / 10} KB`;
  }
  return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

function errorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isMissingSkillRoot(error: unknown) {
  const message = errorMessage(error).toLowerCase();
  return message.includes("not found") || message.includes("no such file") || message.includes("os error 2");
}
