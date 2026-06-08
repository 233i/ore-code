import { Button, Popup } from "tdesign-react";
import type { DeepSeekModelMode, ProviderThinkingLevel } from "@ore-code/agent-core";
import { CheckIcon, ChevronDownIcon, ShieldErrorIcon } from "tdesign-icons-react";
import { deepSeekModelModeLabel, deepSeekModelOptions } from "./deepSeekModelOptions";
import { thinkingLabelForProvider, thinkingOptionsForProvider } from "./deepSeekThinkingOptions";
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
  deepSeekThinkingLevel: ProviderThinkingLevel;
  lastResolvedDeepSeekModel?: string;
  modelLabel: string;
  onDeepSeekModelModeChange: (mode: DeepSeekModelMode) => void;
  onDeepSeekThinkingLevelChange: (level: ProviderThinkingLevel) => void;
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
  const thinkingOptions = thinkingOptionsForProvider(provider);
  const thinkingValue = thinkingOptions.some((option) => option.value === deepSeekThinkingLevel)
    ? deepSeekThinkingLevel
    : "auto";
  const providerLabel = providerOptions.find((option) => option.value === provider)?.label ?? modelLabel;
  const triggerLabel = provider === "deepseek"
    ? `${providerLabel} · ${deepSeekProviderButtonLabel(deepSeekModelMode, lastResolvedDeepSeekModel)} · ${thinkingLabelForProvider(provider, thinkingValue)}`
    : provider === "mimo"
      ? `${providerLabel} · ${thinkingLabelForProvider(provider, thinkingValue)}`
      : modelLabel;

  return (
    <Popup
      destroyOnClose
      overlayInnerClassName="composer-menu-popover provider-menu-popover"
      placement="top-right"
      trigger="click"
      content={(
        <div className="provider-menu">
          <div className="provider-menu-section">
            <div className="provider-menu-label">Provider</div>
            <div className="provider-switcher" role="group" aria-label="Provider">
              {providerOptions.map((option) => (
                <button
                  className={option.value === provider ? "provider-chip active" : "provider-chip"}
                  key={option.value}
                  type="button"
                  onClick={() => onProviderChange(option.value)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          {provider === "deepseek" ? (
            <>
              <ProviderSegmentGroup
                ariaLabel="DeepSeek 模型"
                label="模型"
                options={deepSeekModelOptions}
                value={deepSeekModelMode}
                onChange={onDeepSeekModelModeChange}
              />
              <ProviderSegmentGroup
                ariaLabel="DeepSeek 思考"
                label="思考"
                options={thinkingOptions}
                value={thinkingValue}
                onChange={onDeepSeekThinkingLevelChange}
              />
            </>
          ) : null}
          {provider === "mimo" ? (
            <ProviderSegmentGroup
              ariaLabel="Mimo 思考"
              label="思考"
              options={thinkingOptions}
              value={thinkingValue}
              onChange={onDeepSeekThinkingLevelChange}
            />
          ) : null}
        </div>
      )}
    >
      <Button className="provider-trigger" suffix={<ChevronDownIcon size="14px" />} type="button" variant="text">
        {triggerLabel}
      </Button>
    </Popup>
  );
}

function ProviderSegmentGroup<T extends string>({
  ariaLabel,
  label,
  options,
  value,
  onChange
}: {
  ariaLabel: string;
  label: string;
  options: Array<{ description?: string; label: string; value: T }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="provider-menu-section">
      <div className="provider-menu-label">{label}</div>
      <div className="provider-segmented" role="group" aria-label={ariaLabel}>
        {options.map((option) => (
          <button
            className={option.value === value ? "provider-segment active" : "provider-segment"}
            key={option.value}
            title={option.description}
            type="button"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function deepSeekProviderButtonLabel(mode: DeepSeekModelMode, lastResolvedModel: string | undefined) {
  const modeLabel = deepSeekModelModeLabel(mode);
  if (mode !== "auto" || !lastResolvedModel) {
    return modeLabel;
  }
  return `${modeLabel} · 本轮 ${lastResolvedModel.includes("flash") ? "Flash" : "Pro"}`;
}
