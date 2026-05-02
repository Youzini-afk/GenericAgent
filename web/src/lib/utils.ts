import type { CliRun, Status, CliRunStatus } from "./types";
import type { T, I18nKey } from "./i18n";
import { I18N } from "./i18n";

export function fmtTime(value?: number | null) {
  if (!value) return "-";
  return new Date(value * 1000).toLocaleString();
}

export function shortId(id?: string) {
  return id ? id.slice(0, 8) : "-";
}

export function asText(value: unknown) {
  if (value == null) return "";
  if (typeof value === "string") return value;
  return JSON.stringify(value, null, 2);
}

export function changedCount(result: Record<string, unknown>) {
  const files = result?.changed_files;
  return Array.isArray(files) ? files.length : 0;
}

export function blockersCount(result: Record<string, unknown>) {
  const blockers = result?.blockers;
  return Array.isArray(blockers) ? blockers.length : 0;
}

export function orchestrationMeta(run?: CliRun) {
  const policy = (run?.policy || {}) as Record<string, unknown>;
  const meta = (policy._orchestration || {}) as Record<string, unknown>;
  return {
    mode: typeof meta.mode === "string" ? meta.mode : "",
    providerReason: typeof meta.provider_reason === "string" ? meta.provider_reason : "",
    acceptance: typeof meta.acceptance === "string" ? meta.acceptance : "",
    suggestedTests: typeof meta.suggested_tests === "string" ? meta.suggested_tests : ""
  };
}

export function statusLabel(t: T, status: string) {
  const key = `status.${status}` as I18nKey;
  return key in I18N.zh ? t(key) : status;
}

export function toolStatusLabel(t: T, status: string) {
  const key = `toolStatus.${status}` as I18nKey;
  return key in I18N.zh ? t(key) : status;
}

export function policyLabel(t: T, key: string) {
  const labelKey = `policy.${key}` as I18nKey;
  return labelKey in I18N.zh ? t(labelKey) : key;
}

export const statusClass: Record<Status, string> = {
  pending: "badge neutral",
  leased: "badge warn",
  running: "badge live",
  succeeded: "badge ok",
  failed: "badge bad",
  canceled: "badge muted",
  interrupted: "badge warn"
};

export const cliStatusClass: Record<CliRunStatus, string> = {
  pending: "badge neutral",
  preparing: "badge warn",
  running: "badge live",
  succeeded: "badge ok",
  failed: "badge bad",
  canceled: "badge muted",
  interrupted: "badge warn"
};
