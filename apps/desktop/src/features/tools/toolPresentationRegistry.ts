import type { ToolPresentation } from "./toolPresentationTypes";
import { getArtifactSliceSummary, getFileToolSummary, getReadFileSummary } from "./summaries/fileSummary";
import {
  getCodeExecutionSummary,
  getLspSummary,
  getRunTestsSummary,
  getStructuredReviewSummary,
  getToolSearchSummary,
  getValidateDataSummary
} from "./summaries/qualitySummary";
import { getRlmSummary, getSubagentSummary } from "./summaries/subagentSummary";
import { getShellSummary } from "./summaries/shellSummary";
import {
  getChecklistSummary,
  getPrAttemptSummary,
  getTaskArtifactSummary,
  getTaskGateSummary,
  getTaskSummary
} from "./summaries/taskSummary";

export const toolPresentationRegistry: Record<string, ToolPresentation> = {
  exec_shell: {
    label: "执行命令",
    payloadPolicy: "compact",
    runningText: "执行命令",
    summary: getShellSummary
  },
  run_tests: {
    label: "运行测试",
    payloadPolicy: "compact",
    runningText: "运行测试",
    summary: getRunTestsSummary
  },
  task_create: {
    label: "创建任务",
    payloadPolicy: "compact",
    runningText: "创建任务",
    summary: getTaskSummary
  },
  task_list: {
    label: "读取任务",
    payloadPolicy: "compact",
    runningText: "读取任务",
    summary: getTaskSummary
  },
  task_read: {
    label: "读取任务",
    payloadPolicy: "compact",
    runningText: "读取任务",
    summary: getTaskSummary
  },
  task_update: {
    label: "更新任务",
    payloadPolicy: "compact",
    runningText: "更新任务",
    summary: getTaskSummary
  },
  task_cancel: {
    label: "取消任务",
    payloadPolicy: "compact",
    runningText: "取消任务",
    summary: getTaskSummary
  },
  checklist_write: {
    label: "更新清单",
    payloadPolicy: "compact",
    runningText: "更新清单",
    summary: getChecklistSummary
  },
  checklist_add: {
    label: "添加清单项",
    payloadPolicy: "compact",
    runningText: "添加清单项",
    summary: getChecklistSummary
  },
  checklist_update: {
    label: "更新清单项",
    payloadPolicy: "compact",
    runningText: "更新清单项",
    summary: getChecklistSummary
  },
  checklist_list: {
    label: "读取清单",
    payloadPolicy: "compact",
    runningText: "读取清单",
    summary: getChecklistSummary
  },
  task_gate_run: {
    label: "执行验证",
    payloadPolicy: "compact",
    runningText: "执行验证",
    summary: getTaskGateSummary
  },
  task_gate_record: {
    label: "记录验证",
    payloadPolicy: "compact",
    runningText: "记录验证",
    summary: getTaskGateSummary
  },
  task_artifact_record: {
    label: "记录产物",
    payloadPolicy: "compact",
    runningText: "记录产物",
    summary: getTaskArtifactSummary
  },
  pr_attempt_record: {
    label: "记录 PR 尝试",
    payloadPolicy: "compact",
    runningText: "记录 PR 尝试",
    summary: getPrAttemptSummary
  },
  pr_attempt_list: {
    label: "读取 PR 尝试",
    payloadPolicy: "compact",
    runningText: "读取 PR 尝试",
    summary: getPrAttemptSummary
  },
  pr_attempt_read: {
    label: "读取 PR 尝试",
    payloadPolicy: "compact",
    runningText: "读取 PR 尝试",
    summary: getPrAttemptSummary
  },
  pr_attempt_preflight: {
    label: "检查 PR 尝试",
    payloadPolicy: "compact",
    runningText: "检查 PR 尝试",
    summary: getPrAttemptSummary
  },
  start_shell_job: {
    label: "启动后台命令",
    payloadPolicy: "compact",
    runningText: "启动后台命令",
    summary: getShellSummary
  },
  write_file: {
    label: "写入文件",
    payloadPolicy: "compact",
    runningText: "写入文件",
    summary: getFileToolSummary
  },
  install_skill: {
    label: "安装技能",
    payloadPolicy: "compact",
    runningText: "安装技能"
  },
  edit_file: {
    label: "编辑文件",
    payloadPolicy: "compact",
    runningText: "编辑文件",
    summary: getFileToolSummary
  },
  apply_patch: {
    label: "应用补丁",
    payloadPolicy: "compact",
    runningText: "应用补丁"
  },
  read_file: {
    label: "读取文件",
    payloadPolicy: "compact",
    runningText: "读取文件",
    summary: getReadFileSummary
  },
  list_dir: {
    label: "列出目录",
    payloadPolicy: "compact",
    runningText: "列出目录",
    summary: getFileToolSummary
  },
  git_status: {
    label: "读取 Git 状态",
    runningText: "读取 Git 状态"
  },
  git_diff: {
    label: "读取 Git diff",
    runningText: "读取 Git diff"
  },
  retrieve_tool_result: {
    label: "读取产物片段",
    payloadPolicy: "compact",
    runningText: "读取产物片段",
    summary: getArtifactSliceSummary
  },
  structured_review: {
    label: "结构化评审",
    payloadPolicy: "compact",
    runningText: "结构化评审",
    summary: getStructuredReviewSummary
  },
  validate_data: {
    label: "校验数据",
    payloadPolicy: "compact",
    runningText: "校验数据",
    summary: getValidateDataSummary
  },
  code_execution: {
    label: "执行代码",
    payloadPolicy: "compact",
    runningText: "执行代码",
    summary: getCodeExecutionSummary
  },
  tool_search: {
    label: "搜索工具",
    payloadPolicy: "compact",
    runningText: "搜索工具",
    summary: getToolSearchSummary
  },
  lsp_hover: {
    label: "查看符号",
    payloadPolicy: "compact",
    runningText: "查看符号",
    summary: getLspSummary
  },
  lsp_definition: {
    label: "查找定义",
    payloadPolicy: "compact",
    runningText: "查找定义",
    summary: getLspSummary
  },
  lsp_references: {
    label: "查找引用",
    payloadPolicy: "compact",
    runningText: "查找引用",
    summary: getLspSummary
  },
  lsp_document_symbols: {
    label: "文档符号",
    payloadPolicy: "compact",
    runningText: "读取文档符号",
    summary: getLspSummary
  },
  rlm_query: {
    label: "运行子任务",
    payloadPolicy: "compact",
    runningText: "运行子任务",
    summary: getRlmSummary
  },
  agent_spawn: {
    label: "启动子智能体",
    payloadPolicy: "compact",
    runningText: "启动子智能体",
    summary: getSubagentSummary
  },
  agent_wait: {
    label: "等待子智能体",
    payloadPolicy: "compact",
    runningText: "等待子智能体",
    summary: getSubagentSummary
  },
  agent_send_input: {
    label: "继续子智能体",
    payloadPolicy: "compact",
    runningText: "继续子智能体",
    summary: getSubagentSummary
  },
  agent_cancel: {
    label: "取消子智能体",
    payloadPolicy: "compact",
    runningText: "取消子智能体",
    summary: getSubagentSummary
  },
  agent_resume: {
    label: "恢复子智能体",
    payloadPolicy: "compact",
    runningText: "恢复子智能体",
    summary: getSubagentSummary
  },
  agent_list: {
    label: "读取子智能体",
    payloadPolicy: "compact",
    runningText: "读取子智能体",
    summary: getSubagentSummary
  }
};

export function toolPresentationFor(name: string): ToolPresentation | undefined {
  return toolPresentationRegistry[name];
}
