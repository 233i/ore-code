import { Switch, Tag } from "tdesign-react";
import type { SkillRecord, SkillScanError } from "../services/skillRegistry";

type SkillListProps = {
  errors: SkillScanError[];
  onSelectSkill: (skill: SkillRecord) => void;
  onToggleSkill: (skillId: string, enabled: boolean) => void;
  skills: SkillRecord[];
};

export function SkillList({ errors, onSelectSkill, onToggleSkill, skills }: SkillListProps) {
  return (
    <>
      <div className="skill-list">
        {skills.length === 0 ? (
          <div className="skill-empty">
            <strong>未发现技能</strong>
            <p>在用户目录创建 <code>~/.ore-code/skills/*/SKILL.md</code> 后刷新。</p>
          </div>
        ) : null}
        {skills.map((skill) => (
          <article className="skill-card" key={skill.id}>
            <header>
              <div>
                <strong>{skill.name}</strong>
                <small>{skill.id} · {skill.skillPath}</small>
              </div>
              <Switch
                size="small"
                value={skill.enabled}
                onChange={(value) => onToggleSkill(skill.id, Boolean(value))}
              />
            </header>
            {skill.description ? <p>{skill.description}</p> : null}
            <div className="skill-meta">
              <Tag size="small" theme={skill.enabled ? "success" : "default"} variant="light">
                {skill.enabled ? "已启用" : "已禁用"}
              </Tag>
              <Tag size="small" theme="primary" variant="light">
                /{skill.id}
              </Tag>
              <Tag size="small" theme="default" variant="light">SKILL.md</Tag>
            </div>
            <div className="skill-commands">
              <button
                disabled={!skill.enabled}
                type="button"
                onClick={() => onSelectSkill(skill)}
              >
                <code>/{skill.id}</code>
                <span>使用这个技能处理下一条任务</span>
              </button>
            </div>
          </article>
        ))}
      </div>
      {errors.length > 0 ? (
        <div className="skill-errors">
          {errors.map((error) => (
            <p key={error.path}><strong>{error.path}</strong>: {error.message}</p>
          ))}
        </div>
      ) : null}
    </>
  );
}
