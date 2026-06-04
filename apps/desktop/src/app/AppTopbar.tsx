import { Button } from "tdesign-react";
import { FolderIcon, ModeDarkIcon, ModeLightIcon, SettingIcon, TaskIcon, ToolsIcon } from "tdesign-icons-react";
import { projectIndexStatusLabel, projectIndexStatusTitle } from "./appShellUtils";
import type { ProjectIndexStatus } from "./appTypes";
import { useI18n } from "../i18n/I18nProvider";

type AppTopbarProps = {
  conversationTitle: string;
  currentWorkspaceLabel: string;
  eventsCount: number;
  activeTaskCount: number;
  onOpenSettings: () => void;
  onOpenTaskWorkspace: () => void;
  onOpenWorkspaceDialog: () => void;
  onThemePreferenceChange: (value: "light" | "dark") => void;
  onToggleInspector: () => void;
  projectIndexStatus: ProjectIndexStatus;
  resolvedTheme: "light" | "dark";
  sessionMessage: string | null;
  showInspector: boolean;
  showTasks: boolean;
  workspacePath: string;
};

export function AppTopbar({
  conversationTitle,
  currentWorkspaceLabel,
  eventsCount,
  activeTaskCount,
  onOpenSettings,
  onOpenTaskWorkspace,
  onOpenWorkspaceDialog,
  onThemePreferenceChange,
  onToggleInspector,
  projectIndexStatus,
  resolvedTheme,
  sessionMessage,
  showInspector,
  showTasks,
  workspacePath
}: AppTopbarProps) {
  const { locale, t } = useI18n();
  const ThemeIcon = resolvedTheme === "dark" ? ModeLightIcon : ModeDarkIcon;
  const themeLabel = resolvedTheme === "dark" ? t("app.theme.light") : t("app.theme.dark");
  const inspectorLabel = showInspector ? t("app.topbar.hideInspector") : t("app.topbar.showInspector");

  return (
    <header className="topbar">
      <div className="topbar-title">
        <div className="chat-title-stack">
          <div className="chat-title-row">
            <h1>{eventsCount > 0 ? conversationTitle : t("app.action.newChat")}</h1>
            <button
              className={workspacePath === "." ? "workspace-context-chip empty" : "workspace-context-chip"}
              title={workspacePath === "." ? t("app.project.selectFolder") : workspacePath}
              type="button"
              onClick={onOpenWorkspaceDialog}
            >
              <FolderIcon size="14px" />
              <span>{currentWorkspaceLabel}</span>
            </button>
            {projectIndexStatus.state !== "idle" ? (
              <span
                className={`project-index-status ${projectIndexStatus.state}`}
                title={projectIndexStatusTitle(projectIndexStatus, locale)}
              >
                <span className="project-index-status-dot" aria-hidden="true" />
                {projectIndexStatusLabel(projectIndexStatus, locale)}
              </span>
            ) : null}
          </div>
          {sessionMessage ? <p className="topbar-message">{sessionMessage}</p> : null}
        </div>
      </div>
      <div className="topbar-actions" aria-label={t("app.aria.workspaceControls")}>
        <button
          aria-label={t("app.action.tasks")}
          className={showTasks ? "topbar-task-button active" : "topbar-task-button"}
          title={t("app.action.tasks")}
          type="button"
          onClick={onOpenTaskWorkspace}
        >
          <TaskIcon size="16px" />
          <span>{t("app.action.tasks")}</span>
          {activeTaskCount > 0 ? <strong>{activeTaskCount}</strong> : null}
        </button>
        <Button
          aria-label={themeLabel}
          className="icon-button"
          icon={<ThemeIcon size="17px" />}
          shape="square"
          title={themeLabel}
          type="button"
          variant="text"
          onClick={() => onThemePreferenceChange(resolvedTheme === "dark" ? "light" : "dark")}
        />
        <Button
          aria-label={t("app.action.settings")}
          className="icon-button"
          icon={<SettingIcon size="17px" />}
          shape="square"
          type="button"
          variant="text"
          onClick={onOpenSettings}
        />
        <Button
          aria-label={inspectorLabel}
          className={showInspector ? "icon-button active" : "icon-button"}
          icon={<ToolsIcon size="18px" />}
          shape="square"
          type="button"
          variant="text"
          onClick={onToggleInspector}
        />
      </div>
    </header>
  );
}
