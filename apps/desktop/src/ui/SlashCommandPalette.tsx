import type { SlashCommand } from "./slashCommands";

type SlashCommandPaletteProps = {
  activeIndex: number;
  commands: SlashCommand[];
  onMouseEnter: (index: number) => void;
  onSelect: (command: SlashCommand) => void;
};

export function SlashCommandPalette({ activeIndex, commands, onMouseEnter, onSelect }: SlashCommandPaletteProps) {
  return (
    <div className="slash-command-palette" aria-label="Slash commands">
      <header>
        <span>命令</span>
        <small>{commands.length} 个匹配</small>
      </header>
      {commands.length > 0 ? (
        commands.map((command, index) => (
          <button
            aria-current={index === activeIndex ? "true" : undefined}
            className={index === activeIndex ? "active" : ""}
            key={command.name}
            type="button"
            onMouseEnter={() => onMouseEnter(index)}
            onClick={() => onSelect(command)}
          >
            <span className="slash-command-name">{command.name}</span>
            <strong>{command.description}</strong>
            <small>{slashCommandCategoryLabel(command.category)}</small>
            {command.usage ? <code>{command.usage}</code> : null}
          </button>
        ))
      ) : (
        <div className="slash-command-empty">
          <strong>没有匹配的命令</strong>
          <span>Enter 会按普通消息发送，Esc 清空输入。</span>
        </div>
      )}
      <footer>
        <span>↑↓ 选择</span>
        <span>Tab 补全</span>
        <span>Enter 执行</span>
      </footer>
    </div>
  );
}

function slashCommandCategoryLabel(category: SlashCommand["category"]) {
  switch (category) {
    case "workspace":
      return "工作区";
    case "session":
      return "对话";
    case "tools":
      return "工具";
    case "settings":
      return "设置";
    case "mode":
      return "模式";
  }
}
