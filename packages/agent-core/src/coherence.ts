import type { RuntimeEvent } from "@seekforge/protocol";
import type { buildCapacityReport } from "./capacity";

export type CoherenceState = Extract<RuntimeEvent, { type: "coherence_state" }>["state"];
export type CoherenceRecommendedAction = Extract<RuntimeEvent, { type: "coherence_state" }>["recommendedAction"];
export type CoherenceRiskBand = NonNullable<Extract<RuntimeEvent, { type: "coherence_state" }>["riskBand"]>;

export interface CoherenceReport {
  state: CoherenceState;
  riskBand: CoherenceRiskBand;
  recommendedAction: CoherenceRecommendedAction;
  message: string;
}

type CapacityReportLike = ReturnType<typeof buildCapacityReport>;

export function coherenceFromCapacity(capacity: CapacityReportLike): CoherenceReport {
  const riskBand = riskBandFromCapacity(capacity);
  if (capacity.status === "critical" || capacity.seamLevel === "hard") {
    return {
      state: "resetting_plan",
      riskBand,
      recommendedAction: "verify_and_replan",
      message: "上下文已进入阻断区，应先压缩、核验关键结果并重建计划。"
    };
  }

  if (capacity.shouldGenerateBriefing || capacity.seamLevel === "cycle") {
    return {
      state: "refreshing_context",
      riskBand,
      recommendedAction: "targeted_context_refresh",
      message: "长会话接近 cycle seam，建议生成 handoff briefing 后继续。"
    };
  }

  if (capacity.shouldCompressHistory || capacity.seamLevel === "l3") {
    return {
      state: "verifying_recent_work",
      riskBand,
      recommendedAction: "verify_with_tool_replay",
      message: "上下文压力较高，继续前应抽样核验最近工具结果。"
    };
  }

  if (capacity.status === "warning" || capacity.seamLevel === "l1" || capacity.seamLevel === "l2") {
    return {
      state: "getting_crowded",
      riskBand,
      recommendedAction: capacity.shouldCompressToolOutputs ? "targeted_context_refresh" : "none",
      message: "会话正在接近输入预算，保持大输出 artifact 化并避免重写稳定 prefix。"
    };
  }

  return {
    state: "healthy",
    riskBand,
    recommendedAction: "none",
    message: "会话上下文稳定。"
  };
}

function riskBandFromCapacity(capacity: CapacityReportLike): CoherenceRiskBand {
  if (capacity.status === "critical" || capacity.seamLevel === "hard" || capacity.seamLevel === "cycle") {
    return "high";
  }
  if (capacity.status === "warning" || capacity.seamLevel === "l2" || capacity.seamLevel === "l3") {
    return "medium";
  }
  return "low";
}
