import { stableHash, stableStringify } from "./stable-json";

export type RequestSegmentName =
  | "core_prefix"
  | "tool_prefix"
  | "project_snapshot"
  | "conversation_ledger"
  | "dynamic_tail";

export interface RequestSegment {
  name: RequestSegmentName;
  label: string;
  hash: string;
  chars: number;
  includedInPrefix: boolean;
  cacheStable: boolean;
}

export function requestSegment(
  name: RequestSegmentName,
  label: string,
  value: unknown,
  includedInPrefix: boolean,
  cacheStable: boolean
): RequestSegment {
  const serialized = stableStringify(value);
  return {
    name,
    label,
    hash: stableHash(value),
    chars: serialized.length,
    includedInPrefix,
    cacheStable
  };
}
