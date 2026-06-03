import type { FileToolHost } from "@ore-code/tools";
import type { RuntimeEvent, ToolCall } from "@ore-code/protocol";
import type { TrackedFileChange } from "../features/changes/changeLedger";

const MAX_QUERY_TERMS = 8;
const MAX_SEARCH_RESULTS_PER_TERM = 16;
const MAX_RELEVANT_FILES = 10;
const MAX_SYMBOL_FILES = 5;
const MAX_FILE_READ_CHARS = 80_000;
const MAX_SYMBOLS_PER_FILE = 8;
const PROJECT_INDEX_VERSION = 1;
const PROJECT_INDEX_STORAGE_PREFIX = "ore-code.project-index.v1.";
const MAX_INDEX_FILES = 160;
const MAX_INDEX_FILE_CHARS = 40_000;
const MAX_VECTOR_TERMS = 20_000;
const MAX_VECTOR_ENTRIES = 96;
const VECTOR_DIMENSIONS = 1024;
const MAX_SEMANTIC_CANDIDATES = 8;
const MAX_REFERENCES_PER_FILE = 80;
const MAX_DEPENDENCIES_PER_FILE = 48;
const MAX_GRAPH_IMPACT_FILES = 8;
const MAX_GRAPH_EDGES = 10;

const DISCOVERY_QUERIES = [
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".rs",
  ".py",
  ".go",
  ".java",
  ".css",
  ".md",
  ".json",
  ".toml",
  "src",
  "app",
  "package",
  "readme",
  "config",
  "test"
];

const SEMANTIC_ALIASES: Record<string, string[]> = {
  "按钮": ["button", "action", "control"],
  "测试": ["test", "spec", "vitest", "jest"],
  "登录": ["login", "signin", "auth", "session"],
  "登出": ["logout", "signout", "auth", "session"],
  "认证": ["auth", "authentication", "session"],
  "权限": ["permission", "approval", "authorization", "auth"],
  "审批": ["approval", "permission", "review"],
  "刷新": ["refresh", "reload", "sync"],
  "缓存": ["cache", "cached", "storage"],
  "索引": ["index", "search", "retrieval"],
  "搜索": ["search", "find", "query"],
  "语义": ["semantic", "embedding", "vector", "retrieval"],
  "向量": ["vector", "embedding", "semantic"],
  "提交": ["commit", "git"],
  "变更": ["change", "diff", "patch"],
  "窗口": ["window", "modal", "dialog", "panel"],
  "弹窗": ["modal", "dialog", "popover"],
  "深色": ["dark", "theme"],
  "主题": ["theme", "dark", "light"],
  "技能": ["skill", "skills"],
  "自动化": ["automation", "scheduled", "task"],
  "工作区": ["workspace", "project"],
  "诊断": ["diagnostics", "doctor", "check"],
  "工具": ["tool", "tools"],
  "路径": ["path", "file", "directory"],
  "文件": ["file", "path"],
  "会话": ["session", "thread"],
  "历史": ["history", "runtime"],
  "上下文": ["context", "history"],
  "语言": ["language", "locale"],
  "跨平台": ["platform", "windows", "macos", "linux"],
  "兼容": ["compatibility", "windows", "platform"],
  "命令": ["command", "shell", "process"],
  "进程": ["process", "command"],
  "错误": ["error", "failure", "exception"],
  "失败": ["failure", "error"],
  "滚动": ["scroll", "autoscroll"],
  "高亮": ["highlight", "syntax"],
  "代码": ["code", "source"]
};

const CODEBASE_INTENT_KEYWORDS = [
  "agent",
  "api",
  "bug",
  "build",
  "button",
  "ci",
  "code",
  "commit",
  "component",
  "diff",
  "error",
  "fix",
  "git",
  "index",
  "lint",
  "login",
  "mcp",
  "page",
  "pr",
  "refactor",
  "refresh",
  "run",
  "shell",
  "test",
  "token",
  "tool",
  "ui",
  "windows",
  "workspace",
  "继续",
  "修复",
  "实现",
  "优化",
  "重构",
  "新增",
  "删除",
  "修改",
  "改",
  "适配",
  "跨平台",
  "兼容",
  "打包",
  "构建",
  "测试",
  "运行",
  "执行",
  "报错",
  "错误",
  "失败",
  "代码",
  "文件",
  "目录",
  "路径",
  "页面",
  "按钮",
  "样式",
  "主题",
  "深色",
  "浅色",
  "窗口",
  "弹窗",
  "工具",
  "工作区",
  "技能",
  "自动化",
  "索引",
  "检索",
  "上下文",
  "仓库",
  "项目",
  "依赖",
  "安装",
  "命令",
  "进程",
  "组件",
  "高亮",
  "滚动"
];

const SOURCE_EXTENSIONS = new Set([
  "c",
  "cc",
  "cpp",
  "css",
  "go",
  "h",
  "hpp",
  "html",
  "java",
  "js",
  "jsx",
  "json",
  "md",
  "py",
  "rs",
  "scss",
  "svelte",
  "toml",
  "ts",
  "tsx",
  "vue",
  "yaml",
  "yml"
]);

const STOP_WORDS = new Set([
  "about",
  "after",
  "before",
  "code",
  "file",
  "from",
  "into",
  "make",
  "need",
  "please",
  "that",
  "this",
  "with",
  "现在",
  "这个",
  "那个",
  "一下",
  "帮我",
  "实现",
  "优化"
]);

const REFERENCE_STOP_WORDS = new Set([
  "Array",
  "Boolean",
  "Date",
  "Error",
  "JSON",
  "Map",
  "Math",
  "Number",
  "Object",
  "Promise",
  "Record",
  "Set",
  "String",
  "afterEach",
  "beforeEach",
  "catch",
  "console",
  "describe",
  "error",
  "expect",
  "filter",
  "find",
  "includes",
  "if",
  "it",
  "join",
  "log",
  "map",
  "push",
  "reduce",
  "return",
  "slice",
  "some",
  "sort",
  "split",
  "switch",
  "test",
  "then",
  "trim",
  "warn",
  "while"
]);

export interface ProjectIndexContext {
  block: string;
  graph: ProjectIndexGraphSummary | null;
  relevantFiles: ProjectIndexFile[];
  queryTerms: string[];
  recentPaths: string[];
  semanticIndex: ProjectIndexSemanticSummary | null;
}

export interface ProjectIndexFile {
  path: string;
  reasons: string[];
  score: number;
  symbols: ProjectIndexSymbol[];
}

export interface ProjectIndexSemanticSummary {
  documentCount: number;
  source: "cache" | "fresh" | "none";
  updatedAt?: string;
}

export interface ProjectIndexRefreshResult {
  documentCount: number;
  rebuiltDocuments: number;
  reusedDocuments: number;
  skippedDocuments: number;
  status: "ready" | "empty";
  updatedAt: string;
}

export interface ProjectIndexStore {
  load(workspacePath: string): Promise<PersistentProjectIndex | null>;
  save(index: PersistentProjectIndex): Promise<void>;
}

export interface PersistentProjectIndex {
  version: typeof PROJECT_INDEX_VERSION;
  workspacePath: string;
  updatedAt: string;
  documents: IndexedProjectDocument[];
}

export interface IndexedProjectDocument {
  contentHash?: string;
  dependencies: ProjectIndexDependency[];
  path: string;
  preview: string;
  references: ProjectIndexReference[];
  symbols: ProjectIndexSymbol[];
  vector: SparseVector;
}

export interface ProjectIndexDependency {
  kind: "import" | "require" | "dynamic_import" | "module";
  line: number;
  target: string;
}

export interface ProjectIndexReference {
  kind: "call" | "component" | "construct";
  line: number;
  name: string;
}

export interface ProjectIndexSymbol {
  kind: string;
  line: number;
  name: string;
}

export interface ProjectIndexGraphSummary {
  edges: ProjectIndexGraphEdge[];
  impactedFiles: ProjectIndexImpactFile[];
}

export interface ProjectIndexGraphEdge {
  fromPath: string;
  label: string;
  toPath: string;
}

export interface ProjectIndexImpactFile {
  path: string;
  reasons: string[];
  score: number;
}

type SparseVector = Array<[number, number]>;

interface CandidateFile {
  path: string;
  reasons: Set<string>;
  score: number;
}

interface SemanticIndexLoadResult {
  index: PersistentProjectIndex | null;
  source: ProjectIndexSemanticSummary["source"];
}

interface SemanticIndexBuildResult {
  index: PersistentProjectIndex;
  rebuiltDocuments: number;
  reusedDocuments: number;
  skippedDocuments: number;
}

export async function buildProjectIndexContext(input: {
  fileHost: FileToolHost;
  forceRebuild?: boolean;
  prompt: string;
  priorEvents: RuntimeEvent[];
  store?: ProjectIndexStore;
  trackedChanges: TrackedFileChange[];
  workspacePath: string;
}): Promise<ProjectIndexContext> {
  const queryTerms = queryTermsForPrompt(input.prompt);
  const pathMentions = extractPathMentions(input.prompt);
  const recentPaths = recentWorkingSetPaths(input.priorEvents, input.trackedChanges);
  if (!shouldBuildCodebaseContext(input.prompt, queryTerms, pathMentions, input.trackedChanges)) {
    return emptyProjectIndexContext(queryTerms, recentPaths);
  }

  const candidates = new Map<string, CandidateFile>();
  const semanticIndex = await loadOrBuildSemanticIndex({
    fileHost: input.fileHost,
    forceRebuild: input.forceRebuild,
    queryTerms,
    store: input.store ?? createRuntimeProjectIndexStore(),
    workspacePath: input.workspacePath
  });

  for (const path of pathMentions) {
    addCandidate(candidates, path, 90, "用户明确提到路径");
  }
  for (const path of recentPaths.slice(0, 12)) {
    addCandidate(candidates, path, 45, "最近工作集");
  }
  for (const change of input.trackedChanges.slice(-8)) {
    addCandidate(candidates, change.path, 70, `本轮已变更 ${change.changeKind}`);
  }

  collectSemanticCandidates(candidates, semanticIndex.index, input.prompt);
  await collectSearchCandidates(input.fileHost, input.workspacePath, queryTerms, candidates);
  await collectSymbolCandidates(input.fileHost, input.workspacePath, queryTerms, candidates);
  collectImpactCandidates(candidates, [...recentPaths, ...input.trackedChanges.map((change) => change.path)]);
  const graphSummary = collectGraphCandidates({
    candidates,
    index: semanticIndex.index,
    queryTerms,
    seedPaths: [...pathMentions, ...recentPaths, ...input.trackedChanges.map((change) => change.path)]
  });

  const relevantFiles = await hydrateProjectIndexFiles(input.fileHost, input.workspacePath, candidates);
  const semanticSummary = summarizeSemanticIndex(semanticIndex);
  return {
    block: formatProjectIndexContext({ graph: graphSummary, relevantFiles, queryTerms, recentPaths, semanticIndex: semanticSummary }),
    graph: graphSummary,
    queryTerms,
    recentPaths,
    semanticIndex: semanticSummary,
    relevantFiles
  };
}

export async function refreshProjectIndex(input: {
  fileHost: FileToolHost;
  queryTerms?: string[];
  store?: ProjectIndexStore;
  workspacePath: string;
}): Promise<ProjectIndexRefreshResult> {
  const store = input.store ?? createRuntimeProjectIndexStore();
  const cached = await safeLoadIndex(store, input.workspacePath);
  const result = await buildSemanticIndex(input.fileHost, input.workspacePath, input.queryTerms ?? [], cached ?? undefined);
  await store.save(result.index);

  return {
    documentCount: result.index.documents.length,
    rebuiltDocuments: result.rebuiltDocuments,
    reusedDocuments: result.reusedDocuments,
    skippedDocuments: result.skippedDocuments,
    status: result.index.documents.length > 0 ? "ready" : "empty",
    updatedAt: result.index.updatedAt
  };
}

export function createRuntimeProjectIndexStore(): ProjectIndexStore {
  return {
    async load(workspacePath) {
      const storage = runtimeStorage();
      if (!storage) {
        return null;
      }
      const raw = storage.getItem(projectIndexStorageKey(workspacePath));
      if (!raw) {
        return null;
      }
      try {
        return sanitizePersistentIndex(JSON.parse(raw));
      } catch {
        return null;
      }
    },
    async save(index) {
      const storage = runtimeStorage();
      if (!storage) {
        return;
      }
      try {
        storage.setItem(projectIndexStorageKey(index.workspacePath), JSON.stringify(index));
      } catch {
        // The index is an optimization. Quota or storage failures should never block a turn.
      }
    }
  };
}

export function createMemoryProjectIndexStore(): ProjectIndexStore {
  const values = new Map<string, PersistentProjectIndex>();
  return {
    async load(workspacePath) {
      return values.get(projectIndexStorageKey(workspacePath)) ?? null;
    },
    async save(index) {
      values.set(projectIndexStorageKey(index.workspacePath), index);
    }
  };
}

function emptyProjectIndexContext(queryTerms: string[], recentPaths: string[]): ProjectIndexContext {
  return {
    block: "",
    graph: null,
    queryTerms,
    recentPaths,
    semanticIndex: null,
    relevantFiles: []
  };
}

function shouldBuildCodebaseContext(
  prompt: string,
  queryTerms: string[],
  pathMentions: string[],
  trackedChanges: TrackedFileChange[]
) {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  if (pathMentions.length > 0 || trackedChanges.length > 0) {
    return true;
  }
  if (CODEBASE_INTENT_KEYWORDS.some((keyword) => normalized.includes(keyword))) {
    return true;
  }
  if (queryTerms.some((term) => looksLikeCodeIdentifier(term))) {
    return true;
  }
  return false;
}

function looksLikeCodeIdentifier(term: string) {
  if (!/[a-z]/i.test(term)) {
    return false;
  }
  return /[A-Z_$.-]/.test(term) || term.includes("_") || term.length >= 5;
}

async function loadOrBuildSemanticIndex(input: {
  fileHost: FileToolHost;
  forceRebuild?: boolean;
  queryTerms: string[];
  store: ProjectIndexStore;
  workspacePath: string;
}): Promise<SemanticIndexLoadResult> {
  const cached = await safeLoadIndex(input.store, input.workspacePath);
  if (cached && !input.forceRebuild) {
    return { index: cached, source: "cache" };
  }
  if (!input.forceRebuild) {
    return { index: null, source: "none" };
  }

  const fresh = await buildSemanticIndex(input.fileHost, input.workspacePath, input.queryTerms, cached ?? undefined);
  if (fresh.index.documents.length > 0) {
    await input.store.save(fresh.index);
    return { index: fresh.index, source: "fresh" };
  }

  return cached ? { index: cached, source: "cache" } : { index: null, source: "none" };
}

async function safeLoadIndex(store: ProjectIndexStore, workspacePath: string) {
  try {
    return await store.load(workspacePath);
  } catch {
    return null;
  }
}

async function buildSemanticIndex(
  fileHost: FileToolHost,
  workspacePath: string,
  queryTerms: string[],
  previous?: PersistentProjectIndex
): Promise<SemanticIndexBuildResult> {
  const paths = await discoverIndexableFiles(fileHost, workspacePath, queryTerms);
  const documents: IndexedProjectDocument[] = [];
  const previousByPath = new Map((previous?.documents ?? []).map((document) => [document.path, document]));
  let rebuiltDocuments = 0;
  let reusedDocuments = 0;
  let skippedDocuments = 0;

  for (const path of paths) {
    try {
      const file = await fileHost.readText({ workspacePath, path });
      const content = file.content.slice(0, MAX_INDEX_FILE_CHARS);
      const contentHash = contentHashForIndex(path, content);
      const previousDocument = previousByPath.get(path);
      if (previousDocument?.contentHash === contentHash) {
        documents.push(previousDocument);
        reusedDocuments += 1;
        continue;
      }

      const symbols = extractSymbols(path, content).slice(0, MAX_SYMBOLS_PER_FILE);
      const dependencies = extractDependencies(path, content);
      const references = extractReferences(content);
      const symbolText = symbols.map((symbol) => `${symbol.kind} ${symbol.name}`).join("\n");
      const dependencyText = dependencies.map((dependency) => `${dependency.kind} ${dependency.target}`).join("\n");
      const referenceText = references.map((reference) => `${reference.kind} ${reference.name}`).join("\n");
      const vector = vectorizeText(`${path}\n${symbolText}\n${dependencyText}\n${referenceText}\n${content}`);
      if (vector.length > 0) {
        documents.push({
          contentHash,
          dependencies,
          path,
          preview: compactPreview(content),
          references,
          symbols,
          vector
        });
        rebuiltDocuments += 1;
      } else {
        skippedDocuments += 1;
      }
    } catch {
      // Indexing is best-effort and must not block normal agent execution.
      skippedDocuments += 1;
    }
  }

  return {
    index: {
      version: PROJECT_INDEX_VERSION,
      workspacePath,
      updatedAt: new Date().toISOString(),
      documents
    },
    rebuiltDocuments,
    reusedDocuments,
    skippedDocuments
  };
}

function contentHashForIndex(path: string, content: string) {
  return `graph-v1:${hashString(path)}:${hashString(content)}:${content.length}`;
}

async function discoverIndexableFiles(fileHost: FileToolHost, workspacePath: string, queryTerms: string[]) {
  const paths: string[] = [];
  const queries = uniqueStrings([...queryTerms, ...DISCOVERY_QUERIES]).slice(0, 32);
  for (const query of queries) {
    try {
      const result = await fileHost.searchFiles({
        workspacePath,
        path: ".",
        query,
        maxResults: 80
      });
      for (const match of result.matches) {
        if (!match.isDir && isIndexablePath(match.path)) {
          paths.push(match.path);
        }
      }
    } catch {
      // Keep scanning with the next query.
    }
    if (paths.length >= MAX_INDEX_FILES * 2) {
      break;
    }
  }
  return uniquePaths(paths)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, MAX_INDEX_FILES);
}

function collectSemanticCandidates(
  candidates: Map<string, CandidateFile>,
  index: PersistentProjectIndex | null,
  prompt: string
) {
  if (!index || index.documents.length === 0) {
    return;
  }
  const queryVector = vectorizeText(prompt);
  if (queryVector.length === 0) {
    return;
  }
  const scored = index.documents
    .map((document) => ({
      document,
      score: cosineSimilarity(queryVector, document.vector)
    }))
    .filter((item) => item.score > 0.035)
    .sort((left, right) => right.score - left.score || left.document.path.localeCompare(right.document.path))
    .slice(0, MAX_SEMANTIC_CANDIDATES);

  for (const item of scored) {
    addCandidate(candidates, item.document.path, Math.max(12, Math.round(item.score * 140)), "语义向量匹配");
  }
}

function summarizeSemanticIndex(result: SemanticIndexLoadResult): ProjectIndexSemanticSummary | null {
  if (!result.index || result.index.documents.length === 0) {
    return null;
  }
  return {
    documentCount: result.index.documents.length,
    source: result.source,
    updatedAt: result.index.updatedAt
  };
}

function vectorizeText(text: string): SparseVector {
  const counts = new Map<number, number>();
  for (const token of tokenizeForVector(text).slice(0, MAX_VECTOR_TERMS)) {
    const dimension = hashString(token) % VECTOR_DIMENSIONS;
    counts.set(dimension, (counts.get(dimension) ?? 0) + 1);
  }

  const weighted = [...counts.entries()].map(([dimension, count]) => [dimension, 1 + Math.log(count)] as const);
  const norm = Math.sqrt(weighted.reduce((sum, [, weight]) => sum + weight * weight, 0));
  if (norm === 0) {
    return [];
  }

  return weighted
    .map(([dimension, weight]) => [dimension, roundVectorWeight(weight / norm)] as [number, number])
    .sort((left, right) => right[1] - left[1] || left[0] - right[0])
    .slice(0, MAX_VECTOR_ENTRIES)
    .sort((left, right) => left[0] - right[0]);
}

function tokenizeForVector(text: string) {
  const tokens: string[] = [];
  for (const match of text.match(/[A-Za-z][A-Za-z0-9_$-]{1,}|[\u4e00-\u9fff]{2,}/g) ?? []) {
    const raw = match.toLowerCase();
    const candidates = containsCjk(raw) ? cjkTokens(raw) : identifierTokens(match);
    for (const candidate of candidates) {
      if (candidate.length < 2 || STOP_WORDS.has(candidate) || /^\d+$/.test(candidate)) {
        continue;
      }
      tokens.push(candidate);
      for (const alias of SEMANTIC_ALIASES[candidate] ?? []) {
        tokens.push(alias);
      }
    }
  }
  return tokens;
}

function identifierTokens(value: string) {
  const spaced = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_$-]+/g, " ")
    .toLowerCase();
  return uniqueStrings([value.toLowerCase(), ...spaced.split(/\s+/)]).filter(Boolean);
}

function cjkTokens(value: string) {
  const tokens = [value];
  for (let index = 0; index < value.length - 1; index += 1) {
    tokens.push(value.slice(index, index + 2));
  }
  return uniqueStrings(tokens);
}

function cosineSimilarity(left: SparseVector, right: SparseVector) {
  const rightValues = new Map(right);
  let score = 0;
  for (const [dimension, weight] of left) {
    score += weight * (rightValues.get(dimension) ?? 0);
  }
  return score;
}

function compactPreview(content: string) {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4)
    .join(" ")
    .slice(0, 240);
}

function sanitizePersistentIndex(value: unknown): PersistentProjectIndex | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<PersistentProjectIndex>;
  if (record.version !== PROJECT_INDEX_VERSION || typeof record.workspacePath !== "string" || typeof record.updatedAt !== "string") {
    return null;
  }
  if (!Array.isArray(record.documents)) {
    return null;
  }

  const documents: IndexedProjectDocument[] = [];
  for (const document of record.documents) {
    const sanitizedDocument = sanitizeIndexedProjectDocument(document);
    if (sanitizedDocument) {
      documents.push(sanitizedDocument);
    }
  }
  return {
    version: PROJECT_INDEX_VERSION,
    workspacePath: record.workspacePath,
    updatedAt: record.updatedAt,
    documents
  };
}

function sanitizeIndexedProjectDocument(value: unknown): IndexedProjectDocument | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const record = value as Partial<IndexedProjectDocument>;
  if (typeof record.path !== "string" || typeof record.preview !== "string") {
    return null;
  }
  if (!Array.isArray(record.symbols) || !Array.isArray(record.vector)) {
    return null;
  }

  const dependencies = Array.isArray(record.dependencies) ? record.dependencies.filter(isProjectIndexDependency) : [];
  const references = Array.isArray(record.references) ? record.references.filter(isProjectIndexReference) : [];
  const symbols = record.symbols.filter(isProjectIndexSymbol);
  const vector = record.vector.filter(isVectorEntry);
  return {
    contentHash: typeof record.contentHash === "string" ? record.contentHash : undefined,
    dependencies,
    path: record.path,
    preview: record.preview,
    references,
    symbols,
    vector
  };
}

function isProjectIndexDependency(value: unknown): value is ProjectIndexDependency {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<ProjectIndexDependency>;
  return typeof record.target === "string" &&
    typeof record.line === "number" &&
    (record.kind === "import" || record.kind === "require" || record.kind === "dynamic_import" || record.kind === "module");
}

function isProjectIndexReference(value: unknown): value is ProjectIndexReference {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<ProjectIndexReference>;
  return typeof record.name === "string" &&
    typeof record.line === "number" &&
    (record.kind === "call" || record.kind === "component" || record.kind === "construct");
}

function isProjectIndexSymbol(value: unknown): value is ProjectIndexSymbol {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value as Partial<ProjectIndexSymbol>;
  return typeof record.kind === "string" && typeof record.name === "string" && typeof record.line === "number";
}

function isVectorEntry(value: unknown): value is [number, number] {
  return Array.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number";
}

function runtimeStorage(): Storage | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function projectIndexStorageKey(workspacePath: string) {
  return `${PROJECT_INDEX_STORAGE_PREFIX}${hashString(normalizeProjectPath(workspacePath))}`;
}

function hashString(value: string) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function containsCjk(value: string) {
  return /[\u4e00-\u9fff]/.test(value);
}

function roundVectorWeight(value: number) {
  return Math.round(value * 10000) / 10000;
}

function queryTermsForPrompt(prompt: string) {
  const words = new Set<string>();
  for (const raw of prompt.match(/[A-Za-z][A-Za-z0-9_-]{2,}|[\u4e00-\u9fff]{2,}/g) ?? []) {
    const word = raw.toLowerCase();
    if (!STOP_WORDS.has(word) && !/^\d+$/.test(word)) {
      words.add(word);
    }
  }
  for (const path of extractPathMentions(prompt)) {
    const name = pathBaseName(path).replace(/\.[^.]+$/, "").toLowerCase();
    if (name.length >= 3) {
      words.add(name);
    }
  }
  return [...words].slice(0, MAX_QUERY_TERMS);
}

function extractPathMentions(text: string) {
  const paths = new Set<string>();
  const pattern = /(?:[A-Za-z]:[\\/])?[\w.@-]+(?:[\\/][\w.@-]+)+(?:\.[A-Za-z0-9]+)?|[\w.@-]+\.(?:[A-Za-z0-9]{1,8})/g;
  for (const match of text.matchAll(pattern)) {
    const value = match[0].replace(/^["'`]+|["'`.,;:!?]+$/g, "");
    if (value && !value.includes("://") && !value.startsWith("@")) {
      paths.add(value);
    }
  }
  return [...paths].slice(0, 16);
}

function recentWorkingSetPaths(events: RuntimeEvent[], trackedChanges: TrackedFileChange[]) {
  const paths: string[] = [];
  for (const change of trackedChanges) {
    paths.push(change.path);
  }
  for (const event of events.slice(-120)) {
    if (event.type === "file_changed") {
      paths.push(event.path);
    }
    if ("call" in event) {
      paths.push(...pathsFromToolCall(event.call));
    }
    if (event.type === "snapshot_restored") {
      paths.push(...event.paths);
    }
  }
  return uniquePaths(paths).slice(0, 20);
}

function pathsFromToolCall(call: ToolCall) {
  const input = call.input;
  if (!input || typeof input !== "object") {
    return [];
  }
  const record = input as Record<string, unknown>;
  return ["path", "file", "target"]
    .map((key) => record[key])
    .filter((value): value is string => typeof value === "string" && looksLikeProjectPath(value));
}

async function collectSearchCandidates(
  fileHost: FileToolHost,
  workspacePath: string,
  queryTerms: string[],
  candidates: Map<string, CandidateFile>
) {
  for (const term of queryTerms) {
    try {
      const result = await fileHost.searchFiles({
        workspacePath,
        path: ".",
        query: term,
        maxResults: MAX_SEARCH_RESULTS_PER_TERM
      });
      for (const match of result.matches) {
        if (!match.isDir && isIndexablePath(match.path)) {
          addCandidate(candidates, match.path, scorePathMatch(match.path, term), `路径匹配 ${term}`);
        }
      }
    } catch {
      // Indexing is advisory; failed searches should not block the turn.
    }
  }
}

async function collectSymbolCandidates(
  fileHost: FileToolHost,
  workspacePath: string,
  queryTerms: string[],
  candidates: Map<string, CandidateFile>
) {
  for (const term of queryTerms.slice(0, 4)) {
    try {
      const result = await fileHost.grepFiles({
        workspacePath,
        path: ".",
        pattern: term,
        maxResults: 12
      });
      for (const match of result.matches) {
        if (isIndexablePath(match.path)) {
          addCandidate(candidates, match.path, 20, `内容匹配 ${term}:${match.lineNumber}`);
        }
      }
    } catch {
      // Best-effort only.
    }
  }
}

function collectImpactCandidates(candidates: Map<string, CandidateFile>, paths: string[]) {
  for (const path of uniquePaths(paths).slice(0, 12)) {
    for (const related of relatedTestCandidates(path)) {
      addCandidate(candidates, related, 18, `可能受 ${path} 影响`);
    }
  }
}

function collectGraphCandidates(input: {
  candidates: Map<string, CandidateFile>;
  index: PersistentProjectIndex | null;
  queryTerms: string[];
  seedPaths: string[];
}): ProjectIndexGraphSummary | null {
  const index = input.index;
  if (!index || index.documents.length === 0) {
    return null;
  }

  const documents = index.documents;
  const documentsByPath = new Map(documents.map((document) => [document.path, document]));
  const knownPaths = new Set(documents.map((document) => document.path));
  const symbolOwners = symbolOwnersByName(documents);
  const impactFiles = new Map<string, ProjectIndexImpactFile>();
  const edges: ProjectIndexGraphEdge[] = [];
  const seedPaths = uniquePaths([...input.seedPaths, ...input.candidates.keys()]).slice(0, 16);

  for (const term of input.queryTerms) {
    const normalizedTerm = term.toLowerCase();
    if (normalizedTerm.length < 3) {
      continue;
    }
    for (const document of documents) {
      for (const symbol of document.symbols) {
        const normalizedName = symbol.name.toLowerCase();
        if (normalizedName !== normalizedTerm && !normalizedName.includes(normalizedTerm)) {
          continue;
        }
        addGraphCandidate(input.candidates, impactFiles, document.path, 36, `符号匹配 ${symbol.name}`);
        collectSymbolCallers({
          candidates: input.candidates,
          documents,
          edges,
          impactFiles,
          ownerPath: document.path,
          score: 24,
          symbolName: symbol.name
        });
      }
    }
  }

  for (const seedPath of seedPaths) {
    const seedDocument = documentsByPath.get(seedPath);
    if (!seedDocument) {
      continue;
    }

    for (const dependency of seedDocument.dependencies) {
      const targetPath = resolveDependencyPath(seedDocument.path, dependency.target, knownPaths);
      if (!targetPath) {
        continue;
      }
      addGraphCandidate(input.candidates, impactFiles, targetPath, 18, `${seedDocument.path} 依赖`);
      addGraphEdge(edges, seedDocument.path, targetPath, "imports");
    }

    for (const document of documents) {
      if (document.path === seedPath) {
        continue;
      }
      if (document.dependencies.some((dependency) => resolveDependencyPath(document.path, dependency.target, knownPaths) === seedPath)) {
        addGraphCandidate(input.candidates, impactFiles, document.path, 38, `依赖 ${seedPath}`);
        addGraphEdge(edges, document.path, seedPath, "imports");
      }
    }

    for (const symbol of seedDocument.symbols) {
      collectSymbolCallers({
        candidates: input.candidates,
        documents,
        edges,
        impactFiles,
        ownerPath: seedDocument.path,
        score: 32,
        symbolName: symbol.name
      });
    }
  }

  for (const candidatePath of [...input.candidates.keys()].slice(0, 12)) {
    const candidateDocument = documentsByPath.get(candidatePath);
    if (!candidateDocument) {
      continue;
    }
    for (const reference of candidateDocument.references) {
      const owners = symbolOwners.get(reference.name.toLowerCase()) ?? [];
      for (const ownerPath of owners) {
        if (ownerPath === candidateDocument.path) {
          continue;
        }
        addGraphCandidate(input.candidates, impactFiles, ownerPath, 16, `${candidateDocument.path} 引用 ${reference.name}`);
        addGraphEdge(edges, candidateDocument.path, ownerPath, `references ${reference.name}`);
      }
    }
  }

  const impactedFiles = [...impactFiles.values()]
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, MAX_GRAPH_IMPACT_FILES);
  return impactedFiles.length > 0 || edges.length > 0
    ? { edges: edges.slice(0, MAX_GRAPH_EDGES), impactedFiles }
    : null;
}

function collectSymbolCallers(input: {
  candidates: Map<string, CandidateFile>;
  documents: IndexedProjectDocument[];
  edges: ProjectIndexGraphEdge[];
  impactFiles: Map<string, ProjectIndexImpactFile>;
  ownerPath: string;
  score: number;
  symbolName: string;
}) {
  const normalizedName = input.symbolName.toLowerCase();
  for (const document of input.documents) {
    if (document.path === input.ownerPath) {
      continue;
    }
    if (!document.references.some((reference) => reference.name.toLowerCase() === normalizedName)) {
      continue;
    }
    addGraphCandidate(input.candidates, input.impactFiles, document.path, input.score, `引用 ${input.symbolName}`);
    addGraphEdge(input.edges, document.path, input.ownerPath, `references ${input.symbolName}`);
  }
}

function symbolOwnersByName(documents: IndexedProjectDocument[]) {
  const owners = new Map<string, string[]>();
  for (const document of documents) {
    for (const symbol of document.symbols) {
      const key = symbol.name.toLowerCase();
      owners.set(key, uniquePaths([...(owners.get(key) ?? []), document.path]));
    }
  }
  return owners;
}

function addGraphCandidate(
  candidates: Map<string, CandidateFile>,
  impactFiles: Map<string, ProjectIndexImpactFile>,
  path: string,
  score: number,
  reason: string
) {
  addCandidate(candidates, path, score, reason);
  const normalized = normalizeProjectPath(path);
  const existing = impactFiles.get(normalized);
  if (existing) {
    existing.score += score;
    existing.reasons = uniqueStrings([...existing.reasons, reason]).slice(0, 3);
    return;
  }
  impactFiles.set(normalized, { path: normalized, reasons: [reason], score });
}

function addGraphEdge(edges: ProjectIndexGraphEdge[], fromPath: string, toPath: string, label: string) {
  const edge = {
    fromPath: normalizeProjectPath(fromPath),
    label,
    toPath: normalizeProjectPath(toPath)
  };
  if (!edge.fromPath || !edge.toPath || edge.fromPath === edge.toPath) {
    return;
  }
  if (edges.some((item) => item.fromPath === edge.fromPath && item.toPath === edge.toPath && item.label === edge.label)) {
    return;
  }
  edges.push(edge);
}

async function hydrateProjectIndexFiles(
  fileHost: FileToolHost,
  workspacePath: string,
  candidates: Map<string, CandidateFile>
): Promise<ProjectIndexFile[]> {
  const ranked = [...candidates.values()]
    .filter((candidate) => isIndexablePath(candidate.path))
    .sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))
    .slice(0, MAX_RELEVANT_FILES);

  const files: ProjectIndexFile[] = [];
  for (const candidate of ranked) {
    const symbols = files.length < MAX_SYMBOL_FILES
      ? await safeExtractSymbols(fileHost, workspacePath, candidate.path)
      : [];
    files.push({
      path: candidate.path,
      reasons: [...candidate.reasons].slice(0, 3),
      score: candidate.score,
      symbols
    });
  }
  return files;
}

async function safeExtractSymbols(fileHost: FileToolHost, workspacePath: string, path: string) {
  try {
    const file = await fileHost.readText({ workspacePath, path });
    return extractSymbols(path, file.content.slice(0, MAX_FILE_READ_CHARS)).slice(0, MAX_SYMBOLS_PER_FILE);
  } catch {
    return [];
  }
}

function extractDependencies(path: string, content: string): ProjectIndexDependency[] {
  const dependencies: ProjectIndexDependency[] = [];
  const extension = pathExtension(path);
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (["ts", "tsx", "js", "jsx", "mjs", "cjs"].includes(extension)) {
      collectDependencyMatches(dependencies, line, index + 1, /\b(?:import|export)\s+(?:type\s+)?(?:[^'"]*?\s+from\s+)?["']([^"']+)["']/g, "import");
      collectDependencyMatches(dependencies, line, index + 1, /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, "dynamic_import");
      collectDependencyMatches(dependencies, line, index + 1, /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, "require");
    } else if (extension === "py") {
      collectDependencyMatches(dependencies, line, index + 1, /^\s*from\s+([A-Za-z_][\w.]*)\s+import\b/g, "module");
      collectDependencyMatches(dependencies, line, index + 1, /^\s*import\s+([A-Za-z_][\w.]*)/g, "module");
    } else if (extension === "go") {
      collectDependencyMatches(dependencies, line, index + 1, /^\s*"([^"]+)"/g, "module");
      collectDependencyMatches(dependencies, line, index + 1, /^\s*import\s+"([^"]+)"/g, "module");
    } else if (extension === "rs") {
      collectDependencyMatches(dependencies, line, index + 1, /^\s*mod\s+([A-Za-z_][\w]*)\s*;/g, "module");
      collectDependencyMatches(dependencies, line, index + 1, /^\s*use\s+([^;]+);/g, "module");
    }

    if (dependencies.length >= MAX_DEPENDENCIES_PER_FILE) {
      break;
    }
  }

  const seen = new Set<string>();
  return dependencies.filter((dependency) => {
    const key = `${dependency.kind}:${dependency.target}:${dependency.line}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function collectDependencyMatches(
  dependencies: ProjectIndexDependency[],
  line: string,
  lineNumber: number,
  pattern: RegExp,
  kind: ProjectIndexDependency["kind"]
) {
  for (const match of line.matchAll(pattern)) {
    const target = match[1]?.trim();
    if (!target) {
      continue;
    }
    dependencies.push({ kind, line: lineNumber, target });
  }
}

function extractReferences(content: string): ProjectIndexReference[] {
  const references: ProjectIndexReference[] = [];
  const seen = new Set<string>();
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    collectReferenceMatches(references, seen, line, index + 1, /\bnew\s+([A-Z][A-Za-z0-9_$]*)\b/g, "construct");
    collectReferenceMatches(references, seen, line, index + 1, /<([A-Z][A-Za-z0-9_$]*)\b/g, "component");
    collectReferenceMatches(references, seen, line, index + 1, /\b([A-Za-z_$][\w$]*)\s*\(/g, "call");
    if (references.length >= MAX_REFERENCES_PER_FILE) {
      break;
    }
  }
  return references.slice(0, MAX_REFERENCES_PER_FILE);
}

function collectReferenceMatches(
  references: ProjectIndexReference[],
  seen: Set<string>,
  line: string,
  lineNumber: number,
  pattern: RegExp,
  kind: ProjectIndexReference["kind"]
) {
  for (const match of line.matchAll(pattern)) {
    const name = match[1];
    if (!name || shouldSkipReference(line, match.index ?? 0, name, kind)) {
      continue;
    }
    const key = `${kind}:${name}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    references.push({ kind, line: lineNumber, name });
  }
}

function shouldSkipReference(line: string, matchIndex: number, name: string, kind: ProjectIndexReference["kind"]) {
  if (REFERENCE_STOP_WORDS.has(name)) {
    return true;
  }
  if (kind !== "call") {
    return false;
  }
  if (line[matchIndex - 1] === ".") {
    return true;
  }
  const before = line.slice(0, matchIndex);
  return /\b(function|def|fn)\s+$/.test(before) ||
    new RegExp(`\\b(?:const|let|var)\\s+${escapeRegExp(name)}\\s*=\\s*$`).test(before) ||
    /\b(if|for|while|switch|catch)\s*$/.test(before);
}

function extractSymbols(path: string, content: string): ProjectIndexSymbol[] {
  const extension = pathExtension(path);
  const symbols: ProjectIndexSymbol[] = [];
  const patterns = symbolPatternsForExtension(extension);
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index].trim();
    for (const pattern of patterns) {
      const match = pattern.regex.exec(line);
      if (match?.[1]) {
        symbols.push({ kind: pattern.kind, line: index + 1, name: match[1] });
        break;
      }
    }
  }
  return symbols;
}

function symbolPatternsForExtension(extension: string) {
  if (["ts", "tsx", "js", "jsx"].includes(extension)) {
    return [
      { kind: "function", regex: /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/ },
      { kind: "component", regex: /^(?:export\s+)?(?:const|let|var)\s+([A-Z][\w$]*)\s*=/ },
      { kind: "function", regex: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?\(/ },
      { kind: "class", regex: /^(?:export\s+)?class\s+([A-Za-z_$][\w$]*)/ },
      { kind: "type", regex: /^(?:export\s+)?(?:interface|type)\s+([A-Za-z_$][\w$]*)/ }
    ];
  }
  if (extension === "rs") {
    return [
      { kind: "function", regex: /^(?:pub(?:\([^)]*\))?\s+)?fn\s+([A-Za-z_][\w]*)/ },
      { kind: "struct", regex: /^(?:pub\s+)?struct\s+([A-Za-z_][\w]*)/ },
      { kind: "enum", regex: /^(?:pub\s+)?enum\s+([A-Za-z_][\w]*)/ },
      { kind: "impl", regex: /^impl(?:<[^>]+>)?\s+([A-Za-z_][\w]*)/ }
    ];
  }
  if (extension === "py") {
    return [
      { kind: "function", regex: /^(?:async\s+)?def\s+([A-Za-z_][\w]*)/ },
      { kind: "class", regex: /^class\s+([A-Za-z_][\w]*)/ }
    ];
  }
  if (extension === "go") {
    return [
      { kind: "function", regex: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_][\w]*)/ },
      { kind: "type", regex: /^type\s+([A-Za-z_][\w]*)/ }
    ];
  }
  return [
    { kind: "heading", regex: /^#{1,3}\s+(.+)$/ }
  ];
}

function formatProjectIndexContext(input: {
  graph: ProjectIndexGraphSummary | null;
  relevantFiles: ProjectIndexFile[];
  queryTerms: string[];
  recentPaths: string[];
  semanticIndex: ProjectIndexSemanticSummary | null;
}) {
  if (input.relevantFiles.length === 0 && input.recentPaths.length === 0 && !input.semanticIndex && !input.graph) {
    return "";
  }

  const lines = [
    "<codebase_context>",
    "Purpose: automatically retrieved codebase hints. Treat as leads, not proof; use read_file, grep_files, git_diff, or LSP tools before claiming exact behavior.",
    input.queryTerms.length ? `Query terms: ${input.queryTerms.join(", ")}` : "",
    input.semanticIndex ? formatSemanticIndexSummary(input.semanticIndex) : "",
    input.recentPaths.length ? "Recent working set:" : "",
    ...input.recentPaths.slice(0, 8).map((path) => `- ${path}`),
    input.relevantFiles.length ? "Relevant files:" : "",
    ...input.relevantFiles.map((file) => formatRelevantFile(file)),
    input.graph ? "Symbol graph / impact:" : "",
    ...(input.graph?.impactedFiles ?? []).map((file) => formatImpactFile(file)),
    ...(input.graph?.edges ?? []).map((edge) => `- ${edge.fromPath} -> ${edge.toPath} (${edge.label})`),
    "</codebase_context>"
  ].filter(Boolean);
  return lines.join("\n");
}

function formatSemanticIndexSummary(summary: ProjectIndexSemanticSummary) {
  const source = summary.source === "fresh" ? "rebuilt" : summary.source;
  return `Persistent vector index: ${summary.documentCount} files, source=${source}, updatedAt=${summary.updatedAt ?? "unknown"}`;
}

function formatRelevantFile(file: ProjectIndexFile) {
  const symbolText = file.symbols.length
    ? ` symbols=${file.symbols.map((symbol) => `${symbol.name}:${symbol.line}`).join(", ")}`
    : "";
  return `- ${file.path} [score=${file.score}] reasons=${file.reasons.join("; ")}${symbolText}`;
}

function formatImpactFile(file: ProjectIndexImpactFile) {
  return `- impacted ${file.path} [score=${file.score}] reasons=${file.reasons.join("; ")}`;
}

function addCandidate(candidates: Map<string, CandidateFile>, path: string, score: number, reason: string) {
  const normalized = normalizeProjectPath(path);
  if (!normalized || !isIndexablePath(normalized)) {
    return;
  }
  const existing = candidates.get(normalized);
  if (existing) {
    existing.score += score;
    existing.reasons.add(reason);
    return;
  }
  candidates.set(normalized, { path: normalized, reasons: new Set([reason]), score });
}

function scorePathMatch(path: string, term: string) {
  const lower = path.toLowerCase();
  const file = pathBaseName(lower);
  if (file === term) {
    return 80;
  }
  if (file.includes(term)) {
    return 55;
  }
  return 30;
}

function relatedTestCandidates(path: string) {
  const extension = pathExtension(path);
  if (!["ts", "tsx", "js", "jsx", "rs", "py", "go"].includes(extension)) {
    return [];
  }
  const withoutExtension = path.replace(/\.[^.\\/]+$/, "");
  const baseName = pathBaseName(withoutExtension);
  const directory = pathDirectory(withoutExtension);
  const candidates = [
    `${withoutExtension}.test.${extension}`,
    `${withoutExtension}.spec.${extension}`,
    directory ? `${directory}/__tests__/${baseName}.test.${extension}` : `__tests__/${baseName}.test.${extension}`,
    `tests/${baseName}.test.${extension}`,
    `test/${baseName}.test.${extension}`
  ];
  return uniquePaths(candidates);
}

function resolveDependencyPath(fromPath: string, target: string, knownPaths: Set<string>) {
  if (!target.startsWith(".")) {
    return null;
  }

  const fromDirectory = pathDirectory(fromPath);
  const base = normalizePathSegments(`${fromDirectory}/${target}`);
  const extension = pathExtension(base);
  const candidates = extension
    ? [base]
    : [
        base,
        ...[...SOURCE_EXTENSIONS].map((candidateExtension) => `${base}.${candidateExtension}`),
        ...[...SOURCE_EXTENSIONS].map((candidateExtension) => `${base}/index.${candidateExtension}`)
      ];
  return candidates.find((candidate) => knownPaths.has(candidate)) ?? null;
}

function isIndexablePath(path: string) {
  if (!path || path === ".") {
    return false;
  }
  const normalized = normalizeProjectPath(path);
  if (/(^|\/)(\.git|node_modules|target|dist|build|coverage|\.next|\.turbo|vendor)(\/|$)/.test(normalized)) {
    return false;
  }
  const extension = pathExtension(normalized);
  return SOURCE_EXTENSIONS.has(extension);
}

function looksLikeProjectPath(value: string) {
  return value.includes("/") || value.includes("\\") || /\.[A-Za-z0-9]{1,8}$/.test(value);
}

function normalizeProjectPath(path: string) {
  return path.trim().replace(/^["'`]+|["'`]+$/g, "").replace(/\\/g, "/").replace(/^\.\//, "");
}

function normalizePathSegments(path: string) {
  const segments: string[] = [];
  for (const segment of normalizeProjectPath(path).split("/")) {
    if (!segment || segment === ".") {
      continue;
    }
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  return segments.join("/");
}

function uniquePaths(paths: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const path of paths.map(normalizeProjectPath)) {
    if (path && !seen.has(path)) {
      seen.add(path);
      result.push(path);
    }
  }
  return result;
}

function uniqueStrings(values: string[]) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function pathExtension(path: string) {
  return pathBaseName(path).split(".").pop()?.toLowerCase() ?? "";
}

function pathBaseName(path: string) {
  return normalizeProjectPath(path).split("/").filter(Boolean).pop() ?? path;
}

function pathDirectory(path: string) {
  const parts = normalizeProjectPath(path).split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
