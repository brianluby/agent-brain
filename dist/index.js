import { existsSync, readdirSync, unlinkSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'fs';
import { dirname, isAbsolute, resolve, relative, sep } from 'path';
import { mkdir, open } from 'fs/promises';
import { randomBytes } from 'crypto';
import lockfile from 'proper-lockfile';
import { tmpdir } from 'os';

// src/core/mind.ts

// src/types.ts
var DEFAULT_MEMORY_PATH = ".agent-brain/mind.mv2";
var DEFAULT_CONFIG = {
  memoryPath: DEFAULT_MEMORY_PATH,
  maxContextObservations: 20,
  maxContextTokens: 2e3,
  autoCompress: true,
  minConfidence: 0.6,
  debug: false
};
function generateId() {
  return randomBytes(8).toString("hex");
}
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}
function truncateToTokens(text, maxTokens) {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + "...";
}
function formatTimestamp(ts) {
  const date = new Date(ts);
  const now = /* @__PURE__ */ new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 6e4);
  const diffHours = Math.floor(diffMs / 36e5);
  const diffDays = Math.floor(diffMs / 864e5);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}
function safeJsonParse(text, fallback) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}
async function readStdin() {
  const chunks = [];
  return new Promise((resolve5, reject) => {
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve5(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}
function writeOutput(output) {
  console.log(JSON.stringify(output));
  process.exit(0);
}
function debug(message) {
  if (process.env.MEMVID_MIND_DEBUG === "1") {
    console.error(`[memvid-mind] ${message}`);
  }
}
function extractKeyInfo(toolName, output) {
  const maxLength = 2e3;
  const truncated = output.length > maxLength ? output.slice(0, maxLength) + "\n... (truncated)" : output;
  switch (toolName) {
    case "Read":
      return extractFileReadSummary(truncated);
    case "Bash":
      return extractBashSummary(truncated);
    case "Edit":
      return extractEditSummary(truncated);
    case "Grep":
    case "Glob":
      return extractSearchSummary(truncated);
    default:
      return truncated;
  }
}
function extractFileReadSummary(output) {
  const lines = output.split("\n");
  if (lines.length <= 20) return output;
  return `${lines.slice(0, 10).join("\n")}
... (${lines.length} lines total)`;
}
function extractBashSummary(output) {
  const lines = output.split("\n");
  if (lines.length <= 30) return output;
  return [
    ...lines.slice(0, 10),
    `... (${lines.length - 20} lines omitted)`,
    ...lines.slice(-10)
  ].join("\n");
}
function extractEditSummary(output) {
  return output;
}
function extractSearchSummary(output) {
  const lines = output.split("\n").filter(Boolean);
  if (lines.length <= 20) return output;
  return [
    ...lines.slice(0, 15),
    `... and ${lines.length - 15} more results`
  ].join("\n");
}
function classifyObservationType(toolName, output) {
  const lowerOutput = output.toLowerCase();
  if (lowerOutput.includes("error") || lowerOutput.includes("failed") || lowerOutput.includes("exception")) {
    return "problem";
  }
  if (lowerOutput.includes("success") || lowerOutput.includes("passed") || lowerOutput.includes("completed")) {
    return "success";
  }
  if (lowerOutput.includes("warning") || lowerOutput.includes("deprecated")) {
    return "warning";
  }
  switch (toolName) {
    case "Read":
    case "Glob":
    case "Grep":
      return "discovery";
    case "Edit":
      if (lowerOutput.includes("fix") || lowerOutput.includes("bug")) {
        return "bugfix";
      }
      return "refactor";
    case "Write":
      return "feature";
    default:
      return "discovery";
  }
}
var LOCK_OPTIONS = {
  stale: 3e4,
  retries: {
    retries: 1e3,
    minTimeout: 5,
    maxTimeout: 50
  }
};
async function withMemvidLock(lockPath, fn) {
  await mkdir(dirname(lockPath), { recursive: true });
  const handle = await open(lockPath, "a");
  await handle.close();
  const release = await lockfile.lock(lockPath, LOCK_OPTIONS);
  try {
    return await fn();
  } finally {
    await release();
  }
}
function defaultPlatformRelativePath(platform) {
  const normalizedPlatform = platform.trim().toLowerCase();
  const safePlatform = normalizedPlatform.replace(/[^a-z0-9_-]/g, "-").replace(/^-+|-+$/g, "") || "unknown";
  return `.agent-brain/mind-${safePlatform}.mv2`;
}
function resolveInsideProject(projectDir, candidatePath) {
  if (isAbsolute(candidatePath)) {
    return resolve(candidatePath);
  }
  const root = resolve(projectDir);
  const resolved = resolve(root, candidatePath);
  const rel = relative(root, resolved);
  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    throw new Error("Resolved memory path must stay inside projectDir");
  }
  return resolved;
}
function resolveMemoryPathPolicy(input) {
  const mode = input.platformOptIn ? "platform_opt_in" : "legacy_first";
  const canonicalRelativePath = input.platformOptIn ? input.platformRelativePath || defaultPlatformRelativePath(input.platform) : input.defaultRelativePath;
  const canonicalPath = resolveInsideProject(input.projectDir, canonicalRelativePath);
  if (existsSync(canonicalPath)) {
    return {
      mode,
      memoryPath: canonicalPath,
      canonicalPath
    };
  }
  const fallbackPaths = (input.legacyRelativePaths || []).map((relativePath) => resolveInsideProject(input.projectDir, relativePath));
  for (const fallbackPath of fallbackPaths) {
    if (existsSync(fallbackPath)) {
      return {
        mode,
        memoryPath: fallbackPath,
        canonicalPath,
        migrationSuggestion: {
          fromPath: fallbackPath,
          toPath: canonicalPath
        }
      };
    }
  }
  if (input.platformOptIn) {
    return {
      mode: "platform_opt_in",
      memoryPath: canonicalPath,
      canonicalPath
    };
  }
  return {
    mode: "legacy_first",
    memoryPath: canonicalPath,
    canonicalPath
  };
}

// src/platforms/platform-detector.ts
function normalizePlatform(value) {
  if (!value) return void 0;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : void 0;
}
function detectPlatformFromEnv() {
  const explicitFromEnv = normalizePlatform(process.env.MEMVID_PLATFORM);
  if (explicitFromEnv) {
    return explicitFromEnv;
  }
  if (process.env.OPENCODE === "1") {
    return "opencode";
  }
  return "claude";
}
function detectPlatform(input) {
  const explicitFromHook = normalizePlatform(input.platform);
  if (explicitFromHook) {
    return explicitFromHook;
  }
  return detectPlatformFromEnv();
}

// src/core/mind.ts
function pruneBackups(memoryPath, keepCount) {
  try {
    const dir = dirname(memoryPath);
    const baseName = memoryPath.split("/").pop() || "mind.mv2";
    const backupPattern = new RegExp(`^${baseName.replace(".", "\\.")}\\.backup-\\d+$`);
    const files = readdirSync(dir);
    const backups = files.filter((f) => backupPattern.test(f)).map((f) => ({
      name: f,
      path: resolve(dir, f),
      time: parseInt(f.split("-").pop() || "0", 10)
    })).sort((a, b) => b.time - a.time);
    for (let i = keepCount; i < backups.length; i++) {
      try {
        unlinkSync(backups[i].path);
        console.error(`[memvid-mind] Pruned old backup: ${backups[i].name}`);
      } catch {
      }
    }
  } catch {
  }
}
var sdkLoaded = false;
var use;
var create;
async function loadSDK() {
  if (sdkLoaded) return;
  const sdk = await import('@memvid/sdk');
  use = sdk.use;
  create = sdk.create;
  sdkLoaded = true;
}
var OBSERVATION_TYPE_KEYS = [
  "discovery",
  "decision",
  "problem",
  "solution",
  "pattern",
  "warning",
  "success",
  "refactor",
  "bugfix",
  "feature"
];
var OBSERVATION_TYPE_SET = new Set(OBSERVATION_TYPE_KEYS);
function emptyTypeCounts() {
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
    feature: 0
  };
}
var Mind = class _Mind {
  memvid;
  config;
  memoryPath;
  sessionId;
  sessionStartTime;
  sessionObservationCount = 0;
  cachedStats = null;
  cachedStatsFrameCount = -1;
  initialized = false;
  constructor(memvid, config, memoryPath) {
    this.memvid = memvid;
    this.config = config;
    this.memoryPath = memoryPath;
    this.sessionId = generateId();
    this.sessionStartTime = Date.now();
  }
  /**
   * Open or create a Mind instance
   */
  static async open(configOverrides = {}) {
    await loadSDK();
    const config = { ...DEFAULT_CONFIG, ...configOverrides };
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.OPENCODE_PROJECT_DIR || process.cwd();
    const platform = detectPlatformFromEnv();
    const optIn = process.env.MEMVID_PLATFORM_PATH_OPT_IN === "1";
    const legacyFallbacks = config.memoryPath === DEFAULT_MEMORY_PATH ? [".claude/mind.mv2"] : [];
    const pathPolicy = resolveMemoryPathPolicy({
      projectDir,
      platform,
      defaultRelativePath: config.memoryPath,
      legacyRelativePaths: legacyFallbacks,
      platformRelativePath: process.env.MEMVID_PLATFORM_MEMORY_PATH,
      platformOptIn: optIn
    });
    const memoryPath = pathPolicy.memoryPath;
    const memoryDir = dirname(memoryPath);
    await mkdir(memoryDir, { recursive: true });
    let memvid;
    const MAX_FILE_SIZE_MB = 100;
    const lockPath = `${memoryPath}.lock`;
    await withMemvidLock(lockPath, async () => {
      if (!existsSync(memoryPath)) {
        memvid = await create(memoryPath, "basic");
        return;
      }
      const { statSync, renameSync: renameSync2, unlinkSync: unlinkSync2 } = await import('fs');
      const fileSize = statSync(memoryPath).size;
      const fileSizeMB = fileSize / (1024 * 1024);
      if (fileSizeMB > MAX_FILE_SIZE_MB) {
        console.error(`[memvid-mind] Memory file too large (${fileSizeMB.toFixed(1)}MB), likely corrupted. Creating fresh memory...`);
        const backupPath = `${memoryPath}.backup-${Date.now()}`;
        try {
          renameSync2(memoryPath, backupPath);
        } catch {
        }
        memvid = await create(memoryPath, "basic");
        return;
      }
      try {
        memvid = await use("basic", memoryPath);
      } catch (openError) {
        const errorMessage = openError instanceof Error ? openError.message : String(openError);
        if (errorMessage.includes("Deserialization") || errorMessage.includes("UnexpectedVariant") || errorMessage.includes("Invalid") || errorMessage.includes("corrupt") || errorMessage.includes("validation failed") || errorMessage.includes("unable to recover") || errorMessage.includes("table of contents")) {
          console.error("[memvid-mind] Memory file corrupted, creating fresh memory...");
          const backupPath = `${memoryPath}.backup-${Date.now()}`;
          try {
            renameSync2(memoryPath, backupPath);
          } catch {
            try {
              unlinkSync2(memoryPath);
            } catch {
            }
          }
          memvid = await create(memoryPath, "basic");
          return;
        }
        throw openError;
      }
    });
    const mind = new _Mind(memvid, config, memoryPath);
    mind.initialized = true;
    pruneBackups(memoryPath, 3);
    if (config.debug) {
      console.error(`[memvid-mind] Opened: ${memoryPath}`);
    }
    return mind;
  }
  async withLock(fn) {
    const memoryPath = this.getMemoryPath();
    const lockPath = `${memoryPath}.lock`;
    return withMemvidLock(lockPath, fn);
  }
  /**
   * Remember an observation
   */
  async remember(input) {
    const observation = {
      id: generateId(),
      timestamp: Date.now(),
      type: input.type,
      tool: input.tool,
      summary: input.summary,
      content: input.content,
      metadata: {
        ...input.metadata,
        sessionId: this.sessionId
      }
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
          ...observation.metadata
        },
        tags: [
          observation.type,
          `session:${this.sessionId}`,
          observation.tool ? `tool:${observation.tool}` : void 0
        ].filter(Boolean)
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
  async search(query, limit = 10) {
    return this.withLock(async () => {
      return this.searchUnlocked(query, limit);
    });
  }
  async searchUnlocked(query, limit) {
    const results = await this.memvid.find(query, { k: limit, mode: "lex" });
    const frames = this.toSearchFrames(results);
    return frames.map((frame) => {
      const rawTags = Array.isArray(frame.tags) ? frame.tags.filter((tag) => typeof tag === "string") : [];
      const prefixedToolTag = rawTags.find((tag) => tag.startsWith("tool:"));
      const labels = Array.isArray(frame.labels) ? frame.labels.filter((label) => typeof label === "string") : [];
      const metadata = frame.metadata && typeof frame.metadata === "object" ? frame.metadata : {};
      const observationType = this.extractObservationType({
        label: frame.label,
        labels
      }) || "discovery";
      const legacyToolTag = rawTags.find((tag) => {
        if (tag.startsWith("tool:") || tag.startsWith("session:")) {
          return false;
        }
        if (!/[A-Z]/.test(tag)) {
          return false;
        }
        return tag.toLowerCase() !== observationType;
      });
      const tool = typeof prefixedToolTag === "string" ? prefixedToolTag.replace(/^tool:/, "") : typeof metadata.tool === "string" ? metadata.tool : legacyToolTag;
      const timestamp = this.normalizeTimestampMs(
        metadata.timestamp || frame.timestamp || (typeof frame.created_at === "string" ? Date.parse(frame.created_at) : 0)
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
            tags: rawTags
          }
        },
        score: frame.score || 0,
        snippet: frame.snippet || frame.text?.slice(0, 200) || ""
      };
    });
  }
  toTimelineFrames(timelineResult) {
    return Array.isArray(timelineResult) ? timelineResult : timelineResult.frames || [];
  }
  toSearchFrames(searchResult) {
    if (Array.isArray(searchResult?.hits)) {
      return searchResult.hits;
    }
    if (Array.isArray(searchResult?.frames)) {
      return searchResult.frames;
    }
    return [];
  }
  normalizeTimestampMs(value) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
      return 0;
    }
    if (value < 4102444800) {
      return Math.round(value * 1e3);
    }
    return Math.round(value);
  }
  parseSessionSummary(value) {
    if (!value || typeof value !== "object") {
      return null;
    }
    const candidate = value;
    if (typeof candidate.id !== "string" || typeof candidate.startTime !== "number" || typeof candidate.endTime !== "number" || typeof candidate.observationCount !== "number" || typeof candidate.summary !== "string" || !Array.isArray(candidate.keyDecisions) || !Array.isArray(candidate.filesModified)) {
      return null;
    }
    return {
      id: candidate.id,
      startTime: this.normalizeTimestampMs(candidate.startTime),
      endTime: this.normalizeTimestampMs(candidate.endTime),
      observationCount: Math.max(0, Math.trunc(candidate.observationCount)),
      keyDecisions: candidate.keyDecisions.filter(
        (decision) => typeof decision === "string"
      ),
      filesModified: candidate.filesModified.filter(
        (file) => typeof file === "string"
      ),
      summary: candidate.summary
    };
  }
  extractSessionSummary(frame) {
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
  extractSessionId(frame) {
    const tags = Array.isArray(frame?.tags) ? frame.tags.filter((tag) => typeof tag === "string") : [];
    const sessionTag = tags.find((tag) => tag.startsWith("session:"));
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
  extractObservationType(frame) {
    if (Array.isArray(frame?.labels)) {
      for (const value of frame.labels) {
        if (typeof value === "string") {
          const normalized = value.toLowerCase();
          if (OBSERVATION_TYPE_SET.has(normalized)) {
            return normalized;
          }
        }
      }
    }
    const label = typeof frame?.label === "string" ? frame.label : void 0;
    if (label) {
      const normalized = label.toLowerCase();
      if (OBSERVATION_TYPE_SET.has(normalized)) {
        return normalized;
      }
    }
    const metadataType = frame?.metadata?.type;
    if (typeof metadataType === "string") {
      const normalized = metadataType.toLowerCase();
      if (OBSERVATION_TYPE_SET.has(normalized)) {
        return normalized;
      }
    }
    return null;
  }
  extractPreviewFieldValues(preview, field) {
    if (typeof preview !== "string" || preview.length === 0) {
      return [];
    }
    const match = new RegExp(`(?:^|\\n)${field}:\\s*([^\\n]*)`, "i").exec(preview);
    if (!match?.[1]) {
      return [];
    }
    return match[1].split(/[^a-z0-9:_-]+/i).map((value) => value.trim()).filter(Boolean);
  }
  extractObservationTypeFromPreview(preview) {
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
    if (OBSERVATION_TYPE_SET.has(normalized)) {
      return normalized;
    }
    return null;
  }
  parseLeadingJsonObject(text) {
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
  extractSessionSummaryFromSearchHit(hit) {
    if (typeof hit?.text !== "string") {
      return null;
    }
    const parsed = this.parseLeadingJsonObject(hit.text);
    return this.parseSessionSummary(parsed);
  }
  /**
   * Ask the memory a question (uses fast lexical search)
   */
  async ask(question) {
    return this.withLock(async () => {
      const result = await this.memvid.ask(question, { k: 5, mode: "lex" });
      return result.answer || "No relevant memories found.";
    });
  }
  /**
   * Get context for session start
   */
  async getContext(query) {
    return this.withLock(async () => {
      const timeline = await this.memvid.timeline({
        limit: this.config.maxContextObservations,
        reverse: true
      });
      const frames = this.toTimelineFrames(timeline);
      const recentObservations = [];
      const FRAME_INFO_BATCH_SIZE = 20;
      for (let start = 0; start < frames.length; start += FRAME_INFO_BATCH_SIZE) {
        const batch = frames.slice(start, start + FRAME_INFO_BATCH_SIZE);
        const frameInfos = await Promise.all(batch.map(async (frame) => {
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
          const metadata = frameInfo?.metadata && typeof frameInfo.metadata === "object" ? frameInfo.metadata : {};
          const toolTag = tags.find((tag) => typeof tag === "string" && tag.startsWith("tool:"));
          const ts = this.normalizeTimestampMs(frameInfo?.timestamp || frame.timestamp || 0);
          const observationType = this.extractObservationType({
            label: labels[0],
            labels,
            metadata
          }) || "discovery";
          recentObservations.push({
            id: String(metadata.observationId || frame.metadata?.observationId || frame.frame_id),
            timestamp: ts,
            type: observationType,
            tool: typeof toolTag === "string" ? toolTag.replace(/^tool:/, "") : typeof metadata.tool === "string" ? metadata.tool : void 0,
            summary: frameInfo?.title?.replace(/^\[.*?\]\s*/, "") || frame.preview?.slice(0, 100) || "",
            content: frame.preview || "",
            metadata: {
              ...metadata,
              labels,
              tags
            }
          });
        }
      }
      let relevantMemories = [];
      if (query) {
        const searchResults = await this.searchUnlocked(query, 10);
        relevantMemories = searchResults.map((r) => r.observation);
      }
      const summarySearch = await this.memvid.find("Session Summary", {
        k: 20,
        mode: "lex"
      });
      const summaryHits = this.toSearchFrames(summarySearch);
      const seenSessionIds = /* @__PURE__ */ new Set();
      const sessionSummaries = [];
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
      let tokenCount = 0;
      for (const obs of recentObservations) {
        const text = `[${obs.type}] ${obs.summary}`;
        const tokens = estimateTokens(text);
        if (tokenCount + tokens > this.config.maxContextTokens) break;
        tokenCount += tokens;
      }
      return {
        recentObservations,
        relevantMemories,
        sessionSummaries,
        tokenCount
      };
    });
  }
  /**
   * Save a session summary
   */
  async saveSessionSummary(summary) {
    return this.withLock(async () => {
      const endTime = Date.now();
      const sessionSummary = {
        id: this.sessionId,
        startTime: this.sessionStartTime,
        endTime,
        observationCount: this.sessionObservationCount,
        keyDecisions: summary.keyDecisions.slice(0, 20),
        filesModified: summary.filesModified.slice(0, 50),
        summary: summary.summary
      };
      const frameId = await this.memvid.put({
        title: `Session Summary: ${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}`,
        label: "session",
        text: JSON.stringify(sessionSummary, null, 2),
        metadata: {
          ...sessionSummary,
          sessionId: this.sessionId
        },
        tags: ["session", "summary", `session:${this.sessionId}`]
      });
      this.cachedStats = null;
      this.cachedStatsFrameCount = -1;
      return frameId;
    });
  }
  /**
   * Get memory statistics
   */
  async stats() {
    return this.withLock(async () => {
      const stats = await this.memvid.stats();
      const totalFrames = Number(stats.frame_count) || 0;
      if (this.cachedStats && this.cachedStatsFrameCount === totalFrames) {
        return this.cachedStats;
      }
      const timeline = totalFrames > 0 ? await this.memvid.timeline({ limit: totalFrames, reverse: false }) : [];
      const frames = this.toTimelineFrames(timeline);
      const sessionIds = /* @__PURE__ */ new Set();
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
          tags
        });
        if (sessionId) {
          sessionIds.add(sessionId);
        }
        const observationType = this.extractObservationType({
          ...frame,
          label: labels[0],
          labels,
          tags
        }) || this.extractObservationTypeFromPreview(frame.preview);
        if (observationType) {
          topTypes[observationType] += 1;
        }
      }
      const summarySearch = await this.memvid.find("Session Summary", {
        k: 50,
        mode: "lex"
      });
      const summaryHits = this.toSearchFrames(summarySearch);
      for (const hit of summaryHits) {
        const summary = this.extractSessionSummaryFromSearchHit(hit);
        if (summary) {
          sessionIds.add(summary.id);
        }
      }
      const result = {
        totalObservations: totalFrames,
        totalSessions: sessionIds.size,
        oldestMemory,
        newestMemory,
        fileSize: stats.size_bytes || 0,
        topTypes
      };
      this.cachedStats = result;
      this.cachedStatsFrameCount = totalFrames;
      return result;
    });
  }
  /**
   * Get the session ID
   */
  getSessionId() {
    return this.sessionId;
  }
  /**
   * Get the memory file path
   */
  getMemoryPath() {
    return this.memoryPath;
  }
  /**
   * Check if initialized
   */
  isInitialized() {
    return this.initialized;
  }
};
var mindInstance = null;
async function getMind(config) {
  if (!mindInstance) {
    mindInstance = await Mind.open(config);
  }
  return mindInstance;
}
function resetMind() {
  mindInstance = null;
}

// src/platforms/registry.ts
var AdapterRegistry = class {
  adapters = /* @__PURE__ */ new Map();
  register(adapter) {
    this.adapters.set(adapter.platform, adapter);
  }
  resolve(platform) {
    return this.adapters.get(platform) || null;
  }
  listPlatforms() {
    return [...this.adapters.keys()].sort();
  }
};

// src/platforms/events.ts
function createEventId() {
  return generateId();
}

// src/platforms/adapters/create-adapter.ts
var CONTRACT_VERSION = "1.0.0";
function createAdapter(platform) {
  function projectContext(input) {
    return {
      platformProjectId: input.project_id,
      canonicalPath: input.cwd,
      cwd: input.cwd
    };
  }
  return {
    platform,
    contractVersion: CONTRACT_VERSION,
    normalizeSessionStart(input) {
      return {
        eventId: createEventId(),
        eventType: "session_start",
        platform,
        contractVersion: input.contract_version?.trim() || CONTRACT_VERSION,
        sessionId: input.session_id,
        timestamp: Date.now(),
        projectContext: projectContext(input),
        payload: {
          hookEventName: input.hook_event_name,
          permissionMode: input.permission_mode,
          transcriptPath: input.transcript_path
        }
      };
    },
    normalizeToolObservation(input) {
      if (!input.tool_name) return null;
      return {
        eventId: createEventId(),
        eventType: "tool_observation",
        platform,
        contractVersion: input.contract_version?.trim() || CONTRACT_VERSION,
        sessionId: input.session_id,
        timestamp: Date.now(),
        projectContext: projectContext(input),
        payload: {
          toolName: input.tool_name,
          toolInput: input.tool_input,
          toolResponse: input.tool_response
        }
      };
    },
    normalizeSessionStop(input) {
      return {
        eventId: createEventId(),
        eventType: "session_stop",
        platform,
        contractVersion: input.contract_version?.trim() || CONTRACT_VERSION,
        sessionId: input.session_id,
        timestamp: Date.now(),
        projectContext: projectContext(input),
        payload: {
          transcriptPath: input.transcript_path
        }
      };
    }
  };
}

// src/platforms/adapters/claude.ts
var claudeAdapter = createAdapter("claude");

// src/platforms/adapters/opencode.ts
var opencodeAdapter = createAdapter("opencode");

// src/platforms/adapters/example-adapter.ts
var exampleAdapter = createAdapter("example");

// src/platforms/contract.ts
var SUPPORTED_ADAPTER_CONTRACT_MAJOR = 1;
var SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;
function parseContractMajor(version) {
  const match = SEMVER_PATTERN.exec(version.trim());
  if (!match) {
    return null;
  }
  return Number(match[1]);
}
function validateAdapterContractVersion(version, supportedMajor = SUPPORTED_ADAPTER_CONTRACT_MAJOR) {
  const adapterMajor = parseContractMajor(version);
  if (adapterMajor === null) {
    return {
      compatible: false,
      supportedMajor,
      adapterMajor: null,
      reason: "invalid_contract_version"
    };
  }
  if (adapterMajor !== supportedMajor) {
    return {
      compatible: false,
      supportedMajor,
      adapterMajor,
      reason: "incompatible_contract_major"
    };
  }
  return {
    compatible: true,
    supportedMajor,
    adapterMajor
  };
}

// src/platforms/diagnostics.ts
var DIAGNOSTIC_RETENTION_DAYS = 30;
var DAY_MS = 24 * 60 * 60 * 1e3;
var DIAGNOSTIC_FILE_NAME = "platform-diagnostics.json";
var TEST_DIAGNOSTIC_FILE_NAME = `memvid-platform-diagnostics-${process.pid}.json`;
function sanitizeFieldNames(fieldNames) {
  if (!fieldNames || fieldNames.length === 0) {
    return void 0;
  }
  return [...new Set(fieldNames)].slice(0, 20);
}
function resolveDiagnosticStorePath() {
  const explicitPath = process.env.MEMVID_DIAGNOSTIC_PATH?.trim();
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  if (explicitPath) {
    return resolve(projectDir, explicitPath);
  }
  if (process.env.VITEST) {
    return resolve(tmpdir(), TEST_DIAGNOSTIC_FILE_NAME);
  }
  return resolve(projectDir, ".claude", DIAGNOSTIC_FILE_NAME);
}
function isDiagnosticRecord(value) {
  if (!value || typeof value !== "object") {
    return false;
  }
  const record = value;
  return typeof record.diagnosticId === "string" && typeof record.timestamp === "number" && typeof record.platform === "string" && typeof record.errorType === "string" && (record.fieldNames === void 0 || Array.isArray(record.fieldNames) && record.fieldNames.every((name) => typeof name === "string")) && (record.severity === "warning" || record.severity === "error") && record.redacted === true && typeof record.retentionDays === "number" && typeof record.expiresAt === "number";
}
function pruneExpired(records, now = Date.now()) {
  return records.filter((record) => record.expiresAt > now);
}
var DiagnosticPersistence = class {
  filePath;
  constructor(filePath) {
    this.filePath = filePath;
  }
  append(record, now = Date.now()) {
    this.withFileLock(() => {
      const latest = this.loadFromDisk();
      const next = pruneExpired([...latest, record], now);
      this.persist(next);
    });
  }
  list(now = Date.now()) {
    return this.withFileLock(() => {
      const latest = this.loadFromDisk();
      const pruned = pruneExpired(latest, now);
      if (pruned.length !== latest.length) {
        this.persist(pruned);
      }
      return [...pruned];
    });
  }
  loadFromDisk() {
    if (!existsSync(this.filePath)) {
      return [];
    }
    try {
      const raw = readFileSync(this.filePath, "utf-8").trim();
      if (!raw) {
        return [];
      }
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        return [];
      }
      return parsed.filter(isDiagnosticRecord);
    } catch {
      return [];
    }
  }
  withFileLock(fn) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const release = lockfile.lockSync(this.filePath, { realpath: false });
    try {
      return fn();
    } finally {
      release();
    }
  }
  persist(records) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const tmpPath = `${this.filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      writeFileSync(tmpPath, `${JSON.stringify(records, null, 2)}
`, "utf-8");
      try {
        renameSync(tmpPath, this.filePath);
      } catch {
        rmSync(this.filePath, { force: true });
        renameSync(tmpPath, this.filePath);
      }
    } finally {
      rmSync(tmpPath, { force: true });
    }
  }
};
var persistence = null;
var persistenceFilePath = null;
var warnedPathChange = false;
function getDiagnosticPersistence() {
  const resolvedPath = resolveDiagnosticStorePath();
  if (!persistence) {
    persistence = new DiagnosticPersistence(resolvedPath);
    persistenceFilePath = resolvedPath;
    warnedPathChange = false;
    return persistence;
  }
  if (persistenceFilePath && persistenceFilePath !== resolvedPath && !warnedPathChange) {
    warnedPathChange = true;
    console.error(
      `[memvid-mind] Diagnostic store path changed from "${persistenceFilePath}" to "${resolvedPath}" after initialization; continuing with the original path.`
    );
  }
  return persistence;
}
function createRedactedDiagnostic(input) {
  const timestamp = input.now ?? Date.now();
  const diagnostic = {
    diagnosticId: generateId(),
    timestamp,
    platform: input.platform,
    errorType: input.errorType,
    fieldNames: sanitizeFieldNames(input.fieldNames),
    severity: input.severity ?? "warning",
    redacted: true,
    retentionDays: DIAGNOSTIC_RETENTION_DAYS,
    expiresAt: timestamp + DIAGNOSTIC_RETENTION_DAYS * DAY_MS
  };
  try {
    getDiagnosticPersistence().append(diagnostic);
  } catch {
  }
  return diagnostic;
}
function resolveCanonicalProjectPath(context) {
  if (context.canonicalPath) {
    return resolve(context.canonicalPath);
  }
  if (context.cwd) {
    return resolve(context.cwd);
  }
  return void 0;
}
function resolveProjectIdentityKey(context) {
  if (context.platformProjectId && context.platformProjectId.trim().length > 0) {
    return {
      key: context.platformProjectId.trim(),
      source: "platform_project_id",
      canonicalPath: resolveCanonicalProjectPath(context)
    };
  }
  const canonicalPath = resolveCanonicalProjectPath(context);
  if (canonicalPath) {
    return {
      key: canonicalPath,
      source: "canonical_path",
      canonicalPath
    };
  }
  return {
    key: null,
    source: "unresolved"
  };
}

// src/platforms/pipeline.ts
function skipWithDiagnostic(platform, errorType, fieldNames) {
  return {
    skipped: true,
    reason: errorType,
    diagnostic: createRedactedDiagnostic({
      platform,
      errorType,
      fieldNames,
      severity: "warning"
    })
  };
}
function processPlatformEvent(event) {
  const contractValidation = validateAdapterContractVersion(
    event.contractVersion,
    SUPPORTED_ADAPTER_CONTRACT_MAJOR
  );
  if (!contractValidation.compatible) {
    return skipWithDiagnostic(event.platform, contractValidation.reason ?? "incompatible_contract", ["contractVersion"]);
  }
  const identity = resolveProjectIdentityKey(event.projectContext);
  if (!identity.key) {
    return skipWithDiagnostic(event.platform, "missing_project_identity", [
      "platformProjectId",
      "canonicalPath",
      "cwd"
    ]);
  }
  return {
    skipped: false,
    projectIdentityKey: identity.key
  };
}

// src/platforms/index.ts
var defaultRegistry = null;
function getDefaultAdapterRegistry() {
  if (!defaultRegistry) {
    const registry = new AdapterRegistry();
    registry.register(claudeAdapter);
    registry.register(opencodeAdapter);
    defaultRegistry = Object.freeze({
      resolve: (platform) => registry.resolve(platform),
      listPlatforms: () => registry.listPlatforms()
    });
  }
  return defaultRegistry;
}
function resetDefaultAdapterRegistry() {
  defaultRegistry = null;
}

export { DEFAULT_CONFIG, Mind, SUPPORTED_ADAPTER_CONTRACT_MAJOR, classifyObservationType, claudeAdapter, createAdapter, createRedactedDiagnostic, debug, detectPlatform, detectPlatformFromEnv, estimateTokens, exampleAdapter, extractKeyInfo, formatTimestamp, generateId, getDefaultAdapterRegistry, getMind, opencodeAdapter, processPlatformEvent, readStdin, resetDefaultAdapterRegistry, resetMind, resolveMemoryPathPolicy, resolveProjectIdentityKey, safeJsonParse, truncateToTokens, validateAdapterContractVersion, writeOutput };
//# sourceMappingURL=index.js.map
//# sourceMappingURL=index.js.map