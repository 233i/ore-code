import type { ReactNode } from "react";
import { Button, Input } from "tdesign-react";
import { ArrowLeftIcon, SearchIcon, SettingIcon } from "tdesign-icons-react";
import {
  filterSettingsSections,
  settingsNavGroups,
  settingsSectionLabel,
  settingsSectionMeta,
  visibleSettingsSections,
  type SettingsSection,
  type TDesignIcon
} from "./settingsConfig";
import { useI18n } from "../i18n/I18nProvider";

type SettingsFrameProps = {
  activeSection: SettingsSection;
  children: ReactNode;
  onActiveSectionChange: (section: SettingsSection) => void;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onSave: () => void;
  query: string;
};

export function SettingsFrame({
  activeSection,
  children,
  onActiveSectionChange,
  onClose,
  onQueryChange,
  onSave,
  query
}: SettingsFrameProps) {
  const { t } = useI18n();
  const filteredSections = filterSettingsSections(query, visibleSettingsSections, t);
  const activeMeta = settingsSectionMeta(activeSection, t);
  const ActiveIcon = visibleSettingsSections.find((section) => section.id === activeSection)?.icon ?? SettingIcon;

  return (
    <section className="settings-screen" aria-label={t("settings.aria.screen")}>
      <aside className="settings-nav">
        <Button className="settings-return" icon={<ArrowLeftIcon size="16px" />} type="button" variant="text" onClick={onClose}>{t("settings.action.back")}</Button>
        <Input
          clearable
          className="settings-nav-search"
          placeholder={t("settings.placeholder.search")}
          prefixIcon={<SearchIcon size="14px" />}
          size="small"
          type="search"
          value={query}
          onChange={(value) => onQueryChange(String(value))}
        />
        <nav aria-label={t("settings.aria.nav")}>
          {settingsNavGroups.map((group) => {
            const groupSections = filteredSections.filter((section) =>
              (group.ids as readonly SettingsSection[]).includes(section.id)
            );
            if (groupSections.length === 0) {
              return null;
            }

            return (
              <section className="settings-nav-group" key={group.label}>
                <span>{t(group.labelKey)}</span>
                {groupSections.map((section) => (
                  <Button
                    className={activeSection === section.id ? "active" : ""}
                    icon={renderIcon(section.icon, 16)}
                    key={section.id}
                    onClick={() => onActiveSectionChange(section.id)}
                    type="button"
                    variant="text"
                  >
                    <span className="settings-nav-label">{settingsSectionLabel(section, t)}</span>
                  </Button>
                ))}
              </section>
            );
          })}
          {filteredSections.length === 0 ? (
            <div className="settings-nav-empty">
              <strong>{t("settings.empty.noMatches")}</strong>
              <button type="button" onClick={() => onQueryChange("")}>{t("app.action.clearSearch")}</button>
            </div>
          ) : null}
        </nav>
      </aside>

      <div className="settings-content">
        <header className="settings-hero">
          <div className="settings-hero-title">
            <span>{renderIcon(ActiveIcon, 18)}{activeMeta.kicker}</span>
            <h1>{activeMeta.title}</h1>
            <p>{activeMeta.description}</p>
          </div>
          <div className="settings-hero-actions">
            <Button className="settings-save-button" type="button" onClick={onSave}>{t("settings.action.save")}</Button>
          </div>
        </header>

        {children}
      </div>
    </section>
  );
}

function renderIcon(Icon: TDesignIcon, size = 16) {
  return <Icon size={`${size}px`} />;
}
