import { useRef, useState } from "react";
import {
  createRuntimeMcpHost,
  emptyMcpSnapshot,
  mcpConnectionSummary,
  type McpAddServerInput,
  type McpCallOutput,
  type McpServerSnapshot,
  type McpServerStatus,
  type McpToolSnapshot
} from "../services/mcpHost";
import { isTauriRuntime } from "../services/fileHost";

function messageFromUnknown(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function markMcpServers(snapshot: McpToolSnapshot, names: string[], status: McpServerStatus) {
  const targets = new Set(names);
  return rebuildMcpSnapshot({
    ...snapshot,
    servers: snapshot.servers.map((server) => (
      targets.has(server.name) ? mcpServerWithStatus(server, status) : server
    ))
  });
}

function markMcpServerStatus(
  snapshot: McpToolSnapshot,
  name: string,
  status: McpServerStatus,
  error?: string
) {
  return rebuildMcpSnapshot({
    ...snapshot,
    servers: snapshot.servers.map((server) => (
      server.name === name ? mcpServerWithStatus(server, status, error) : server
    ))
  });
}

function mcpServerWithStatus(server: McpServerSnapshot, status: McpServerStatus, error?: string): McpServerSnapshot {
  if (status === "connected") {
    return { ...server, error };
  }

  return {
    ...server,
    error,
    promptCount: 0,
    prompts: [],
    resourceCount: 0,
    resources: [],
    status,
    toolCount: 0,
    tools: []
  };
}

function rebuildMcpSnapshot(snapshot: McpToolSnapshot): McpToolSnapshot {
  return {
    ...snapshot,
    prompts: snapshot.servers.flatMap((server) => server.prompts),
    resources: snapshot.servers.flatMap((server) => server.resources),
    tools: snapshot.servers.flatMap((server) => server.tools)
  };
}

export function useMcpManager(options: { setPromptText: (text: string) => void }) {
  const [mcpSnapshot, setMcpSnapshot] = useState<McpToolSnapshot | null>(null);
  const [mcpMessage, setMcpMessage] = useState<string | null>(null);
  const [mcpBusyLabel, setMcpBusyLabel] = useState<string | null>(null);
  const mcpReloadRunRef = useRef(0);

  async function refreshMcpTools(reload = false) {
    if (reload) {
      return reconnectMcpServers();
    }

    setMcpBusyLabel("正在读取 MCP 配置...");
    try {
      const host = createRuntimeMcpHost();
      const snapshot = await host.loadSnapshot();
      setMcpSnapshot(snapshot);
      setMcpMessage(mcpConnectionSummary(snapshot));
      return snapshot;
    } catch (error) {
      const fallback = emptyMcpSnapshot({ error: messageFromUnknown(error), supported: isTauriRuntime() });
      setMcpSnapshot(fallback);
      setMcpMessage(messageFromUnknown(error));
      return fallback;
    } finally {
      setMcpBusyLabel(null);
    }
  }

  async function reconnectMcpServers() {
    const runId = mcpReloadRunRef.current + 1;
    mcpReloadRunRef.current = runId;
    const host = createRuntimeMcpHost();
    setMcpBusyLabel("正在准备重连 MCP...");
    try {
      await host.stopAll();
      if (mcpReloadRunRef.current !== runId) {
        return null;
      }

      const configSnapshot = await host.configStatus();
      setMcpSnapshot(configSnapshot);
      const servers = configSnapshot.servers.filter((server) => server.status !== "disabled");
      if (!configSnapshot.supported || !configSnapshot.configured || servers.length === 0) {
        setMcpMessage(mcpConnectionSummary(configSnapshot));
        return configSnapshot;
      }

      setMcpBusyLabel(`正在重连 MCP（0/${servers.length}）...`);
      setMcpSnapshot(markMcpServers(configSnapshot, servers.map((server) => server.name), "connecting"));
      let completed = 0;
      let latestSnapshot: McpToolSnapshot = configSnapshot;
      await Promise.allSettled(servers.map(async (server) => {
        try {
          const snapshot = await host.reloadServer(server.name);
          completed += 1;
          if (mcpReloadRunRef.current !== runId) {
            return;
          }
          latestSnapshot = snapshot;
          setMcpSnapshot(snapshot);
          setMcpBusyLabel(`正在重连 MCP（${completed}/${servers.length}）...`);
        } catch (error) {
          completed += 1;
          if (mcpReloadRunRef.current !== runId) {
            return;
          }
          const message = messageFromUnknown(error);
          latestSnapshot = markMcpServerStatus(latestSnapshot, server.name, "failed", message);
          setMcpSnapshot(latestSnapshot);
          setMcpBusyLabel(`正在重连 MCP（${completed}/${servers.length}）...`);
        }
      }));

      if (mcpReloadRunRef.current !== runId) {
        return latestSnapshot;
      }
      const finalSnapshot = await host.loadSnapshot();
      setMcpSnapshot(finalSnapshot);
      setMcpMessage(mcpConnectionSummary(finalSnapshot));
      return finalSnapshot;
    } catch (error) {
      if (mcpReloadRunRef.current !== runId) {
        return null;
      }
      const fallback = emptyMcpSnapshot({ error: messageFromUnknown(error), supported: isTauriRuntime() });
      setMcpSnapshot(fallback);
      setMcpMessage(messageFromUnknown(error));
      return fallback;
    } finally {
      if (mcpReloadRunRef.current === runId) {
        setMcpBusyLabel(null);
      }
    }
  }

  async function initMcpConfig() {
    setMcpBusyLabel("正在初始化 MCP 配置...");
    try {
      const snapshot = await createRuntimeMcpHost().initConfig();
      setMcpSnapshot(snapshot);
      setMcpMessage(`已初始化 MCP 配置：${snapshot.configPath}`);
    } catch (error) {
      setMcpMessage(messageFromUnknown(error));
    } finally {
      setMcpBusyLabel(null);
    }
  }

  async function addMcpServer(input: McpAddServerInput) {
    setMcpBusyLabel(`正在添加 MCP server：${input.name}`);
    try {
      const snapshot = await createRuntimeMcpHost().addServer(input);
      setMcpSnapshot(snapshot);
      setMcpMessage(`已添加 MCP server：${input.name}`);
    } catch (error) {
      setMcpMessage(messageFromUnknown(error));
    } finally {
      setMcpBusyLabel(null);
    }
  }

  async function updateMcpServer(input: McpAddServerInput) {
    setMcpBusyLabel(`正在保存 MCP server：${input.name}`);
    try {
      const snapshot = await createRuntimeMcpHost().updateServer(input);
      setMcpSnapshot(snapshot);
      setMcpMessage(`已保存 MCP server：${input.name}`);
    } catch (error) {
      setMcpMessage(messageFromUnknown(error));
    } finally {
      setMcpBusyLabel(null);
    }
  }

  async function toggleMcpServer(name: string, enabled: boolean) {
    setMcpBusyLabel(`${enabled ? "正在启用" : "正在停用"} MCP server：${name}`);
    try {
      const snapshot = await createRuntimeMcpHost().setServerEnabled(name, enabled);
      setMcpSnapshot(snapshot);
      setMcpMessage(`${enabled ? "已启用" : "已停用"} MCP server：${name}`);
    } catch (error) {
      setMcpMessage(messageFromUnknown(error));
    } finally {
      setMcpBusyLabel(null);
    }
  }

  async function removeMcpServer(name: string) {
    setMcpBusyLabel(`正在移除 MCP server：${name}`);
    try {
      const snapshot = await createRuntimeMcpHost().removeServer(name);
      setMcpSnapshot(snapshot);
      setMcpMessage(`已移除 MCP server：${name}`);
    } catch (error) {
      setMcpMessage(messageFromUnknown(error));
    } finally {
      setMcpBusyLabel(null);
    }
  }

  async function stopAllMcpServers() {
    mcpReloadRunRef.current += 1;
    setMcpBusyLabel("正在停止全部 MCP server...");
    try {
      await createRuntimeMcpHost().stopAll();
      const snapshot = await createRuntimeMcpHost().configStatus();
      setMcpSnapshot(snapshot);
      setMcpMessage("已停止全部 MCP server。");
    } catch (error) {
      setMcpMessage(messageFromUnknown(error));
    } finally {
      setMcpBusyLabel(null);
    }
  }

  async function validateMcpConfig() {
    setMcpBusyLabel("正在校验 MCP 配置...");
    try {
      const result = await createRuntimeMcpHost().validateConfig();
      setMcpMessage(result.ok ? `MCP 配置有效：${result.servers.length} servers` : `MCP 配置无效：${result.errors.join("; ")}`);
    } catch (error) {
      setMcpMessage(messageFromUnknown(error));
    } finally {
      setMcpBusyLabel(null);
    }
  }

  async function readMcpResource(input: { serverName: string; uri: string }) {
    try {
      const output = await createRuntimeMcpHost().readResource(input);
      setMcpMessage(`已读取 MCP 资源：${input.uri}`);
      return output;
    } catch (error) {
      setMcpMessage(messageFromUnknown(error));
      return null;
    }
  }

  async function useMcpPrompt(input: { arguments?: Record<string, unknown>; name: string; serverName: string }) {
    try {
      const output = await createRuntimeMcpHost().getPrompt(input);
      options.setPromptText(output.prompt || JSON.stringify(output.content, null, 2));
      setMcpMessage(`已应用 MCP prompt：${input.name}`);
      return output;
    } catch (error) {
      setMcpMessage(messageFromUnknown(error));
      return null;
    }
  }

  async function callMcpTool(input: { arguments: Record<string, unknown>; qualifiedName: string }): Promise<McpCallOutput | null> {
    setMcpBusyLabel(`正在调用 MCP tool：${input.qualifiedName}`);
    try {
      const output = await createRuntimeMcpHost().callTool(input);
      setMcpMessage(output.isError ? `MCP tool 调用失败：${input.qualifiedName}` : `MCP tool 调用完成：${input.qualifiedName}`);
      return output;
    } catch (error) {
      setMcpMessage(messageFromUnknown(error));
      return null;
    } finally {
      setMcpBusyLabel(null);
    }
  }

  return {
    mcpSnapshot,
    mcpMessage,
    mcpBusyLabel,
    setMcpSnapshot,
    setMcpMessage,
    refreshMcpTools,
    initMcpConfig,
    addMcpServer,
    updateMcpServer,
    toggleMcpServer,
    removeMcpServer,
    stopAllMcpServers,
    validateMcpConfig,
    readMcpResource,
    callMcpTool,
    useMcpPrompt
  };
}
