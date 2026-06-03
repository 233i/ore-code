import type { FileToolHost } from "@ore-code/tools";
import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./fileHost";

export const USER_INSTRUCTIONS_PATH = ".ore-code/instructions.md";
export const PROJECT_INSTRUCTIONS_PATH = ".ore-code/instructions.md";
const MAX_INSTRUCTIONS_CHARS = 12_000;

export interface OreCodeInstructions {
  projectInstructions?: string;
  sources: Array<{ path: string; scope: "project" | "user"; status: "loaded" | "missing" | "error"; error?: string }>;
  userInstructions?: string;
}

export async function loadOreCodeInstructions(input: {
  fileHost: FileToolHost;
  userHomePath?: string;
  workspacePath: string;
}): Promise<OreCodeInstructions> {
  const sources: OreCodeInstructions["sources"] = [];
  let userInstructions: string | undefined;
  let projectInstructions: string | undefined;
  const canReadLocalFiles = isTauriRuntime() || Boolean(input.userHomePath);

  if (!canReadLocalFiles) {
    return { sources };
  }

  const userHomePath = input.userHomePath ?? (await resolveUserHomePath());
  if (userHomePath) {
    const userPath = relativeOreCodePath(userHomePath, "instructions.md");
    const userResult = await readOptionalInstructions(input.fileHost, userHomePath, userPath);
    sources.push({ path: displayUserPath(userPath), scope: "user", status: userResult.status, error: userResult.error });
    userInstructions = userResult.content;
  }

  if (input.workspacePath && input.workspacePath !== ".") {
    const projectPath = relativeOreCodePath(input.workspacePath, "instructions.md");
    const projectResult = await readOptionalInstructions(input.fileHost, input.workspacePath, projectPath);
    sources.push({ path: projectPath, scope: "project", status: projectResult.status, error: projectResult.error });
    projectInstructions = projectResult.content;
  }

  return {
    projectInstructions,
    sources,
    userInstructions
  };
}

async function resolveUserHomePath() {
  try {
    return await invoke<string>("user_home_dir");
  } catch {
    return null;
  }
}

async function readOptionalInstructions(
  fileHost: FileToolHost,
  workspacePath: string,
  path: string
): Promise<{ content?: string; error?: string; status: "loaded" | "missing" | "error" }> {
  try {
    const result = await fileHost.readText({ workspacePath, path });
    const content = result.content.trim();
    return content
      ? { content: truncateInstructions(content), status: "loaded" }
      : { status: "missing" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isMissingFile(message)) {
      return { status: "missing" };
    }
    return { error: message, status: "error" };
  }
}

function relativeOreCodePath(referencePath: string, fileName: string) {
  return [".ore-code", fileName].join(pathSeparatorFor(referencePath));
}

function displayUserPath(path: string) {
  return `~/${path.replace(/\\/g, "/")}`;
}

function truncateInstructions(content: string) {
  if (content.length <= MAX_INSTRUCTIONS_CHARS) {
    return content;
  }
  return `${content.slice(0, MAX_INSTRUCTIONS_CHARS)}\n\n[Ore Code instructions truncated at ${MAX_INSTRUCTIONS_CHARS} characters.]`;
}

function isMissingFile(message: string) {
  const lower = message.toLowerCase();
  return lower.includes("not found") || lower.includes("no such file") || lower.includes("os error 2");
}

function pathSeparatorFor(path: string) {
  return /^[A-Za-z]:[\\/]/.test(path) || path.includes("\\") ? "\\" : "/";
}
