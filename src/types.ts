/**
 * Shared types for the Ralph Wiggum loop system.
 */

export const AGENT_TYPES = ["opencode", "claude-code", "codex", "copilot", "cursor-agent"] as const;
export type AgentType = (typeof AGENT_TYPES)[number];

export type AgentEnvOptions = { filterPlugins?: boolean; allowAllPermissions?: boolean };

export interface AgentConfig {
   type: AgentType;
   command: string;
   buildArgs: (prompt: string, model: string, options?: import("../agent-builders").AgentBuildArgsOptions) => string[];
   buildEnv: (options: AgentEnvOptions) => Record<string, string>;
   parseToolOutput: (line: string) => string | null;
   configName: string;
}

export interface JsonAgentConfig {
   type: string;
   command: string;
   configName: string;
   argsTemplate?: string;
   envTemplate?: string;
   parsePattern?: string;
   args?: string[];
   toolPattern?: string;
   allowAllFlags?: string[];
   envBlock?: Record<string, string>;
}

export interface RalphConfig {
   version: string;
   agents: JsonAgentConfig[];
}

export interface RalphRuntimeConfig {
   prompt?: string;
   agent?: AgentType;
   agent_binary?: string;
   min_iterations?: number;
   max_iterations?: number;
   completion_promise?: string;
   abort_promise?: string;
   tasks?: boolean;
   task_promise?: string;
   model?: string;
   rotation?: string[];
   stalling_timeout?: string;
   blacklist_duration?: string;
   stalling_action?: "stop" | "rotate";
   heartbeat_interval?: string;
   no_commit?: boolean;
   no_plugins?: boolean;
   allow_all?: boolean;
   prompt_file?: string;
   prompt_template?: string;
   stream?: boolean;
   verbose_tools?: boolean;
   questions?: boolean;
   agent_config?: string;
   extra_agent_flags?: string[];
   stall_retries?: boolean;
   stall_retry_minutes?: number;
   json_display?: "beautify" | "raw" | "text";
   output_buffer_bytes?: number;
   // Goal mode (opt-in)
   goal?: string;
   goal_dir?: string;
   goal_promise?: string;
}

// ── Review Gate Types ────────────────────────────────────────────────────────

export interface ReviewVoter {
   agent: string;
   model: string;
   promptFlag?: string; // CLI flag for prompt (default: "-p"). Codex uses "-q", etc.
}

export interface ReviewConfig {
   enabled: boolean;
   quorum: string;          // "X/Y" format
   voterTimeout: string;    // Duration string ("10m")
   maxRejectCycles: number; // Max consecutive rejections before force-stop
   batchSize: number;       // Voters dispatched in parallel batches (default: 3)
   reviewPromptFile: string; // Optional: path to custom review prompt file
   voters: ReviewVoter[];
}

export type ReviewVoteStatus = "pending" | "approved" | "rejected" | "timeout";

export interface ReviewVote {
   status: ReviewVoteStatus;
   at: string;   // ISO timestamp
   reason: string;
}

export type ReviewGatePhase =
   | "disabled"
   | "inner_complete"
   | "waiting_review"
   | "approved"
   | "rejected"
   | "interrupted";

export interface ReviewGateState {
   enabled: boolean;
   quorum: string;
   quorumRequired: number;
   quorumTotal: number;
   batchSize: number;
   phase: ReviewGatePhase;
   rejectCycleCount: number;
   lastRejectionReasons: string[];
   votes: Record<string, ReviewVote>;
}
