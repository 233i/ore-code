import { useMemo, useState } from "react";
import { Button, Dialog, Input, Select, Tag, Textarea } from "tdesign-react";
import { AddIcon, CloseIcon, PlayCircleIcon, RefreshIcon } from "tdesign-icons-react";
import type { AutomationRecord, DurableTaskSnapshot } from "@ore-code/agent-core";

type AutomationWorkspaceProps = {
  automations: AutomationRecord[];
  busy: boolean;
  message: string | null;
  onClose: () => void;
  onCreateAutomation: (input: { name: string; prompt: string; rrule: string; paused?: boolean }) => Promise<void>;
  onDeleteAutomation: (id: string) => Promise<void>;
  onRefresh: () => Promise<void>;
  onRunAutomation: (id: string) => Promise<void>;
  onRunDue: () => Promise<void>;
  onToggleAutomation: (id: string, status: AutomationRecord["status"]) => Promise<void>;
  tasks: DurableTaskSnapshot[];
  visible: boolean;
};

const scheduleOptions = [
  { label: "每小时", value: "FREQ=HOURLY;INTERVAL=1" },
  { label: "每 6 小时", value: "FREQ=HOURLY;INTERVAL=6" },
  { label: "工作日 09:00", value: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0" },
  { label: "每周一 09:30", value: "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=30" },
  { label: "自定义时间", value: "custom" }
] as const;

type WeekdayToken = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

const weekdayOptions: { label: string; value: WeekdayToken }[] = [
  { label: "一", value: "MO" },
  { label: "二", value: "TU" },
  { label: "三", value: "WE" },
  { label: "四", value: "TH" },
  { label: "五", value: "FR" },
  { label: "六", value: "SA" },
  { label: "日", value: "SU" }
];

const defaultScheduleValue = scheduleOptions[0].value;
const defaultCustomDays: WeekdayToken[] = ["MO", "TU", "WE", "TH", "FR"];

export function AutomationWorkspace({
  automations,
  busy,
  message,
  onClose,
  onCreateAutomation,
  onDeleteAutomation,
  onRefresh,
  onRunAutomation,
  onRunDue,
  onToggleAutomation,
  tasks,
  visible
}: AutomationWorkspaceProps) {
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [scheduleValue, setScheduleValue] = useState<string>(defaultScheduleValue);
  const [customDays, setCustomDays] = useState<WeekdayToken[]>(defaultCustomDays);
  const [customTime, setCustomTime] = useState("09:00");
  const [startPaused, setStartPaused] = useState(false);
  const activeCount = automations.filter((automation) => automation.status === "active").length;
  const sortedAutomations = useMemo(
    () => [...automations].sort((a, b) => sortBySchedule(a, b)),
    [automations]
  );
  const recentTasks = useMemo(
    () => [...tasks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 6),
    [tasks]
  );

  if (!visible) {
    return null;
  }

  const submitCreate = async () => {
    if (!name.trim() || !prompt.trim()) {
      return;
    }
    await onCreateAutomation({
      name: name.trim(),
      prompt: prompt.trim(),
      rrule: scheduleValue === "custom" ? buildCustomRrule(customDays, customTime) : scheduleValue,
      paused: startPaused
    });
    setShowCreateDialog(false);
    setName("");
    setPrompt("");
    setScheduleValue(defaultScheduleValue);
    setCustomDays(defaultCustomDays);
    setCustomTime("09:00");
    setStartPaused(false);
  };

  return (
    <section className="automation-workspace" aria-label="自动化">
      <header className="automation-header">
        <div>
          <h1>自动化</h1>
          <p>{message ?? `${activeCount} 个运行中，${automations.length} 个计划任务。应用打开时自动执行。`}</p>
        </div>
        <div className="automation-actions">
          <Button disabled={busy} icon={<RefreshIcon size="16px" />} shape="square" type="button" variant="outline" onClick={() => void onRefresh()} />
          <Button className="automation-create-button" icon={<AddIcon size="16px" />} theme="primary" type="button" onClick={() => setShowCreateDialog(true)}>
            新建
          </Button>
          <Button aria-label="关闭自动化" icon={<CloseIcon size="18px" />} shape="square" type="button" variant="text" onClick={onClose} />
        </div>
      </header>

      <main className="automation-simple-layout">
        <section className="automation-simple-panel">
          <header>
            <div>
              <h2>计划任务</h2>
              <p>按固定时间把任务加入后台队列。</p>
            </div>
            {automations.length > 0 ? <span>{activeCount}/{automations.length} 开启</span> : null}
          </header>

          <div className="automation-simple-list">
            {sortedAutomations.map((automation) => (
              <article className="automation-simple-card" key={automation.id}>
                <div className="automation-card-main">
                  <span className={`automation-status-dot ${automation.status}`} />
                  <div>
                    <strong>{automation.name}</strong>
                    <p>{automation.prompt}</p>
                  </div>
                  <button
                    className={automation.status === "active" ? "automation-toggle active" : "automation-toggle"}
                    disabled={busy}
                    type="button"
                    onClick={() => void onToggleAutomation(automation.id, automation.status)}
                  >
                    {automation.status === "active" ? "开启" : "暂停"}
                  </button>
                </div>

                <div className="automation-meta-row">
                  <span><small>频率</small>{formatRrule(automation.rrule)}</span>
                  <span><small>下次</small>{automation.nextRunAt ? formatDateTime(automation.nextRunAt) : "未计划"}</span>
                  <span><small>最近</small>{automation.lastRunAt ? formatDateTime(automation.lastRunAt) : "尚未运行"}</span>
                </div>

                <footer>
                  <Button disabled={busy} icon={<PlayCircleIcon size="15px" />} size="small" type="button" variant="outline" onClick={() => void onRunAutomation(automation.id)}>
                    立即运行
                  </Button>
                  <Button disabled={busy} size="small" theme="danger" type="button" variant="text" onClick={() => void onDeleteAutomation(automation.id)}>
                    删除
                  </Button>
                </footer>
              </article>
            ))}

            {automations.length === 0 ? (
              <div className="automation-empty">
                <strong>还没有计划任务</strong>
                <p>创建后，Ore Code 会在应用运行时按计划执行。</p>
                <Button className="automation-create-button" icon={<AddIcon size="16px" />} theme="primary" type="button" onClick={() => setShowCreateDialog(true)}>
                  新建自动化
                </Button>
              </div>
            ) : null}
          </div>
        </section>

        <details className="automation-tasks-disclosure">
          <summary>
            <span>最近后台任务</span>
            <small>{tasks.length} 个</small>
          </summary>
          <div>
            <Button disabled={busy} size="small" type="button" variant="outline" onClick={() => void onRunDue()}>
              运行到期项
            </Button>
            {recentTasks.length > 0 ? recentTasks.map((task) => (
              <article className="automation-task-row" key={task.id}>
                <div>
                  <strong>{task.title}</strong>
                  <p>{task.output || task.error || task.prompt}</p>
                </div>
                <Tag theme={taskStatusTheme(task.status)} variant="light">{taskStatusText(task.status)}</Tag>
              </article>
            )) : (
              <p className="automation-task-empty">暂无后台任务。</p>
            )}
          </div>
        </details>
      </main>

      <Dialog
        cancelBtn="取消"
        className="automation-create-dialog"
        confirmBtn="创建"
        header="新建自动化"
        visible={showCreateDialog}
        width={560}
        onClose={() => setShowCreateDialog(false)}
        onConfirm={() => void submitCreate()}
      >
        <div className="automation-create-form">
          <label className="automation-create-field">
            <span>名称</span>
            <Input placeholder="每日检查项目状态" value={name} onChange={(value) => setName(String(value))} />
          </label>
          <label className="automation-create-field">
            <span>任务内容</span>
            <Textarea
              autosize={{ minRows: 4, maxRows: 8 }}
              placeholder="每次运行时要让 Ore Code 做什么"
              value={prompt}
              onChange={(value) => setPrompt(String(value))}
            />
          </label>
          <label className="automation-create-field">
            <span>频率</span>
            <Select
              options={[...scheduleOptions]}
              value={scheduleValue}
              onChange={(value) => setScheduleValue(String(value))}
            />
          </label>
          {scheduleValue === "custom" ? (
            <div className="automation-custom-schedule">
              <label>
                <span>运行日期</span>
                <div className="automation-day-picker">
                  {weekdayOptions.map((day) => (
                    <button
                      className={customDays.includes(day.value) ? "active" : ""}
                      key={day.value}
                      type="button"
                      onClick={() => setCustomDays((current) => toggleWeekday(current, day.value))}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </label>
              <label>
                <span>运行时间</span>
                <input type="time" value={customTime} onChange={(event) => setCustomTime(event.currentTarget.value)} />
              </label>
            </div>
          ) : null}
          <button className={startPaused ? "automation-pause-option active" : "automation-pause-option"} type="button" onClick={() => setStartPaused((current) => !current)}>
            <span>{startPaused ? "创建后先暂停" : "创建后立即开启"}</span>
            <small>{startPaused ? "适合先检查内容" : "到达计划时间会自动加入队列"}</small>
          </button>
        </div>
      </Dialog>
    </section>
  );
}

function toggleWeekday(current: WeekdayToken[], value: WeekdayToken) {
  if (current.includes(value)) {
    return current.length > 1 ? current.filter((item) => item !== value) : current;
  }
  return weekdayOptions
    .map((day) => day.value)
    .filter((day) => day === value || current.includes(day));
}

function buildCustomRrule(days: WeekdayToken[], time: string) {
  const [hourText = "9", minuteText = "0"] = time.split(":");
  const hour = clampTimePart(Number(hourText), 0, 23);
  const minute = clampTimePart(Number(minuteText), 0, 59);
  return `FREQ=WEEKLY;BYDAY=${days.join(",")};BYHOUR=${hour};BYMINUTE=${minute}`;
}

function clampTimePart(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.trunc(value), min), max);
}

function sortBySchedule(a: AutomationRecord, b: AutomationRecord) {
  if (a.status !== b.status) {
    return a.status === "active" ? -1 : 1;
  }
  const aNext = a.nextRunAt ?? "";
  const bNext = b.nextRunAt ?? "";
  if (aNext && bNext) {
    return aNext.localeCompare(bNext);
  }
  return b.updatedAt.localeCompare(a.updatedAt);
}

function taskStatusText(status: DurableTaskSnapshot["status"]) {
  switch (status) {
    case "queued":
      return "排队";
    case "running":
      return "运行中";
    case "completed":
      return "完成";
    case "failed":
      return "失败";
    case "canceled":
      return "取消";
  }
}

function taskStatusTheme(status: DurableTaskSnapshot["status"]) {
  switch (status) {
    case "completed":
      return "success";
    case "failed":
    case "canceled":
      return "danger";
    case "running":
      return "warning";
    default:
      return "default";
  }
}

function formatDateTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function formatRrule(rrule: string) {
  if (rrule === "FREQ=HOURLY;INTERVAL=1") {
    return "每小时";
  }
  if (rrule === "FREQ=HOURLY;INTERVAL=6") {
    return "每 6 小时";
  }
  if (rrule === "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0") {
    return "工作日 09:00";
  }
  if (rrule === "FREQ=WEEKLY;BYDAY=MO;BYHOUR=9;BYMINUTE=30") {
    return "每周一 09:30";
  }
  const parts = parseRruleParts(rrule);
  if (parts.get("FREQ") === "WEEKLY" && parts.has("BYDAY") && parts.has("BYHOUR") && parts.has("BYMINUTE")) {
    return `${formatByday(parts.get("BYDAY") ?? "")} ${padTime(parts.get("BYHOUR") ?? "0")}:${padTime(parts.get("BYMINUTE") ?? "0")}`;
  }
  return rrule.replace(/;/g, " · ");
}

function parseRruleParts(rrule: string) {
  const parts = new Map<string, string>();
  for (const segment of rrule.split(";")) {
    const [key, value] = segment.split("=");
    if (key && value) {
      parts.set(key.toUpperCase(), value.toUpperCase());
    }
  }
  return parts;
}

function formatByday(value: string) {
  const days = value.split(",").filter(Boolean);
  if (days.join(",") === "MO,TU,WE,TH,FR,SA,SU") {
    return "每天";
  }
  if (days.join(",") === "MO,TU,WE,TH,FR") {
    return "工作日";
  }
  return days
    .map((day) => weekdayOptions.find((option) => option.value === day)?.label ?? day)
    .join("、");
}

function padTime(value: string) {
  return value.padStart(2, "0");
}
