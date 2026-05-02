export type PageKey = "chat" | "agentRuns" | "queue" | "settings";
export type SettingsKey = "config" | "workers" | "cliTools" | "schedules" | "memory" | "files" | "browser" | "logs";
export type Status = "pending" | "leased" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";
export type CliRunStatus = "pending" | "preparing" | "running" | "succeeded" | "failed" | "canceled" | "interrupted";
export type Lang = "zh" | "en";

export type Session = { id: string; title: string; updated_at: number; created_at: number };
export type Message = { id: string; session_id: string; role: string; content: string; task_id?: string; created_at: number };
export type Task = {
  id: string; kind: string; session_id: string; status: Status;
  payload: Record<string, unknown>; created_at: number; updated_at: number;
  started_at?: number; finished_at?: number; leased_by?: string;
  error?: string; cancel_requested?: boolean;
};
export type WorkerInfo = { id: string; ready: boolean; current_task_id?: string; last_error?: string; alive: boolean };
export type StatusInfo = { data_dir: string; configured: boolean; worker_concurrency: number; cli_runner_concurrency?: number; active_cli_runs?: number };
export type TaskEvent = { seq: number; type: string; payload: Record<string, unknown>; created_at: number };
export type LlmConfig = { configs: Array<{ var: string; kind: string; data: Record<string, unknown> }>; extras: Record<string, unknown>; path: string };
export type Schedule = { id: string; title: string; prompt: string; cron: string; enabled: boolean; next_run_at?: number | null; last_task_id?: string | null };
export type FileItem = { name: string; path: string; is_dir: boolean; size: number; updated_at: number };
export type BrowserTab = { id: string; url: string; title: string; type: string };
export type CliTool = {
  id: string; name: string; provider: string; install_kind: string; package: string;
  command: string; status: string; requested_version: string; resolved_version: string;
  install_path: string; command_path: string; error: string;
};
export type CliEnvProfile = { id: string; name: string; tool_id: string; env: Record<string, string>; created_at: number; updated_at: number };
export type CliProviderProfile = { provider: string; strengths: string[]; weaknesses: string[]; recent_success: number; recent_failure: number; notes: string[] };
export type CliRun = {
  id: string; parent_task_id?: string; parent_session_id?: string;
  provider: string; target_workspace: string; effective_workspace: string;
  workspace_mode: string; prompt: string; status: CliRunStatus;
  policy: Record<string, unknown>; env_profile_id?: string;
  result: Record<string, unknown>; created_at: number; updated_at: number;
  error?: string; cancel_requested?: boolean;
};
export type CliRunEvent = { seq: number; type: string; payload: Record<string, unknown>; created_at: number };
