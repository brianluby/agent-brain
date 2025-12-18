/**
 * Memvid Mind - Type Definitions
 *
 * Core types for Claude Code memory persistence.
 */
/** Observation captured from tool use */
interface Observation {
    id: string;
    timestamp: number;
    type: ObservationType;
    tool?: string;
    summary: string;
    content: string;
    metadata?: ObservationMetadata;
}
/** Types of observations */
type ObservationType = "discovery" | "decision" | "problem" | "solution" | "pattern" | "warning" | "success" | "refactor" | "bugfix" | "feature";
/** Metadata attached to observations */
interface ObservationMetadata {
    files?: string[];
    functions?: string[];
    error?: string;
    confidence?: number;
    tags?: string[];
    sessionId?: string;
    [key: string]: unknown;
}
/** Session summary stored at end of session */
interface SessionSummary {
    id: string;
    startTime: number;
    endTime: number;
    observationCount: number;
    keyDecisions: string[];
    filesModified: string[];
    summary: string;
}
/** Context injected at session start */
interface InjectedContext {
    recentObservations: Observation[];
    relevantMemories: Observation[];
    sessionSummaries: SessionSummary[];
    tokenCount: number;
}
/** Configuration for Memvid Mind */
interface MindConfig {
    /** Path to the .memvid file (default: .mind.mv2 in project root) */
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
declare const DEFAULT_CONFIG: MindConfig;
/** Hook input from Claude Code */
interface HookInput {
    session_id: string;
    transcript_path?: string;
    cwd?: string;
    hook_event_name?: string;
    permission_mode?: string;
    tool_name?: string;
    tool_input?: Record<string, unknown>;
    tool_response?: unknown;
    tool_use_id?: string;
}
/** Hook output to Claude Code */
interface HookOutput {
    continue?: boolean;
    result?: string;
    decision?: "block" | "approve" | "modify";
    reason?: string;
    modified_input?: Record<string, unknown>;
}
/** Search result from memory */
interface MemorySearchResult {
    observation: Observation;
    score: number;
    snippet: string;
}
/** Statistics about the mind file */
interface MindStats {
    totalObservations: number;
    totalSessions: number;
    oldestMemory: number;
    newestMemory: number;
    fileSize: number;
    topTypes: Record<ObservationType, number>;
}

/**
 * Memvid Mind - Core Engine
 *
 * The brain behind Claude's persistent memory.
 * Stores everything in ONE portable .memvid file.
 */

/**
 * Mind - Claude's portable memory engine
 *
 * @example
 * ```typescript
 * const mind = await Mind.open();
 * await mind.remember({
 *   type: "decision",
 *   summary: "Chose React over Vue for frontend",
 *   content: "Decision rationale: team familiarity, ecosystem..."
 * });
 *
 * const context = await mind.getContext("authentication");
 * ```
 */
declare class Mind {
    private memvid;
    private config;
    private sessionId;
    private initialized;
    private constructor();
    /**
     * Open or create a Mind instance
     */
    static open(configOverrides?: Partial<MindConfig>): Promise<Mind>;
    /**
     * Remember an observation
     */
    remember(input: {
        type: ObservationType;
        summary: string;
        content: string;
        tool?: string;
        metadata?: Record<string, unknown>;
    }): Promise<string>;
    /**
     * Search memories by query
     */
    search(query: string, limit?: number): Promise<MemorySearchResult[]>;
    /**
     * Ask the memory a question (with LLM-generated answer)
     */
    ask(question: string): Promise<string>;
    /**
     * Get context for session start
     */
    getContext(query?: string): Promise<InjectedContext>;
    /**
     * Save a session summary
     */
    saveSessionSummary(summary: {
        keyDecisions: string[];
        filesModified: string[];
        summary: string;
    }): Promise<string>;
    /**
     * Get memory statistics
     */
    stats(): Promise<MindStats>;
    /**
     * Get the session ID
     */
    getSessionId(): string;
    /**
     * Get the memory file path
     */
    getMemoryPath(): string;
    /**
     * Check if initialized
     */
    isInitialized(): boolean;
}
/**
 * Get or create the Mind singleton
 */
declare function getMind(config?: Partial<MindConfig>): Promise<Mind>;
/**
 * Reset the Mind singleton (for testing)
 */
declare function resetMind(): void;

/**
 * Memvid Mind - Utility Helpers
 */
/**
 * Generate a unique ID
 */
declare function generateId(): string;
/**
 * Estimate token count for text (rough approximation)
 * ~4 characters per token for English text
 */
declare function estimateTokens(text: string): number;
/**
 * Truncate text to fit within token limit
 */
declare function truncateToTokens(text: string, maxTokens: number): string;
/**
 * Format timestamp to human-readable string
 */
declare function formatTimestamp(ts: number): string;
/**
 * Parse JSON safely
 */
declare function safeJsonParse<T>(text: string, fallback: T): T;
/**
 * Read all stdin as string
 */
declare function readStdin(): Promise<string>;
/**
 * Write JSON to stdout and exit
 */
declare function writeOutput(output: unknown): void;
/**
 * Log debug message to stderr
 */
declare function debug(message: string): void;
/**
 * Extract key information from tool output
 */
declare function extractKeyInfo(toolName: string, output: string): string;
/**
 * Classify observation type from tool and output
 */
declare function classifyObservationType(toolName: string, output: string): "discovery" | "decision" | "problem" | "solution" | "pattern" | "warning" | "success" | "refactor" | "bugfix" | "feature";

export { DEFAULT_CONFIG, type HookInput, type HookOutput, type InjectedContext, type MemorySearchResult, Mind, type MindConfig, type MindStats, type Observation, type ObservationMetadata, type ObservationType, type SessionSummary, classifyObservationType, debug, estimateTokens, extractKeyInfo, formatTimestamp, generateId, getMind, readStdin, resetMind, safeJsonParse, truncateToTokens, writeOutput };
