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
    platform?: string;
    contract_version?: string;
    project_id?: string;
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
    private memoryPath;
    private sessionId;
    private initialized;
    private constructor();
    /**
     * Open or create a Mind instance
     */
    static open(configOverrides?: Partial<MindConfig>): Promise<Mind>;
    private withLock;
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
     * Search memories by query (uses fast lexical search)
     */
    search(query: string, limit?: number): Promise<MemorySearchResult[]>;
    private searchUnlocked;
    /**
     * Ask the memory a question (uses fast lexical search)
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
 * Write JSON to stdout and exit immediately
 * (Prevents SDK background tasks from blocking process exit)
 */
declare function writeOutput(output: unknown): never;
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

type PlatformEventType = "session_start" | "tool_observation" | "session_stop";
interface PlatformProjectContext {
    platformProjectId?: string;
    canonicalPath?: string;
    cwd?: string;
}
interface PlatformEventBase {
    eventId: string;
    eventType: PlatformEventType;
    platform: string;
    contractVersion: string;
    sessionId: string;
    timestamp: number;
    projectContext: PlatformProjectContext;
}
interface SessionStartPayload {
    hookEventName?: string;
    permissionMode?: string;
    transcriptPath?: string;
}
interface ToolObservationPayload {
    toolName?: string;
    toolInput?: Record<string, unknown>;
    toolResponse?: unknown;
}
interface SessionStopPayload {
    transcriptPath?: string;
}
interface SessionStartEvent extends PlatformEventBase {
    eventType: "session_start";
    payload: SessionStartPayload;
}
interface ToolObservationEvent extends PlatformEventBase {
    eventType: "tool_observation";
    payload: ToolObservationPayload;
}
interface SessionStopEvent extends PlatformEventBase {
    eventType: "session_stop";
    payload: SessionStopPayload;
}
type PlatformEvent = SessionStartEvent | ToolObservationEvent | SessionStopEvent;

declare const SUPPORTED_ADAPTER_CONTRACT_MAJOR = 1;
interface ContractValidationResult {
    compatible: boolean;
    supportedMajor: number;
    adapterMajor: number | null;
    reason?: string;
}
declare function validateAdapterContractVersion(version: string, supportedMajor?: number): ContractValidationResult;
interface PlatformAdapter {
    platform: string;
    contractVersion: string;
    normalizeSessionStart(input: HookInput): SessionStartEvent;
    normalizeToolObservation(input: HookInput): ToolObservationEvent | null;
    normalizeSessionStop(input: HookInput): SessionStopEvent;
}

interface ReadonlyAdapterRegistry {
    resolve(platform: string): PlatformAdapter | null;
    listPlatforms(): string[];
}

type DiagnosticSeverity = "warning" | "error";
interface AdapterDiagnostic {
    diagnosticId: string;
    timestamp: number;
    platform: string;
    errorType: string;
    fieldNames?: string[];
    severity: DiagnosticSeverity;
    redacted: true;
    retentionDays: number;
    expiresAt: number;
}

interface CreateDiagnosticInput {
    platform: string;
    errorType: string;
    fieldNames?: string[];
    severity?: DiagnosticSeverity;
    now?: number;
}
declare function createRedactedDiagnostic(input: CreateDiagnosticInput): AdapterDiagnostic;

type ProjectIdentitySource = "platform_project_id" | "canonical_path" | "unresolved";
interface ProjectIdentityResolution {
    key: string | null;
    source: ProjectIdentitySource;
    canonicalPath?: string;
}
declare function resolveProjectIdentityKey(context: PlatformProjectContext): ProjectIdentityResolution;

type MemoryPathMode = "legacy_first" | "platform_opt_in";
interface MemoryPathPolicyInput {
    projectDir: string;
    platform: string;
    legacyRelativePath: string;
    platformRelativePath?: string;
    platformOptIn?: boolean;
}
interface MemoryPathPolicyResult {
    mode: MemoryPathMode;
    memoryPath: string;
}
declare function resolveMemoryPathPolicy(input: MemoryPathPolicyInput): MemoryPathPolicyResult;

interface ProcessPlatformEventResult {
    skipped: boolean;
    reason?: string;
    projectIdentityKey?: string;
    diagnostic?: AdapterDiagnostic;
}
declare function processPlatformEvent(event: PlatformEvent): ProcessPlatformEventResult;

declare function detectPlatformFromEnv(): string;
declare function detectPlatform(input: HookInput): string;

declare const claudeAdapter: PlatformAdapter;

declare const opencodeAdapter: PlatformAdapter;

/**
 * Example minimal adapter scaffold for future platform onboarding.
 * This adapter is intentionally not registered by default.
 *
 * To create a new adapter for your platform, use:
 *   export const myAdapter = createAdapter("my-platform");
 * Then register it via AdapterRegistry.register(myAdapter).
 */
declare const exampleAdapter: PlatformAdapter;

declare function createAdapter(platform: string): PlatformAdapter;

declare function getDefaultAdapterRegistry(): ReadonlyAdapterRegistry;
declare function resetDefaultAdapterRegistry(): void;

export { DEFAULT_CONFIG, type HookInput, type HookOutput, type InjectedContext, type MemorySearchResult, Mind, type MindConfig, type MindStats, type Observation, type ObservationMetadata, type ObservationType, type ReadonlyAdapterRegistry, SUPPORTED_ADAPTER_CONTRACT_MAJOR, type SessionSummary, classifyObservationType, claudeAdapter, createAdapter, createRedactedDiagnostic, debug, detectPlatform, detectPlatformFromEnv, estimateTokens, exampleAdapter, extractKeyInfo, formatTimestamp, generateId, getDefaultAdapterRegistry, getMind, opencodeAdapter, processPlatformEvent, readStdin, resetDefaultAdapterRegistry, resetMind, resolveMemoryPathPolicy, resolveProjectIdentityKey, safeJsonParse, truncateToTokens, validateAdapterContractVersion, writeOutput };
