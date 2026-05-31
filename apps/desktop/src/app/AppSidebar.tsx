import type { MouseEvent, RefObject } from "react";
import { Button, Input } from "tdesign-react";
import { CommandIcon, DashboardIcon, EditIcon, FolderIcon, SearchIcon, SettingIcon } from "tdesign-icons-react";
import type { SessionSummary } from "../services/sessionStore";
import { formatConversationRelativeTime } from "./appShellUtils";
import { formatWorkspacePathForDisplay, type WorkspaceProject } from "../hooks/useWorkspaceProjects";
import { useI18n } from "../i18n/I18nProvider";

type AppSidebarProps = {
  expandedProjectPaths: Record<string, boolean>;
  filteredWorkspaceProjects: WorkspaceProject[];
  onCloseWorkspacePanels: () => void;
  onCommitRenameSession: (threadId: string) => void;
  onLoadSessionForWorkspace: (summary: SessionSummary) => void;
  onOpenAutomationPanel: () => void;
  onOpenNewSessionDialog: () => void;
  onOpenSearchPanel: () => void;
  onOpenSessionContextMenu: (event: MouseEvent<HTMLButtonElement>, summary: SessionSummary) => void;
  onOpenSettingsPanel: () => void;
  onOpenSkillsPanel: () => void;
  onRenameDraftChange: (value: string) => void;
  onRenamingThreadIdChange: (threadId: string | null) => void;
  onSearchQueryChange: (value: string) => void;
  onSwitchWorkspaceProject: (workspacePath: string) => void;
  onToggleWorkspaceProject: (workspacePath: string) => void;
  projectGroupsRef: RefObject<HTMLDivElement | null>;
  renameDraft: string;
  renamingThreadId: string | null;
  searchQuery: string;
  showAutomation: boolean;
  showSkills: boolean;
  sidebarSessionCount: number;
  threadId: string;
};

export function AppSidebar({
  expandedProjectPaths,
  filteredWorkspaceProjects,
  onCloseWorkspacePanels,
  onCommitRenameSession,
  onLoadSessionForWorkspace,
  onOpenAutomationPanel,
  onOpenNewSessionDialog,
  onOpenSearchPanel,
  onOpenSessionContextMenu,
  onOpenSettingsPanel,
  onOpenSkillsPanel,
  onRenameDraftChange,
  onRenamingThreadIdChange,
  onSearchQueryChange,
  onSwitchWorkspaceProject,
  onToggleWorkspaceProject,
  projectGroupsRef,
  renameDraft,
  renamingThreadId,
  searchQuery,
  showAutomation,
  showSkills,
  sidebarSessionCount,
  threadId
}: AppSidebarProps) {
  const { locale, t } = useI18n();

  return (
    <aside className="sidebar">
      <div className="window-chrome" aria-hidden="true">
        <span className="window-control close" />
        <span className="window-control minimize" />
        <span className="window-control zoom" />
      </div>

      <nav className="quick-nav" aria-label={t("app.aria.primaryActions")}>
        <Button block icon={<EditIcon size="16px" />} type="button" variant="text" onClick={onOpenNewSessionDialog}>{t("app.action.newChat")}</Button>
        <Button block icon={<SearchIcon size="16px" />} type="button" variant="text" onClick={onOpenSearchPanel}>{t("app.action.search")}</Button>
        <Button block className={showSkills ? "active" : ""} icon={<CommandIcon size="16px" />} type="button" variant="text" onClick={onOpenSkillsPanel}>{t("app.action.skills")}</Button>
        <Button block className={showAutomation ? "active" : ""} icon={<DashboardIcon size="16px" />} type="button" variant="text" onClick={onOpenAutomationPanel}>{t("app.action.automation")}</Button>
      </nav>

      <div className="sidebar-search">
        <Input
          clearable
          placeholder={t("app.placeholder.searchProjects")}
          prefixIcon={<SearchIcon size="14px" />}
          size="small"
          type="search"
          value={searchQuery}
          onChange={(value) => onSearchQueryChange(String(value))}
        />
      </div>

      <div className="project-heading">
        <span>{t("app.project.heading")}</span>
        <span className="project-heading-count">{t("app.project.sessionCount", { count: sidebarSessionCount })}</span>
        <button aria-label={t("app.action.addProject")} type="button" onClick={onOpenNewSessionDialog}>+</button>
      </div>

      <div className="project-groups" ref={projectGroupsRef}>
        {filteredWorkspaceProjects.map((project) => {
          const projectExpanded = searchQuery.trim() ? true : expandedProjectPaths[project.workspacePath] ?? true;

          return (
            <section className="project-group" data-workspace-path={project.workspacePath} key={project.workspacePath}>
              <button
                aria-expanded={projectExpanded}
                className={project.isCurrent ? "brand project-card project-toggle active" : "brand project-card project-toggle"}
                title={project.workspacePath === "." ? t("app.project.currentWorkspace") : formatWorkspacePathForDisplay(project.workspacePath)}
                type="button"
                onClick={() => {
                  if (project.isCurrent) {
                    onToggleWorkspaceProject(project.workspacePath);
                  } else {
                    onSwitchWorkspaceProject(project.workspacePath);
                  }
                }}
              >
                <span className="project-collapse-caret" aria-hidden="true" />
                <span className="project-folder-icon"><FolderIcon size="18px" /></span>
                <div>
                  <strong>{project.name}</strong>
                  <small>{project.workspacePath === "." ? t("app.project.currentWorkspace") : formatWorkspacePathForDisplay(project.workspacePath)}</small>
                </div>
                <span className="project-count">{project.sessions.length}</span>
              </button>

              {projectExpanded ? <div className="conversation-list project-conversation-list" data-workspace-path={project.workspacePath}>
                {project.sessions.map((summary) => (
                  renamingThreadId === summary.threadId ? (
                    <input
                      autoFocus
                      className="conversation-rename-input"
                      key={summary.threadId}
                      onBlur={() => onCommitRenameSession(summary.threadId)}
                      onChange={(event) => onRenameDraftChange(event.currentTarget.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.currentTarget.blur();
                        }
                        if (event.key === "Escape") {
                          onRenamingThreadIdChange(null);
                          onRenameDraftChange("");
                        }
                      }}
                      value={renameDraft}
                    />
                  ) : (
                    <button
                      className={summary.threadId === threadId ? "conversation-item active" : "conversation-item"}
                      data-thread-id={summary.threadId}
                      key={summary.threadId}
                      onClick={() => {
                        if (summary.threadId === threadId) {
                          onCloseWorkspacePanels();
                          return;
                        }
                        onLoadSessionForWorkspace(summary);
                      }}
                      onContextMenu={(event) => onOpenSessionContextMenu(event, summary)}
                      title={summary.title}
                      type="button"
                    >
                      <span>{summary.title}</span>
                      <small>{formatConversationRelativeTime(summary.updatedAt, locale)}</small>
                    </button>
                  )
                ))}
              </div> : null}
            </section>
          );
        })}
        {filteredWorkspaceProjects.length === 0 ? (
          <div className="sidebar-empty-search">
            <strong>{t("app.empty.noMatches")}</strong>
            <p>{t("app.empty.noMatchesHelp")}</p>
            <button type="button" onClick={() => onSearchQueryChange("")}>{t("app.action.clearSearch")}</button>
          </div>
        ) : null}
      </div>

      <div className="sidebar-footer">
        <Button icon={<SettingIcon size="16px" />} type="button" variant="text" onClick={onOpenSettingsPanel}>{t("app.action.settings")}</Button>
      </div>
    </aside>
  );
}
