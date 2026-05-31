import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { skillScanMessage } from "./appShellUtils";
import { createRuntimeFileHost, isTauriRuntime } from "../services/fileHost";
import {
  scanUserSkills,
  USER_SKILL_ROOT_PATH,
  userSkillRootPath,
  type SkillRecord,
  type SkillScanError
} from "../services/skillRegistry";
import {
  createSkill,
  migrateDisabledSkillIdsAfterRename,
  openSkillFolder,
  removeDisabledSkillId,
  renameSkill,
  trashSkill,
  updateSkill,
  type SkillDraft
} from "../services/skillStore";

export function useSkillController({
  onSelectSkill,
  setPromptText,
  setSessionMessage,
  workspacePath
}: {
  onSelectSkill: () => void;
  setPromptText: (value: string) => void;
  setSessionMessage: (message: string | null) => void;
  workspacePath: string;
}) {
  const [skills, setSkills] = useState<SkillRecord[]>([]);
  const [skillErrors, setSkillErrors] = useState<SkillScanError[]>([]);
  const [skillMessage, setSkillMessage] = useState<string | null>(null);
  const [skillRootLabel, setSkillRootLabel] = useState(`~/${USER_SKILL_ROOT_PATH}`);
  const [disabledSkillIds, setDisabledSkillIds] = useState<string[]>([]);

  const enabledSkillCount = skills.filter((skill) => skill.enabled).length;

  useEffect(() => {
    void refreshSkills();
  }, [workspacePath, disabledSkillIds]);

  async function refreshSkills(disabledOverride?: string[]) {
    const effectiveDisabledSkillIds = Array.isArray(disabledOverride) ? disabledOverride : disabledSkillIds;
    try {
      const userHomePath = await resolveUserHomePath();
      setSkillRootLabel(userHomePath === "." ? `~/${USER_SKILL_ROOT_PATH}` : userSkillRootPath(userHomePath));
      const result = await scanUserSkills({
        disabledSkillIds: effectiveDisabledSkillIds,
        fileHost: createRuntimeFileHost(),
        userHomePath
      });
      setSkills(result.skills);
      setSkillErrors(result.errors);
      setSkillMessage(skillScanMessage(result.skills.length, result.errors.length));
    } catch (error) {
      setSkillErrors([]);
      setSkillMessage(error instanceof Error ? error.message : String(error));
    }
  }

  function toggleSkill(skillId: string, enabled: boolean) {
    setDisabledSkillIds((current) => {
      const disabled = new Set(current);
      if (enabled) {
        disabled.delete(skillId);
      } else {
        disabled.add(skillId);
      }
      return [...disabled].sort();
    });
    setSkills((current) =>
      current.map((skill) => skill.id === skillId ? { ...skill, enabled } : skill)
    );
  }

  function useSkill(skill: SkillRecord) {
    setPromptText(`/${skill.id} `);
    onSelectSkill();
    setSessionMessage(`已选择技能：${skill.name}`);
  }

  async function createUserSkill(draft: SkillDraft) {
    try {
      const result = await createSkill(draft);
      setSkillMessage(`已创建技能：${result.skillPath}`);
      await refreshSkills();
    } catch (error) {
      setSkillMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function renameUserSkill(skill: SkillRecord, nextId: string) {
    try {
      const result = await renameSkill({ fromId: skill.id, toId: nextId });
      const nextDisabledSkillIds = migrateDisabledSkillIdsAfterRename(disabledSkillIds, skill.id, nextId);
      setDisabledSkillIds(nextDisabledSkillIds);
      setSkillMessage(`已重命名技能：${result.skillPath}`);
      await refreshSkills(nextDisabledSkillIds);
    } catch (error) {
      setSkillMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function trashUserSkill(skill: SkillRecord) {
    try {
      await trashSkill(skill.id);
      const nextDisabledSkillIds = removeDisabledSkillId(disabledSkillIds, skill.id);
      setDisabledSkillIds(nextDisabledSkillIds);
      setSkillMessage(`已删除技能：${skill.name}`);
      await refreshSkills(nextDisabledSkillIds);
    } catch (error) {
      setSkillMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function updateUserSkill(skill: SkillRecord, content: string) {
    try {
      const result = await updateSkill({ id: skill.id, content });
      setSkillMessage(`已更新技能：${result.skillPath}`);
      await refreshSkills(disabledSkillIds);
    } catch (error) {
      setSkillMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function openUserSkillFolder(skill: SkillRecord) {
    try {
      await openSkillFolder(skill.rootPath);
      setSkillMessage(`已打开技能目录：${skill.rootPath}`);
    } catch (error) {
      setSkillMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function openUserSkillRoot() {
    try {
      const userHomePath = await resolveUserHomePath();
      const rootPath = userHomePath === "." ? skillRootLabel : userSkillRootPath(userHomePath);
      await openSkillFolder(rootPath);
      setSkillMessage(`已打开全局技能目录：${rootPath}`);
    } catch (error) {
      setSkillMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return {
    createUserSkill,
    disabledSkillIds,
    enabledSkillCount,
    openUserSkillFolder,
    openUserSkillRoot,
    refreshSkills,
    renameUserSkill,
    setDisabledSkillIds,
    setSkillMessage,
    skillErrors,
    skillMessage,
    skillRootLabel,
    skills,
    toggleSkill,
    trashUserSkill,
    updateUserSkill,
    useSkill
  };
}

async function resolveUserHomePath() {
  if (!isTauriRuntime()) {
    return ".";
  }

  return invoke<string>("user_home_dir");
}
