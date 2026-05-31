import { invoke } from "@tauri-apps/api/core";
import { isTauriRuntime } from "./fileHost";

export interface ProviderSecretStatus {
  provider: string;
  source: "env" | "keychain" | "credential-manager" | "secret-service" | "missing" | "unsupported";
  hasSecret: boolean;
  last4?: string;
}

export interface ProviderSecretValue {
  provider: string;
  value: string;
  last4?: string;
}

export async function getProviderSecretStatus(provider: string): Promise<ProviderSecretStatus> {
  if (!isTauriRuntime()) {
    return unsupportedStatus(provider);
  }

  return invoke<ProviderSecretStatus>("provider_secret_status", { provider });
}

export async function getProviderSecret(provider: string): Promise<ProviderSecretValue> {
  if (!isTauriRuntime()) {
    throw new Error("浏览器预览不支持系统安全存储，请在 Tauri 桌面端使用。");
  }

  return invoke<ProviderSecretValue>("provider_secret_get", { provider });
}

export async function setProviderSecret(provider: string, value: string): Promise<ProviderSecretStatus> {
  if (!isTauriRuntime()) {
    throw new Error("浏览器预览不支持系统安全存储，请在 Tauri 桌面端使用。");
  }

  return invoke<ProviderSecretStatus>("provider_secret_set", { provider, value });
}

export async function deleteProviderSecret(provider: string): Promise<ProviderSecretStatus> {
  if (!isTauriRuntime()) {
    throw new Error("浏览器预览不支持系统安全存储，请在 Tauri 桌面端使用。");
  }

  return invoke<ProviderSecretStatus>("provider_secret_delete", { provider });
}

function unsupportedStatus(provider: string): ProviderSecretStatus {
  return {
    provider,
    source: "unsupported",
    hasSecret: false
  };
}
