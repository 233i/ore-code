export function formatWorkspacePathForDisplay(path: string) {
  return stripWindowsVerbatimPrefix(path || ".") || ".";
}

export function workspaceProjectName(workspacePath: string) {
  if (!workspacePath || workspacePath === ".") {
    return "SeekForge";
  }

  return workspacePathBasename(workspacePath) || formatWorkspacePathForDisplay(workspacePath);
}

export function sameWorkspacePath(left: string, right: string) {
  return normalizeWorkspacePath(left) === normalizeWorkspacePath(right);
}

export function normalizeWorkspacePath(path: string) {
  return (stripWindowsVerbatimPrefix(path || ".")).replace(/\\/g, "/").replace(/\/+$/, "") || ".";
}

export function addWorkspacePathPreservingOrder(paths: string[], path: string) {
  const normalizedPath = normalizeWorkspacePath(path);
  if (normalizedPath === ".") {
    return paths.filter((item) => normalizeWorkspacePath(item) !== ".");
  }

  const existing = paths
    .map(normalizeWorkspacePath)
    .filter((item) => item !== ".");
  const next = existing.includes(normalizedPath) ? existing : [...existing, normalizedPath];
  return next.slice(0, 12);
}

function workspacePathBasename(path: string) {
  return formatWorkspacePathForDisplay(path).split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function stripWindowsVerbatimPrefix(path: string) {
  const value = path.trim();
  if (/^\\\\\?\\UNC\\/i.test(value)) {
    return `\\\\${value.slice(8)}`;
  }
  if (/^\\\\\?\\[A-Za-z]:\\/i.test(value)) {
    return value.slice(4);
  }
  if (/^\/\/\?\/UNC\//i.test(value)) {
    return `//${value.slice(8)}`;
  }
  if (/^\/\/\?\/[A-Za-z]:\//i.test(value)) {
    return value.slice(4);
  }
  return value;
}
