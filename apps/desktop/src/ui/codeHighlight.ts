export type CodeTokenKind =
  | "comment"
  | "function"
  | "keyword"
  | "number"
  | "operator"
  | "plain"
  | "property"
  | "punctuation"
  | "string"
  | "type";

export interface CodeToken {
  kind: CodeTokenKind;
  text: string;
}

interface LanguageSpec {
  blockComments?: Array<[string, string]>;
  keywords: Set<string>;
  lineComments: string[];
  propertyStrings?: boolean;
}

const LANGUAGE_LABELS: Record<string, string> = {
  bash: "Shell",
  c: "C",
  cpp: "C++",
  css: "CSS",
  diff: "Diff",
  html: "HTML",
  javascript: "JavaScript",
  json: "JSON",
  jsx: "JSX",
  markdown: "Markdown",
  plaintext: "Text",
  python: "Python",
  rust: "Rust",
  shell: "Shell",
  tsx: "TSX",
  typescript: "TypeScript",
  toml: "TOML",
  yaml: "YAML"
};

const LANGUAGE_ALIASES: Record<string, string> = {
  cjs: "javascript",
  cmd: "shell",
  console: "shell",
  h: "c",
  hpp: "cpp",
  htm: "html",
  js: "javascript",
  jsonc: "json",
  md: "markdown",
  mjs: "javascript",
  ps1: "shell",
  py: "python",
  rs: "rust",
  sh: "shell",
  text: "plaintext",
  ts: "typescript",
  yml: "yaml",
  zsh: "shell"
};

const JS_KEYWORDS = [
  "as", "async", "await", "break", "case", "catch", "class", "const", "continue", "default",
  "delete", "do", "else", "export", "extends", "finally", "for", "from", "function", "if",
  "import", "in", "instanceof", "interface", "let", "new", "of", "return", "satisfies", "switch",
  "throw", "try", "type", "typeof", "var", "void", "while", "with", "yield"
];

const LANGUAGE_SPECS: Record<string, LanguageSpec> = {
  bash: {
    keywords: words("case do done elif else esac fi for function if in local select then until while"),
    lineComments: ["#"]
  },
  c: {
    blockComments: [["/*", "*/"]],
    keywords: words("break case const continue default do else enum extern for if return sizeof static struct switch typedef union void volatile while"),
    lineComments: ["//"]
  },
  cpp: {
    blockComments: [["/*", "*/"]],
    keywords: words("auto break case class const constexpr continue default do else enum explicit extern for if namespace new private protected public return sizeof static struct switch template typename using virtual void volatile while"),
    lineComments: ["//"]
  },
  css: {
    blockComments: [["/*", "*/"]],
    keywords: words("align-items background border color display flex font gap grid height justify-content margin padding position width"),
    lineComments: []
  },
  html: {
    blockComments: [["<!--", "-->"]],
    keywords: words("body button div footer form h1 h2 h3 head header html input label main meta script section span style textarea"),
    lineComments: []
  },
  javascript: {
    blockComments: [["/*", "*/"]],
    keywords: words([...JS_KEYWORDS, "false", "null", "true", "undefined"].join(" ")),
    lineComments: ["//"]
  },
  json: {
    keywords: words("false null true"),
    lineComments: [],
    propertyStrings: true
  },
  jsx: {
    blockComments: [["/*", "*/"]],
    keywords: words([...JS_KEYWORDS, "false", "null", "true", "undefined"].join(" ")),
    lineComments: ["//"]
  },
  python: {
    keywords: words("and as assert async await break class continue def del elif else except false finally for from global if import in is lambda none nonlocal not or pass raise return true try while with yield"),
    lineComments: ["#"]
  },
  rust: {
    blockComments: [["/*", "*/"]],
    keywords: words("as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while"),
    lineComments: ["//"]
  },
  shell: {
    keywords: words("case do done elif else esac export fi for function if in local select set then until while"),
    lineComments: ["#"]
  },
  toml: {
    keywords: words("false true"),
    lineComments: ["#"],
    propertyStrings: true
  },
  tsx: {
    blockComments: [["/*", "*/"]],
    keywords: words([...JS_KEYWORDS, "declare", "enum", "false", "implements", "keyof", "namespace", "null", "private", "protected", "public", "readonly", "true", "undefined"].join(" ")),
    lineComments: ["//"]
  },
  typescript: {
    blockComments: [["/*", "*/"]],
    keywords: words([...JS_KEYWORDS, "declare", "enum", "false", "implements", "keyof", "namespace", "null", "private", "protected", "public", "readonly", "true", "undefined"].join(" ")),
    lineComments: ["//"]
  },
  yaml: {
    keywords: words("false null true yes no on off"),
    lineComments: ["#"],
    propertyStrings: true
  }
};

export function languageFromClassName(className: unknown) {
  if (typeof className !== "string") {
    return null;
  }
  const match = /\blanguage-([^\s]+)/.exec(className);
  return match ? normalizeCodeLanguage(match[1]) : null;
}

export function normalizeCodeLanguage(language: string | null | undefined) {
  const normalized = (language ?? "").trim().toLowerCase().replace(/^[./]+/, "");
  if (!normalized) {
    return null;
  }
  return LANGUAGE_ALIASES[normalized] ?? normalized;
}

export function codeLanguageLabel(language: string | null | undefined) {
  const normalized = normalizeCodeLanguage(language);
  return normalized ? LANGUAGE_LABELS[normalized] ?? normalized : "Text";
}

export function languageForPath(path: string | null | undefined) {
  const extension = (path ?? "").split(/[\\/]/).pop()?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return normalizeCodeLanguage(extension);
}

export function highlightCode(code: string, language: string | null | undefined): CodeToken[] {
  const normalized = normalizeCodeLanguage(language);
  if (normalized === "diff") {
    return highlightDiff(code);
  }

  const spec = normalized ? LANGUAGE_SPECS[normalized] : undefined;
  if (!spec) {
    return [{ kind: "plain", text: code }];
  }

  const tokens: CodeToken[] = [];
  let index = 0;

  while (index < code.length) {
    const blockComment = matchBlockComment(code, index, spec.blockComments ?? []);
    if (blockComment) {
      push(tokens, "comment", blockComment);
      index += blockComment.length;
      continue;
    }

    const lineComment = matchLineComment(code, index, spec.lineComments);
    if (lineComment) {
      push(tokens, "comment", lineComment);
      index += lineComment.length;
      continue;
    }

    const quoted = matchQuotedString(code, index);
    if (quoted) {
      push(tokens, isPropertyString(code, index, quoted, spec) ? "property" : "string", quoted);
      index += quoted.length;
      continue;
    }

    const number = matchPattern(code, index, /^-?(?:0x[\da-f]+|\d+(?:\.\d+)?)(?:[eE][+-]?\d+)?\b/i);
    if (number) {
      push(tokens, "number", number);
      index += number.length;
      continue;
    }

    const identifier = matchPattern(code, index, /^[A-Za-z_$][\w$]*/);
    if (identifier) {
      const next = code.slice(index + identifier.length).match(/^\s*(.)/)?.[1];
      const previous = code[index - 1];
      const kind = spec.keywords.has(identifier)
        ? "keyword"
        : next === "("
          ? "function"
          : /^[A-Z]/.test(identifier) || previous === "."
            ? "type"
            : "plain";
      push(tokens, kind, identifier);
      index += identifier.length;
      continue;
    }

    const operator = matchPattern(code, index, /^(?:=>|->|::|===|!==|==|!=|<=|>=|\+\+|--|&&|\|\||[+\-*/%=!<>|&?:.]+)/);
    if (operator) {
      push(tokens, "operator", operator);
      index += operator.length;
      continue;
    }

    const punctuation = matchPattern(code, index, /^[{}()[\],;]/);
    if (punctuation) {
      push(tokens, "punctuation", punctuation);
      index += punctuation.length;
      continue;
    }

    push(tokens, "plain", code[index]);
    index += 1;
  }

  return tokens;
}

function highlightDiff(code: string): CodeToken[] {
  return code.split(/(\n)/).map((line) => {
    if (line === "\n") {
      return { kind: "plain", text: line };
    }
    if (line.startsWith("+")) {
      return { kind: "string", text: line };
    }
    if (line.startsWith("-")) {
      return { kind: "comment", text: line };
    }
    if (line.startsWith("@@") || line.startsWith("diff ") || line.startsWith("index ")) {
      return { kind: "keyword", text: line };
    }
    return { kind: "plain", text: line };
  });
}

function matchBlockComment(code: string, index: number, comments: Array<[string, string]>) {
  for (const [start, end] of comments) {
    if (code.startsWith(start, index)) {
      const endIndex = code.indexOf(end, index + start.length);
      return endIndex === -1 ? code.slice(index) : code.slice(index, endIndex + end.length);
    }
  }
  return null;
}

function matchLineComment(code: string, index: number, prefixes: string[]) {
  for (const prefix of prefixes) {
    if (code.startsWith(prefix, index) && isLineCommentBoundary(code, index)) {
      const newline = code.indexOf("\n", index);
      return newline === -1 ? code.slice(index) : code.slice(index, newline);
    }
  }
  return null;
}

function matchQuotedString(code: string, index: number) {
  const quote = code[index];
  if (quote !== "\"" && quote !== "'" && quote !== "`") {
    return null;
  }

  let cursor = index + 1;
  while (cursor < code.length) {
    if (code[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (code[cursor] === quote) {
      return code.slice(index, cursor + 1);
    }
    cursor += 1;
  }
  return code.slice(index);
}

function isPropertyString(code: string, index: number, quoted: string, spec: LanguageSpec) {
  if (!spec.propertyStrings) {
    return false;
  }
  const next = code.slice(index + quoted.length).match(/^\s*[:=]/);
  return Boolean(next);
}

function matchPattern(code: string, index: number, pattern: RegExp) {
  return pattern.exec(code.slice(index))?.[0] ?? null;
}

function isLineCommentBoundary(code: string, index: number) {
  const previous = code[index - 1];
  return !previous || previous === "\n" || /\s/.test(previous);
}

function push(tokens: CodeToken[], kind: CodeTokenKind, text: string) {
  const previous = tokens[tokens.length - 1];
  if (previous?.kind === kind) {
    previous.text += text;
    return;
  }
  tokens.push({ kind, text });
}

function words(input: string) {
  return new Set(input.split(/\s+/).filter(Boolean));
}
