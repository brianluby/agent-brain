/**
 * Memvid Mind - Type Definitions
 *
 * Core types for multi-platform agent memory persistence.
 */

/** Observation captured from tool use */
export interface Observation {
  id: string;
  timestamp: number;
  type: ObservationType;
  tool?: string;
  summary: string;
  content: string;
  metadata?: ObservationMetadata;
}

/** Types of observations */
export type ObservationType =
  | "discovery"      // New information discovered
  | "decision"       // Decision made
  | "problem"        // Problem identified
  | "solution"       // Solution implemented
  | "pattern"        // Pattern recognized
  | "warning"        // Warning or concern
  | "success"        // Successful outcome
  | "refactor"       // Code refactored
  | "bugfix"         // Bug fixed
  | "feature";       // Feature added

/** Metadata attached to observations */
export interface ObservationMetadata {
  files?: string[];
  functions?: string[];
  error?: string;
  confidence?: number;
  tags?: string[];
  sessionId?: string;
  [key: string]: unknown;  // Allow additional properties
}

/** Session summary stored at end of session */
export interface SessionSummary {
  id: string;
  startTime: number;
  endTime: number;
  observationCount: number;
  keyDecisions: string[];
  filesModified: string[];
  summary: string;
}

/** Context injected at session start */
export interface InjectedContext {
  recentObservations: Observation[];
  relevantMemories: Observation[];
  sessionSummaries: SessionSummary[];
  tokenCount: number;
}

/** Configuration for Memvid Mind */
export interface MindConfig {
  /** Path to the memory file (default: .agent-brain/mind.mv2 in project root) */
  memoryPath: string;
  /** Maximum observations to inject at session start */
  maxContextObservations: number;
  /** Maximum tokens for context injection */
  maxContextTokens: number;
  /** Whether to auto-compress observations */
  autoCompress: boolean;
  /** Minimum confidence for storing observations */
  minConfidence: number;
  /** Enable debug logging */
  debug: boolean;
}

/** Default configuration */
export const DEFAULT_CONFIG: MindConfig = {
  memoryPath: ".agent-brain/mind.mv2",
  maxContextObservations: 20,
  maxContextTokens: 2000,
  autoCompress: true,
  minConfidence: 0.6,
  debug: false,
};

/** Hook input from the host coding assistant (Claude Code, OpenCode, etc.) */
export interface HookInput {
  session_id: string;
  platform?: string;
  contract_version?: string;
  project_id?: string;
  transcript_path?: string;
  cwd?: string;
  hook_event_name?: string;
  permission_mode?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
  tool_response?: unknown; // Can be object or string depending on tool
  tool_use_id?: string;
}

/** Hook output to Claude Code */
export interface HookOutput {
  continue?: boolean;
  result?: string;
  decision?: "block" | "approve" | "modify";
  reason?: string;
  modified_input?: Record<string, unknown>;
}

/** Search result from memory */
export interface MemorySearchResult {
  observation: Observation;
  score: number;
  snippet: string;
}

/** Statistics about the mind file */
export interface MindStats {
  totalObservations: number;
  totalSessions: number;
  oldestMemory: number;
  newestMemory: number;
  fileSize: number;
  topTypes: Record<ObservationType, number>;
}
