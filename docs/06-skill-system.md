# Ore Code Skill System

Ore Code 当前只支持用户级 Skill。Skill 是一份可复用的工作流说明，不是插件代码，也不会执行任意脚本。

Skill 放在用户目录：

```text
~/.ore-code/skills/<skill-id>/SKILL.md
```

最小示例：

```markdown
---
name: 代码审查助手
description: 按成熟 coding agent 的标准审查当前任务。
---

# 代码审查助手

先检查 bug、回归风险和缺失测试，再给出可维护性建议。
```

每个 Skill 会自动注册一个 slash command：

```text
/reviewer 请审查当前文件变更
```

Ore Code 会把 `SKILL.md` 内容注入到本轮 prompt，再交给当前 provider 和 agent loop 执行。所有真实文件读写、shell 和 git 操作仍然走现有工具与审批系统。

下一阶段可以做：

- Skill 推荐和自动匹配。
- Skill 与 Harness scenario 绑定。
- 一键创建和编辑 `SKILL.md`。
