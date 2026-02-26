/**
 * Memvid Mind - Core Engine
 *
 * The brain behind Claude's persistent memory.
 * Stores everything in ONE portable .memvid file.
 */

// Use dynamic import to allow smart-install to run first
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Memvid = any;

import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { mkdir } from "node:fs/promises";
import {
  type Observation,
  type ObservationType,
  type SessionSummary,
  type InjectedContext,
  type MindConfig,
  type MindStats,
  type MemorySearchResult,
  DEFAULT_CONFIG,
  DEFAULT_MEMORY_PATH,
} from "../types.js";
import { generateId, estimateTokens } from "../utils/helpers.js";
import { withMemvidLock } from "../utils/memvid-lock.js";
import { resolveMemoryPathPolicy } from "../platforms/path-policy.js";
import { detectPlatformFromEnv } from "../platforms/platform-detector.js";

/**
 * Prune old backup files, keeping only the most recent N
 */
function pruneBackups(memoryPath: string, keepCount: number): void {
  try {
    const dir = dirname(memoryPath);
    const baseName = memoryPath.split("/").pop() || "mind.mv2";
    const backupPattern = new RegExp(`^${baseName.replace(".", "\\.")}\\.backup-\\d+$`);

    const files = readdirSync(dir);
    const backups = files
      .filter(f => backupPattern.test(f))
      .map(f => ({
        name: f,
        path: resolve(dir, f),
        time: parseInt(f.split("-").pop() || "0", 10),
      }))
      .sort((a, b) => b.time - a.time); // newest first

    // Delete old backups beyond keepCount
    for (let i = keepCount; i < backups.length; i++) {
      try {
        unlinkSync(backups[i].path);
        console.error(`[memvid-mind] Pruned old backup: ${backups[i].name}`);
      } catch {
        // Ignore errors deleting backups
      }
    }
  } catch {
    // Ignore errors during pruning
  }
}

// Lazy-loaded SDK functions
let sdkLoaded = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let use: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let create: any;

async function loadSDK(): Promise<void> {
  if (sdkLoaded) return;
  const sdk = await import("@memvid/sdk");
  use = sdk.use;
  create = sdk.create;
  sdkLoaded = true;
}

const OBSERVATION_TYPE_KEYS: ObservationType[] = [
  "discovery",
  "decision",
  "problem",
  "solution",
  "pattern",
  "warning",
  "success",
  "refactor",
  "bugfix",
  "feature",
];

const OBSERVATION_TYPE_SET = new Set<ObservationType>(OBSERVATION_TYPE_KEYS);

function emptyTypeCounts(): Record<ObservationType, number> {
  return {
    discovery: 0,
    decision: 0,
    problem: 0,
    solution: 0,
    pattern: 0,
    warning: 0,
    success: 0,
    refactor: 0,
    bugfix: 0,
    feature: 0,
  };
}

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
export class Mind {
  private memvid: Memvid;
  private config: MindConfig;
  private memoryPath: string;
  private sessionId: string;
  private sessionStartTime: number;
  private sessionObservationCount = 0;
  private cachedStats: MindStats | null = null;
  private cachedStatsFrameCount = -1;
  private initialized = false;

  private constructor(memvid: Memvid, config: MindConfig, memoryPath: string) {
    this.memvid = memvid;
    this.config = config;
    this.memoryPath = memoryPath;
    this.sessionId = generateId();
    this.sessionStartTime = Date.now();
  }

  /**
   * Open or create a Mind instance
   */
  static async open(configOverrides: Partial<MindConfig> = {}): Promise<Mind> {
    // Load SDK dynamically (allows smart-install to run first)
    await loadSDK();

    const config = { ...DEFAULT_CONFIG, ...configOverrides };

    // Resolve path relative to project dir (use CLAUDE_PROJECT_DIR if available)
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const platform = detectPlatformFromEnv();
    const optIn = process.env.MEMVID_PLATFORM_PATH_OPT_IN === "1";
    const legacyFallbacks = config.memoryPath === DEFAULT_MEMORY_PATH ? [".claude/mind.mv2"] : [];
    const pathPolicy = resolveMemoryPathPolicy({
      projectDir,
      platform,
      defaultRelativePath: config.memoryPath,
      legacyRelativePaths: legacyFallbacks,
      platformRelativePath: process.env.MEMVID_PLATFORM_MEMORY_PATH,
      platformOptIn: optIn,
    });
    const memoryPath = pathPolicy.memoryPath;
    const memoryDir = dirname(memoryPath);

    // Ensure directory exists
    await mkdir(memoryDir, { recursive: true });

    // Open or create the memvid file
    let memvid: Memvid;
    const MAX_FILE_SIZE_MB = 100; // Files over 100MB are likely corrupted
    const lockPath = `${memoryPath}.lock`;

    await withMemvidLock(lockPath, async () => {
      if (!existsSync(memoryPath)) {
        memvid = await create(memoryPath, "basic");
        return;
      }

      // Check file size - very large files are likely corrupted and will hang
      const { statSync, renameSync, unlinkSync } = await import("node:fs");
      const fileSize = statSync(memoryPath).size;
      const fileSizeMB = fileSize / (1024 * 1024);

      if (fileSizeMB > MAX_FILE_SIZE_MB) {
        console.error(`[memvid-mind] Memory file too large (${fileSizeMB.toFixed(1)}MB), likely corrupted. Creating fresh memory...`);
        const backupPath = `${memoryPath}.backup-${Date.now()}`;
        try { renameSync(memoryPath, backupPath); } catch { /* ignore */ }
        memvid = await create(memoryPath, "basic");
        return;
      }

      try {
        memvid = await use("basic", memoryPath);
      } catch (openError: unknown) {
        const errorMessage = openError instanceof Error ? openError.message : String(openError);
        // Handle corrupted or incompatible memory files
        if (errorMessage.includes("Deserialization") ||
            errorMessage.includes("UnexpectedVariant") ||
            errorMessage.includes("Invalid") ||
            errorMessage.includes("corrupt") ||
            errorMessage.includes("validation failed") ||
            errorMessage.includes("unable to recover") ||
            errorMessage.includes("table of contents")) {
          console.error("[memvid-mind] Memory file corrupted, creating fresh memory...");
          const backupPath = `${memoryPath}.backup-${Date.now()}`;
          try {
            renameSync(memoryPath, backupPath);
          } catch {
            try { unlinkSync(memoryPath); } catch { /* ignore */ }
          }
          memvid = await create(memoryPath, "basic");
          return;
        }
        throw openError;
      }
    });

    const mind = new Mind(memvid, config, memoryPath);
    mind.initialized = true;

    // Prune old backups (keep only most recent 3)
    pruneBackups(memoryPath, 3);

    if (config.debug) {
      console.error(`[memvid-mind] Opened: ${memoryPath}`);
    }

    return mind;
  }

  private async withLock<T>(fn: () => Promise<T>): Promise<T> {
    const memoryPath = this.getMemoryPath();
    const lockPath = `${memoryPath}.lock`;
    return withMemvidLock(lockPath, fn);
  }

  /**
   * Remember an observation
   */
  async remember(input: {
    type: ObservationType;
    summary: string;
    content: string;
    tool?: string;
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    const observation: Observation = {
      id: generateId(),
      timestamp: Date.now(),
      type: input.type,
      tool: input.tool,
      summary: input.summary,
      content: input.content,
      metadata: {
        ...input.metadata,
        sessionId: this.sessionId,
      },
    };

    const frameId = await this.withLock(async () => {
      return this.memvid.put({
        title: `[${observation.type}] ${observation.summary}`,
        label: observation.type,
        text: observation.content,
        metadata: {
          observationId: observation.id,
          timestamp: observation.timestamp,
          tool: observation.tool,
          sessionId: this.sessionId,
          ...observation.metadata,
        },
        tags: [
          observation.type,
          `session:${this.sessionId}`,
          observation.tool ? `tool:${observation.tool}` : undefined,
        ].filter(Boolean) as string[],
      });
    });

    if (this.config.debug) {
      console.error(`[memvid-mind] Remembered: ${observation.summary}`);
    }

    this.sessionObservationCount += 1;
    this.cachedStats = null;
    this.cachedStatsFrameCount = -1;

    return frameId;
  }

  /**
   * Search memories by query (uses fast lexical search)
   */
  async search(query: string, limit = 10): Promise<MemorySearchResult[]> {
    return this.withLock(async () => {
      return this.searchUnlocked(query, limit);
    });
  }

  private async searchUnlocked(query: string, limit: number): Promise<MemorySearchResult[]> {
    const results = await this.memvid.find(query, { k: limit, mode: "lex" });

    const frames = this.toSearchFrames(results);

    return frames.map((frame: any) => {
      const rawTags = Array.isArray(frame.tags)
        ? frame.tags.filter((tag: unknown): tag is string => typeof tag === "string")
        : [];
      const prefixedToolTag = rawTags.find((tag: string) => tag.startsWith("tool:"));

      const labels = Array.isArray(frame.labels)
        ? frame.labels.filter((label: unknown): label is string => typeof label === "string")
        : [];

      const metadata = frame.metadata && typeof frame.metadata === "object"
        ? frame.metadata as Record<string, unknown>
        : {};

      const observationType = this.extractObservationType({
        label: frame.label,
        labels,
      }) || "discovery";

      const legacyToolTag = rawTags.find((tag: string) => {
        if (tag.startsWith("tool:") || tag.startsWith("session:")) {
          return false;
        }
        if (!/[A-Z]/.test(tag)) {
          return false;
        }
        return tag.toLowerCase() !== observationType;
      });

      const tool = typeof prefixedToolTag === "string"
        ? prefixedToolTag.replace(/^tool:/, "")
        : typeof metadata.tool === "string"
          ? metadata.tool
          : legacyToolTag;

      const timestamp = this.normalizeTimestampMs(
        metadata.timestamp
        || frame.timestamp
        || (typeof frame.created_at === "string" ? Date.parse(frame.created_at) : 0)
      );

      return {
      observation: {
        id: String(metadata.observationId || frame.frame_id || generateId()),
        timestamp,
        type: observationType,
        tool,
        summary: frame.title?.replace(/^\[.*?\]\s*/, "") || frame.snippet || "",
        content: frame.text || frame.snippet || "",
        metadata: {
          ...metadata,
          labels,
          tags: rawTags,
        },
      },
      score: frame.score || 0,
      snippet: frame.snippet || frame.text?.slice(0, 200) || "",
    };
    });
  }

  private toTimelineFrames(timelineResult: any): any[] {
    return Array.isArray(timelineResult) ? timelineResult : (timelineResult.frames || []);
  }

  private toSearchFrames(searchResult: any): any[] {
    if (Array.isArray(searchResult?.hits)) {
      return searchResult.hits;
    }
    if (Array.isArray(searchResult?.frames)) {
      return searchResult.frames;
    }
    return [];
  }

  private normalizeTimestampMs(value: unknown): number {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return 0;
    }

    // normalizeTimestampMs heuristic: 4102444800 is 2100-01-01 in epoch seconds.
    // Values below 4102444800 are treated as seconds (SDK timeline fields can be
    // second-based), so we multiply by 1000 to normalize to milliseconds.
    if (value < 4102444800) {
      return Math.round(value * 1000);
    }

    return Math.round(value);
  }

  private parseSessionSummary(value: unknown): SessionSummary | null {
    if (!value || typeof value !== "object") {
      return null;
    }

    const candidate = value as Record<string, unknown>;
    if (
      typeof candidate.id !== "string" ||
      typeof candidate.startTime !== "number" ||
      typeof candidate.endTime !== "number" ||
      typeof candidate.observationCount !== "number" ||
      typeof candidate.summary !== "string" ||
      !Array.isArray(candidate.keyDecisions) ||
      !Array.isArray(candidate.filesModified)
    ) {
      return null;
    }

    return {
      id: candidate.id,
      startTime: this.normalizeTimestampMs(candidate.startTime),
      endTime: this.normalizeTimestampMs(candidate.endTime),
      observationCount: Math.max(0, Math.trunc(candidate.observationCount)),
      keyDecisions: candidate.keyDecisions.filter(
        (decision): decision is string => typeof decision === "string"
      ),
      filesModified: candidate.filesModified.filter(
        (file): file is string => typeof file === "string"
      ),
      summary: candidate.summary,
    };
  }

  private extractSessionSummary(frame: any): SessionSummary | null {
    const fromMetadata = this.parseSessionSummary(frame.metadata);
    if (fromMetadata) {
      return fromMetadata;
    }

    if (typeof frame.text !== "string") {
      return null;
    }

    try {
      return this.parseSessionSummary(JSON.parse(frame.text));
    } catch {
      return null;
    }
  }

  private extractSessionId(frame: any): string | null {
    const tags = Array.isArray(frame?.tags)
      ? frame.tags.filter((tag: unknown): tag is string => typeof tag === "string")
      : [];
    const sessionTag = tags.find((tag: string) => tag.startsWith("session:"));
    if (sessionTag) {
      return sessionTag.slice("session:".length);
    }

    const metadataSessionId = frame?.metadata?.sessionId;
    if (typeof metadataSessionId === "string" && metadataSessionId.length > 0) {
      return metadataSessionId;
    }

    if (frame?.label === "session") {
      const summary = this.extractSessionSummary(frame);
      if (summary) {
        return summary.id;
      }
    }

    return null;
  }

  private extractObservationType(frame: any): ObservationType | null {
    if (Array.isArray(frame?.labels)) {
      for (const value of frame.labels) {
        if (typeof value === "string") {
          const normalized = value.toLowerCase();
          if (OBSERVATION_TYPE_SET.has(normalized as ObservationType)) {
            return normalized as ObservationType;
          }
        }
      }
    }

    const label = typeof frame?.label === "string" ? frame.label : undefined;
    if (label) {
      const normalized = label.toLowerCase();
      if (OBSERVATION_TYPE_SET.has(normalized as ObservationType)) {
        return normalized as ObservationType;
      }
    }

    const metadataType = frame?.metadata?.type;
    if (typeof metadataType === "string") {
      const normalized = metadataType.toLowerCase();
      if (OBSERVATION_TYPE_SET.has(normalized as ObservationType)) {
        return normalized as ObservationType;
      }
    }

    return null;
  }

  private extractPreviewFieldValues(preview: unknown, field: "tags" | "labels"): string[] {
    if (typeof preview !== "string" || preview.length === 0) {
      return [];
    }

    const match = new RegExp(`(?:^|\\n)${field}:\\s*([^\\n]*)`, "i").exec(preview);
    if (!match?.[1]) {
      return [];
    }

    return match[1]
      .split(/[^a-z0-9:_-]+/i)
      .map((value) => value.trim())
      .filter(Boolean);
  }

  private extractObservationTypeFromPreview(preview: unknown): ObservationType | null {
    const labels = this.extractPreviewFieldValues(preview, "labels");
    const fromLabels = this.extractObservationType({ labels });
    if (fromLabels) {
      return fromLabels;
    }

    if (typeof preview !== "string" || preview.length === 0) {
      return null;
    }

    const titleMatch = /(?:^|\n)title:\s*\[([^\]]+)\]/i.exec(preview);
    if (!titleMatch?.[1]) {
      return null;
    }

    const normalized = titleMatch[1].trim().toLowerCase();
    if (OBSERVATION_TYPE_SET.has(normalized as ObservationType)) {
      return normalized as ObservationType;
    }

    return null;
  }

  private parseLeadingJsonObject(text: string): unknown | null {
    const start = text.indexOf("{");
    if (start < 0) {
      return null;
    }

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < text.length; i++) {
      const ch = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (ch === "\\") {
          escaped = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }

      if (ch === '"') {
        inString = true;
        continue;
      }

      if (ch === "{") {
        depth += 1;
      } else if (ch === "}") {
        depth -= 1;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            return null;
          }
        }
      }
    }

    return null;
  }

  private extractSessionSummaryFromSearchHit(hit: any): SessionSummary | null {
    if (typeof hit?.text !== "string") {
      return null;
    }

    const parsed = this.parseLeadingJsonObject(hit.text);
    return this.parseSessionSummary(parsed);
  }

  /**
   * Ask the memory a question (uses fast lexical search)
   */
  async ask(question: string): Promise<string> {
    return this.withLock(async () => {
      const result = await this.memvid.ask(question, { k: 5, mode: "lex" });
      return result.answer || "No relevant memories found.";
    });
  }

  /**
   * Get context for session start
   */
  async getContext(query?: string): Promise<InjectedContext> {
    return this.withLock(async () => {
      // Get recent observations via timeline
      const timeline = await this.memvid.timeline({
        limit: this.config.maxContextObservations,
        reverse: true,
      });

      const frames = this.toTimelineFrames(timeline);

      const recentObservations: Observation[] = [];
      const FRAME_INFO_BATCH_SIZE = 20;
      for (let start = 0; start < frames.length; start += FRAME_INFO_BATCH_SIZE) {
        const batch = frames.slice(start, start + FRAME_INFO_BATCH_SIZE);
        const frameInfos = await Promise.all(batch.map(async (frame: any) => {
          try {
            return await this.memvid.getFrameInfo(frame.frame_id);
          } catch {
            return null;
          }
        }));

        for (let index = 0; index < batch.length; index++) {
          const frame = batch[index];
          const frameInfo = frameInfos[index];
          const labels = Array.isArray(frameInfo?.labels) ? frameInfo.labels : [];
          const tags = Array.isArray(frameInfo?.tags) ? frameInfo.tags : [];
          const metadata = frameInfo?.metadata && typeof frameInfo.metadata === "object"
            ? frameInfo.metadata as Record<string, unknown>
            : {};
          const toolTag = tags.find((tag: string) => typeof tag === "string" && tag.startsWith("tool:"));
          const ts = this.normalizeTimestampMs(frameInfo?.timestamp || frame.timestamp || 0);
          const observationType = this.extractObservationType({
            label: labels[0],
            labels,
            metadata,
          }) || "discovery";

          recentObservations.push({
            id: String(metadata.observationId || frame.metadata?.observationId || frame.frame_id),
            timestamp: ts,
            type: observationType,
            tool: typeof toolTag === "string"
              ? toolTag.replace(/^tool:/, "")
              : (typeof metadata.tool === "string" ? metadata.tool : undefined),
            summary: frameInfo?.title?.replace(/^\[.*?\]\s*/, "") || frame.preview?.slice(0, 100) || "",
            content: frame.preview || "",
            metadata: {
              ...metadata,
              labels,
              tags,
            },
          });
        }
      }

      // Get relevant memories if query provided
      let relevantMemories: Observation[] = [];
      if (query) {
        const searchResults = await this.searchUnlocked(query, 10);
        relevantMemories = searchResults.map((r) => r.observation);
      }

      const summarySearch = await this.memvid.find("Session Summary", {
        k: 20,
        mode: "lex",
      });
      const summaryHits = this.toSearchFrames(summarySearch);
      const seenSessionIds = new Set<string>();
      const sessionSummaries: SessionSummary[] = [];

      for (const hit of summaryHits) {
        const summary = this.extractSessionSummaryFromSearchHit(hit);
        if (!summary || seenSessionIds.has(summary.id)) {
          continue;
        }
        seenSessionIds.add(summary.id);
        sessionSummaries.push(summary);
        if (sessionSummaries.length >= 5) {
          break;
        }
      }

      // Build context with token limit
      const contextParts: string[] = [];
      let tokenCount = 0;

      // Add recent observations
      for (const obs of recentObservations) {
        const text = `[${obs.type}] ${obs.summary}`;
        const tokens = estimateTokens(text);
        if (tokenCount + tokens > this.config.maxContextTokens) break;
        contextParts.push(text);
        tokenCount += tokens;
      }

      return {
        recentObservations,
        relevantMemories,
        sessionSummaries,
        tokenCount,
      };
    });
  }

  /**
   * Save a session summary
   */
  async saveSessionSummary(summary: {
    keyDecisions: string[];
    filesModified: string[];
    summary: string;
  }): Promise<string> {
    return this.withLock(async () => {
      const endTime = Date.now();
      const sessionSummary: SessionSummary = {
        id: this.sessionId,
        startTime: this.sessionStartTime,
        endTime,
        observationCount: this.sessionObservationCount,
        keyDecisions: summary.keyDecisions.slice(0, 20),
        filesModified: summary.filesModified.slice(0, 50),
        summary: summary.summary,
      };

      const frameId = await this.memvid.put({
        title: `Session Summary: ${new Date().toISOString().split("T")[0]}`,
        label: "session",
        text: JSON.stringify(sessionSummary, null, 2),
        metadata: {
          ...sessionSummary,
          sessionId: this.sessionId,
        },
        tags: ["session", "summary", `session:${this.sessionId}`],
      });

      this.cachedStats = null;
      this.cachedStatsFrameCount = -1;
      return frameId;
    });
  }

  /**
   * Get memory statistics
   */
  async stats(): Promise<MindStats> {
    return this.withLock(async () => {
      const stats = await this.memvid.stats();
      const totalFrames = Number(stats.frame_count) || 0;

      if (this.cachedStats && this.cachedStatsFrameCount === totalFrames) {
        return this.cachedStats;
      }

      const timeline = totalFrames > 0
        ? await this.memvid.timeline({ limit: totalFrames, reverse: false })
        : [];
      const frames = this.toTimelineFrames(timeline);

      const sessionIds = new Set<string>();
      const topTypes = emptyTypeCounts();
      let oldestMemory = 0;
      let newestMemory = 0;

      for (const frame of frames) {
        const labels = this.extractPreviewFieldValues(frame.preview, "labels");
        const tags = this.extractPreviewFieldValues(frame.preview, "tags");

        const timestamp = this.normalizeTimestampMs(frame.timestamp || 0);
        if (timestamp > 0) {
          if (oldestMemory === 0 || timestamp < oldestMemory) {
            oldestMemory = timestamp;
          }
          if (newestMemory === 0 || timestamp > newestMemory) {
            newestMemory = timestamp;
          }
        }

        const sessionId = this.extractSessionId({
          ...frame,
          labels,
          tags,
        });
        if (sessionId) {
          sessionIds.add(sessionId);
        }

        const observationType = this.extractObservationType({
          ...frame,
          label: labels[0],
          labels,
          tags,
        }) || this.extractObservationTypeFromPreview(frame.preview);
        if (observationType) {
          topTypes[observationType] += 1;
        }
      }

      const summarySearch = await this.memvid.find("Session Summary", {
        k: 50,
        mode: "lex",
      });
      const summaryHits = this.toSearchFrames(summarySearch);
      for (const hit of summaryHits) {
        const summary = this.extractSessionSummaryFromSearchHit(hit);
        if (summary) {
          sessionIds.add(summary.id);
        }
      }

      const result: MindStats = {
        totalObservations: totalFrames,
        totalSessions: sessionIds.size,
        oldestMemory,
        newestMemory,
        fileSize: (stats.size_bytes as number) || 0,
        topTypes,
      };

      this.cachedStats = result;
      this.cachedStatsFrameCount = totalFrames;
      return result;
    });
  }

  /**
   * Get the session ID
   */
  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Get the memory file path
   */
  getMemoryPath(): string {
    return this.memoryPath;
  }

  /**
   * Check if initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }
}

// Singleton instance for hooks
let mindInstance: Mind | null = null;

/**
 * Get or create the Mind singleton
 */
export async function getMind(config?: Partial<MindConfig>): Promise<Mind> {
  if (!mindInstance) {
    mindInstance = await Mind.open(config);
  }
  return mindInstance;
}

/**
 * Reset the Mind singleton (for testing)
 */
export function resetMind(): void {
  mindInstance = null;
}
