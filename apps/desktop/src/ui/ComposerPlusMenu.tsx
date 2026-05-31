import { Button, Popup, Switch } from "tdesign-react";
import {
  AddIcon,
  AiTerminalIcon,
  ArrowRightIcon,
  AttachmentListIcon,
  ComponentGridIcon,
  ToolsIcon
} from "tdesign-icons-react";

type ComposerPlusMenuProps = {
  includeIdeContext: boolean;
  onAddAttachment: () => void;
  onOpenSkills: () => void;
  onToggleIdeContext: (value: boolean) => void;
  onTogglePlanMode: (value: boolean) => void;
  planMode: boolean;
};

export function ComposerPlusMenu({
  includeIdeContext,
  onAddAttachment,
  onOpenSkills,
  onToggleIdeContext,
  onTogglePlanMode,
  planMode
}: ComposerPlusMenuProps) {
  return (
    <Popup
      destroyOnClose
      overlayInnerClassName="composer-menu-popover plus-menu-popover"
      placement="top-left"
      trigger="click"
      content={(
        <div className="composer-menu">
          <button className="composer-menu-row primary" type="button" onClick={onAddAttachment}>
            <AttachmentListIcon size="18px" />
            <span>添加照片和文件</span>
          </button>
          <div className="composer-menu-divider" />
          <label className="composer-menu-row">
            <AiTerminalIcon size="18px" />
            <span>包含 IDE 背景信息</span>
            <Switch size="small" value={includeIdeContext} onChange={(value) => onToggleIdeContext(Boolean(value))} />
          </label>
          <label className="composer-menu-row">
            <ToolsIcon size="18px" />
            <span>计划模式</span>
            <Switch size="small" value={planMode} onChange={(value) => onTogglePlanMode(Boolean(value))} />
          </label>
          <div className="composer-menu-divider" />
          <button className="composer-menu-row" type="button" onClick={onOpenSkills}>
            <ComponentGridIcon size="18px" />
            <span>技能</span>
            <ArrowRightIcon size="16px" />
          </button>
        </div>
      )}
    >
      <Button aria-label="添加上下文" className="composer-plus-button" icon={<AddIcon size="24px" />} shape="circle" type="button" variant="text" />
    </Popup>
  );
}
