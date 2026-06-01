import { Button, Popup } from "tdesign-react";
import type { DeepSeekModelMode, DeepSeekThinkingLevel } from "@ore-code/agent-core";
import { CheckIcon, ChevronDownIcon, ShieldErrorIcon } from "tdesign-icons-react";
import { deepSeekModelModeLabel, deepSeekModelOptions } from "./deepSeekModelOptions";
import { deepSeekThinkingOptions, deepSeekThinkingLabel } from "./deepSeekThinkingOptions";
import { permissionPresetLabel, type PermissionPreset } from "./permissionPreset";

export type ProviderOption = {
  label: string;
  value: string;
};

type PermissionOption = {
  description: string;
  label: string;
  preset: PermissionPreset;
  title: string;
};

const permissionOptions: PermissionOption[] = [
  {
    preset: "default",
    label: "默认权限",
    title: "Ore Code 会在工作区内运行低风险工具",
    description: "需要写文件、运行高风险命令或修改状态时，会先请求你审批。"
  },
  {
    preset: "autoReview",
    label: "自动审查",
    title: "Ore Code 会自动审查低风险请求",
    description: "只读和低风险命令自动通过；写入和高风险操作仍会弹出审批。"
  },
  {
    preset: "fullAccess",
    label: "完全访问权限",
    title: "Ore Code 对当前工作区拥有完全访问权限",
    description: "它可以直接编辑文件和执行命令，不再弹出审批或做风险拦截。"
  }
];

type PermissionMenuProps = {
  permissionPreset: PermissionPreset;
  setPermissionPreset: (preset: PermissionPreset) => void;
};

export function PermissionMenu({ permissionPreset, setPermissionPreset }: PermissionMenuProps) {
  return (
    <Popup
      destroyOnClose
      overlayInnerClassName="composer-menu-popover permission-menu-popover"
      placement="top-left"
      trigger="click"
      content={(
        <div className="permission-menu">
          <div className="permission-menu-list">
            {permissionOptions.map((option) => (
              <button
                className={option.preset === permissionPreset ? "permission-option active" : "permission-option"}
                key={option.preset}
                type="button"
                onClick={() => setPermissionPreset(option.preset)}
              >
                <ShieldErrorIcon size="18px" />
                <span>{option.label}</span>
                {option.preset === permissionPreset ? <CheckIcon size="16px" /> : null}
              </button>
            ))}
          </div>
          <div className="permission-menu-copy">
            {permissionOptions.map((option) => (
              <p key={option.preset} className={option.preset === permissionPreset ? "active" : ""}>
                <strong>{option.title}</strong>
                <span>{option.description}</span>
              </p>
            ))}
          </div>
        </div>
      )}
    >
      <Button
        className={`permission-trigger ${permissionPreset}`}
        icon={<ShieldErrorIcon size="17px" />}
        suffix={<ChevronDownIcon size="14px" />}
        type="button"
        variant="text"
      >
        {permissionPresetLabel(permissionPreset)}
      </Button>
    </Popup>
  );
}

type ProviderMenuProps = {
  deepSeekModelMode: DeepSeekModelMode;
  deepSeekThinkingLevel: DeepSeekThinkingLevel;
  lastResolvedDeepSeekModel?: string;
  modelLabel: string;
  onDeepSeekModelModeChange: (mode: DeepSeekModelMode) => void;
  onDeepSeekThinkingLevelChange: (level: DeepSeekThinkingLevel) => void;
  onProviderChange: (provider: string) => void;
  provider: string;
  providerOptions: readonly ProviderOption[];
};

export function ProviderMenu({
  deepSeekModelMode,
  deepSeekThinkingLevel,
  lastResolvedDeepSeekModel,
  modelLabel,
  onDeepSeekModelModeChange,
  onDeepSeekThinkingLevelChange,
  onProviderChange,
  provider,
  providerOptions
}: ProviderMenuProps) {
  return (
    <Popup
      destroyOnClose
      overlayInnerClassName="composer-menu-popover provider-menu-popover"
      placement="top-right"
      trigger="click"
      content={(
        <div className="provider-menu">
          {providerOptions.map((option) => (
            <button
              className={option.value === provider ? "provider-option active" : "provider-option"}
              key={option.value}
              type="button"
              onClick={() => onProviderChange(option.value)}
            >
              <span>{option.label}</span>
              {option.value === provider ? <CheckIcon size="16px" /> : null}
            </button>
          ))}
          {provider === "deepseek" ? (
            <>
              <div className="composer-menu-divider" />
              <div className="provider-menu-heading">DeepSeek 模型</div>
              {deepSeekModelOptions.map((option) => (
                <button
                  className={option.value === deepSeekModelMode ? "provider-option thinking active" : "provider-option thinking"}
                  key={option.value}
                  type="button"
                  onClick={() => onDeepSeekModelModeChange(option.value)}
                >
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  {option.value === deepSeekModelMode ? <CheckIcon size="16px" /> : null}
                </button>
              ))}
              <div className="composer-menu-divider" />
              <div className="provider-menu-heading">DeepSeek 思考</div>
              {deepSeekThinkingOptions.map((option) => (
                <button
                  className={option.value === deepSeekThinkingLevel ? "provider-option thinking active" : "provider-option thinking"}
                  key={option.value}
                  type="button"
                  onClick={() => onDeepSeekThinkingLevelChange(option.value)}
                >
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.description}</small>
                  </span>
                  {option.value === deepSeekThinkingLevel ? <CheckIcon size="16px" /> : null}
                </button>
              ))}
            </>
          ) : null}
        </div>
      )}
    >
      <Button className="provider-trigger" suffix={<ChevronDownIcon size="14px" />} type="button" variant="text">
        {provider === "deepseek"
          ? `${deepSeekProviderButtonLabel(deepSeekModelMode, lastResolvedDeepSeekModel)} · ${deepSeekThinkingLabel(deepSeekThinkingLevel)}`
          : modelLabel}
      </Button>
    </Popup>
  );
}

function deepSeekProviderButtonLabel(mode: DeepSeekModelMode, lastResolvedModel: string | undefined) {
  const modeLabel = deepSeekModelModeLabel(mode);
  if (mode !== "auto" || !lastResolvedModel) {
    return modeLabel;
  }
  return `${modeLabel} · 本轮 ${lastResolvedModel.includes("flash") ? "Flash" : "Pro"}`;
}
