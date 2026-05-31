export type SlashCommand = {
  category: "workspace" | "session" | "tools" | "settings" | "mode";
  name: string;
  description: string;
  lazyContext?: {
    content: string;
    source: "skill";
    sourceId: string;
    summary: string;
    title: string;
  };
  skillId?: string;
  skillPrompt?: string;
  usage?: string;
};

export const slashCommands: SlashCommand[] = [
  { category: "settings", name: "/config", description: "打开设置页", usage: "/config [general|providers|permissions|workspace|doctor|tools|data]" },
  { category: "workspace", name: "/diff", description: "查看当前工作区变更", usage: "/diff" },
  { category: "workspace", name: "/restore", description: "列出或恢复最近的 turn 快照", usage: "/restore [N]" },
  { category: "session", name: "/sessions", description: "搜索和切换历史对话", usage: "/sessions" },
  { category: "tools", name: "/jobs", description: "打开后台 shell 任务面板", usage: "/jobs" },
  { category: "workspace", name: "/files", description: "打开工作区文件面板", usage: "/files" },
  { category: "tools", name: "/skills", description: "打开技能面板", usage: "/skills" },
  { category: "tools", name: "/doctor", description: "运行环境检测", usage: "/doctor" },
  { category: "session", name: "/rename", description: "重命名当前对话", usage: "/rename 新标题" },
  { category: "session", name: "/new", description: "创建新对话", usage: "/new" },
  { category: "session", name: "/clear", description: "清空当前工作台并开始新对话", usage: "/clear" },
  { category: "mode", name: "/plan", description: "切换到计划模式", usage: "/plan" },
  { category: "mode", name: "/agent", description: "切换到默认审批模式", usage: "/agent" },
  { category: "mode", name: "/yolo", description: "切换到完全访问权限", usage: "/yolo" }
];

export function parseSlashCommand(input: string): { name: string; args: string } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return null;
  }

  const [name = "", ...rest] = trimmed.split(/\s+/);
  return {
    name: name.toLowerCase(),
    args: rest.join(" ").trim()
  };
}

export function matchSlashCommands(input: string, commands = slashCommands): SlashCommand[] {
  const parsed = parseSlashCommand(input);
  if (!parsed) {
    return [];
  }

  const keyword = parsed.name.replace(/^\//, "").toLowerCase();
  if (!keyword) {
    return commands.slice(0, 10);
  }

  return commands
    .filter((command) => {
      const searchableText = [
        command.name.replace(/^\//, ""),
        command.description,
        command.category,
        slashCategorySearchLabel(command.category),
        command.usage ?? ""
      ].join(" ").toLowerCase();
      return command.name.startsWith(parsed.name) || searchableText.includes(keyword);
    })
    .slice(0, 10);
}

export function shouldCompleteSlashCommand(input: string, command: SlashCommand): boolean {
  const parsed = parseSlashCommand(input);
  if (!parsed) {
    return false;
  }

  return parsed.name !== command.name && command.name.startsWith(parsed.name);
}

export function completeSlashCommand(command: SlashCommand): string {
  return `${command.name} `;
}

function slashCategorySearchLabel(category: SlashCommand["category"]) {
  switch (category) {
    case "workspace":
      return "工作区";
    case "session":
      return "对话 会话";
    case "tools":
      return "工具 技能 诊断";
    case "settings":
      return "设置 配置";
    case "mode":
      return "模式 权限";
  }
}
