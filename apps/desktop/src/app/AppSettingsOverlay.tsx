import type { ComponentProps } from "react";
import { SettingsFrame } from "../ui/SettingsFrame";
import {
  AboutSettingsSection,
  AutomationSettingsSection,
  DataSettingsSection,
  DoctorSettingsSection,
  GeneralSettingsSection,
  HarnessSettingsSection,
  McpSettingsSection,
  PermissionsSettingsSection,
  ProviderSettingsSection,
  ToolsSettingsSection,
  WorkspaceSettingsSection
} from "../ui/SettingsSections";
import type { SettingsSection } from "../ui/settingsConfig";

export type AppSettingsOverlayProps = {
  about: ComponentProps<typeof AboutSettingsSection>;
  activeSection: SettingsSection;
  automation: ComponentProps<typeof AutomationSettingsSection>;
  data: ComponentProps<typeof DataSettingsSection>;
  doctor: ComponentProps<typeof DoctorSettingsSection>;
  general: ComponentProps<typeof GeneralSettingsSection>;
  harness: ComponentProps<typeof HarnessSettingsSection>;
  mcp: ComponentProps<typeof McpSettingsSection>;
  onActiveSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onSave: () => void;
  permissions: ComponentProps<typeof PermissionsSettingsSection>;
  providers: ComponentProps<typeof ProviderSettingsSection>;
  query: string;
  showHarness: boolean;
  tools: ComponentProps<typeof ToolsSettingsSection>;
  visible: boolean;
  workspace: ComponentProps<typeof WorkspaceSettingsSection>;
};

export function AppSettingsOverlay({
  about,
  activeSection,
  automation,
  data,
  doctor,
  general,
  harness,
  mcp,
  onActiveSectionChange,
  onClose,
  onQueryChange,
  onSave,
  permissions,
  providers,
  query,
  showHarness,
  tools,
  visible,
  workspace
}: AppSettingsOverlayProps) {
  if (!visible) {
    return null;
  }

  return (
    <SettingsFrame
      activeSection={activeSection}
      onActiveSectionChange={onActiveSectionChange}
      onClose={onClose}
      onQueryChange={onQueryChange}
      onSave={onSave}
      query={query}
    >
      {activeSection === "general" ? <GeneralSettingsSection {...general} /> : null}
      {activeSection === "providers" ? <ProviderSettingsSection {...providers} /> : null}
      {activeSection === "permissions" ? <PermissionsSettingsSection {...permissions} /> : null}
      {activeSection === "workspace" ? <WorkspaceSettingsSection {...workspace} /> : null}
      {activeSection === "doctor" ? <DoctorSettingsSection {...doctor} /> : null}
      {activeSection === "tools" ? <ToolsSettingsSection {...tools} /> : null}
      {activeSection === "mcp" ? <McpSettingsSection {...mcp} /> : null}
      {activeSection === "automation" ? <AutomationSettingsSection {...automation} /> : null}
      {activeSection === "data" ? <DataSettingsSection {...data} /> : null}
      {showHarness && activeSection === "harness" ? <HarnessSettingsSection {...harness} /> : null}
      {activeSection === "about" ? <AboutSettingsSection {...about} /> : null}
    </SettingsFrame>
  );
}
