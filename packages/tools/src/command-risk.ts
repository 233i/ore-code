export type CommandRiskLevel = "read" | "write" | "dangerous" | "unknown";

export interface CommandRiskAssessment {
  level: CommandRiskLevel;
  summary: string;
  reasons: string[];
  normalizedCommand: string;
}

const READ_COMMANDS = new Set([
  "awk",
  "cat",
  "cargo check",
  "cargo clippy",
  "cargo metadata",
  "cargo test",
  "cargo tree",
  "find",
  "git branch",
  "git diff",
  "git grep",
  "git log",
  "git ls-files",
  "git show",
  "git status",
  "grep",
  "head",
  "ls",
  "node --version",
  "npm test",
  "pnpm lint",
  "pnpm test",
  "pnpm typecheck",
  "pwd",
  "rg",
  "sed",
  "tail",
  "tree",
  "wc",
  "which"
]);

const WRITE_COMMANDS = new Set([
  "apply_patch",
  "cargo build",
  "cargo clean",
  "cargo fix",
  "cargo fmt",
  "cargo run",
  "cp",
  "git add",
  "git apply",
  "git checkout",
  "git clean",
  "git commit",
  "git merge",
  "git mv",
  "git rebase",
  "git reset",
  "git restore",
  "git revert",
  "git rm",
  "git stash",
  "git switch",
  "mkdir",
  "mv",
  "npm ci",
  "npm install",
  "npm update",
  "pnpm add",
  "pnpm build",
  "pnpm install",
  "pnpm update",
  "rm",
  "rmdir",
  "tee",
  "touch"
]);

const KNOWN_PREFIX_ARITY: Record<string, number> = {
  cargo: 2,
  git: 2,
  npm: 2,
  pnpm: 2,
  yarn: 2
};

const SHELL_CONNECTORS = new Set(["&&", "||", ";", "|"]);

export function assessCommandRisk(command: string): CommandRiskAssessment {
  const normalizedCommand = normalizeCommand(command);
  const tokens = tokenizeShellLike(normalizedCommand);
  const reasons: string[] = [];

  if (normalizedCommand.length === 0) {
    return {
      level: "unknown",
      summary: "空命令，无法判断风险",
      reasons: ["命令为空"],
      normalizedCommand
    };
  }

  collectPatternReasons(normalizedCommand, tokens, reasons);
  if (hasDangerousPattern(normalizedCommand, tokens)) {
    return {
      level: "dangerous",
      summary: "高风险命令，可能破坏工作区或系统状态",
      reasons: compactReasons(reasons, ["命中高风险 shell 模式"]),
      normalizedCommand
    };
  }

  const prefixes = splitCommandPrefixes(tokens);
  if (prefixes.length === 0) {
    return {
      level: "unknown",
      summary: "未知命令，需要人工确认",
      reasons: compactReasons(reasons, ["没有识别到可分类的命令前缀"]),
      normalizedCommand
    };
  }

  if (hasWritePattern(normalizedCommand, tokens) || prefixes.some((prefix) => WRITE_COMMANDS.has(prefix))) {
    return {
      level: "write",
      summary: "写入命令，可能修改工作区、依赖或 Git 状态",
      reasons: compactReasons(reasons, ["命令会写入文件、依赖目录或版本控制状态"]),
      normalizedCommand
    };
  }

  if (prefixes.every((prefix) => READ_COMMANDS.has(prefix))) {
    return {
      level: "read",
      summary: "只读命令，主要读取文件或运行验证",
      reasons: compactReasons(reasons, ["命令前缀在只读/验证白名单中"]),
      normalizedCommand
    };
  }

  return {
    level: "unknown",
    summary: "未知命令，需要人工确认",
    reasons: compactReasons(reasons, [`未识别命令前缀：${prefixes.join(", ")}`]),
    normalizedCommand
  };
}

function normalizeCommand(command: string) {
  return stripHeredocBodies(command).replace(/\s+/g, " ").trim();
}

function stripHeredocBodies(command: string) {
  const lines = command.replace(/\r\n/g, "\n").split("\n");
  const output: string[] = [];
  let delimiter: string | null = null;

  for (const line of lines) {
    if (delimiter) {
      if (line.trim() === delimiter) {
        delimiter = null;
      }
      continue;
    }

    output.push(line);
    const match = line.match(/<<-?\s*['"]?([A-Za-z0-9_.-]+)['"]?/);
    if (match) {
      delimiter = match[1];
    }
  }

  return output.join("\n");
}

function tokenizeShellLike(command: string) {
  const tokens: string[] = [];
  const pattern = /&&|\|\||[;|]|\S+/g;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(command)) !== null) {
    tokens.push(stripWrappingQuotes(match[0]));
  }

  return tokens;
}

function stripWrappingQuotes(token: string) {
  if (token.length < 2) {
    return token;
  }

  const first = token[0];
  const last = token[token.length - 1];
  return (first === "'" && last === "'") || (first === '"' && last === '"') ? token.slice(1, -1) : token;
}

function splitCommandPrefixes(tokens: string[]) {
  const prefixes: string[] = [];
  let segment: string[] = [];

  for (const token of tokens) {
    if (SHELL_CONNECTORS.has(token)) {
      pushPrefix(prefixes, segment);
      segment = [];
    } else {
      segment.push(token);
    }
  }

  pushPrefix(prefixes, segment);
  return prefixes;
}

function pushPrefix(prefixes: string[], segment: string[]) {
  const words = segment.filter((word) => word.length > 0 && !word.startsWith("-") && !isEnvAssignment(word));
  if (words.length === 0) {
    return;
  }

  const base = words[0].toLowerCase();
  const packageManagerScript = packageManagerScriptPrefix(base, words);
  if (packageManagerScript) {
    prefixes.push(packageManagerScript);
    return;
  }

  const arity = KNOWN_PREFIX_ARITY[base] ?? 1;
  prefixes.push(words.slice(0, Math.min(arity, words.length)).join(" ").toLowerCase());
}

function packageManagerScriptPrefix(base: string, words: string[]) {
  if (base !== "pnpm" && base !== "npm" && base !== "yarn") {
    return null;
  }

  if (words.some((word) => /^test(?::[\w-]+)?$/i.test(word))) {
    return `${base} test`;
  }
  if (words.some((word) => /^lint(?::[\w-]+)?$/i.test(word))) {
    return `${base} lint`;
  }
  if (words.some((word) => /^typecheck(?::[\w-]+)?$/i.test(word))) {
    return `${base} typecheck`;
  }
  return null;
}

function isEnvAssignment(word: string) {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(word);
}

function hasDangerousPattern(command: string, tokens: string[]) {
  const lowered = command.toLowerCase();

  return (
    /\brm\s+(-[^\s]*r[^\s]*f|-rf|-fr)\s+(\/|~|\$home)(\s|$)/i.test(command) ||
    /\bsudo\b/i.test(command) ||
    /\bchmod\s+(-[^\s]*r[^\s]*\s+)?777\b/i.test(command) ||
    /\bchown\s+-[^\s]*r/i.test(command) ||
    /\bdd\s+if=/i.test(command) ||
    /\bmkfs(\.| |\b)/i.test(command) ||
    /\bdiskutil\s+erase/i.test(command) ||
    /\bgit\s+reset\b[\s\S]*--hard/i.test(command) ||
    /\bgit\s+clean\b[\s\S]*-[^\s]*f/i.test(command) ||
    /\bgit\s+push\b[\s\S]*--force/i.test(command) ||
    /\bkill\s+-9\b/i.test(command) ||
    />\s*\/dev\//i.test(command) ||
    /\b(curl|wget)\b[\s\S]*\|\s*(sh|bash|zsh)\b/i.test(command) ||
    lowered.includes(":(){ :|:& };:") ||
    tokens.includes("sudo")
  );
}

function hasWritePattern(command: string, tokens: string[]) {
  return (
    />{1,2}\s*[^\s]/.test(command) ||
    /\b(cat|printf|echo)\b[\s\S]*>{1,2}\s*[^\s]/i.test(command) ||
    /\bsed\s+(-[^\s]*i|--in-place)\b/i.test(command) ||
    /\bperl\s+-[^\s]*p[^\s]*i/i.test(command) ||
    tokens.includes("tee")
  );
}

function collectPatternReasons(command: string, tokens: string[], reasons: string[]) {
  if (tokens.length > 1 && tokens.some((token) => SHELL_CONNECTORS.has(token))) {
    reasons.push("包含 shell 连接符，可能一次执行多个动作");
  }

  if (/>{1,2}\s*[^\s]/.test(command)) {
    reasons.push("包含输出重定向");
  }

  if (/\b(curl|wget)\b[\s\S]*\|\s*(sh|bash|zsh)\b/i.test(command)) {
    reasons.push("包含远程脚本管道执行");
  }
}

function compactReasons(primary: string[], fallback: string[]) {
  const merged = [...primary, ...fallback];
  return [...new Set(merged)].slice(0, 4);
}
