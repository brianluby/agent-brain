#!/usr/bin/env node
import { existsSync, readdirSync, unlinkSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'fs';
import { dirname, resolve, isAbsolute, relative, sep } from 'path';
import { mkdir, open } from 'fs/promises';
import { randomBytes } from 'crypto';
import lockfile from 'proper-lockfile';
import { tmpdir } from 'os';
import { fileURLToPath } from 'url';

// src/types.ts
var DEFAULT_CONFIG = {
  memoryPath: ".agent-brain/mind.mv2",
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
  const safePlatform = platform.replace(/[^a-z0-9_-]/gi, "-");
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
    const projectDir = process.env.CLAUDE_PROJECT_DIR || process.cwd();
    const platform = detectPlatformFromEnv();
    const optIn = process.env.MEMVID_PLATFORM_PATH_OPT_IN === "1";
    const legacyFallbacks = config.memoryPath === ".agent-brain/mind.mv2" ? [".claude/mind.mv2"] : [];
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
      const recentObservations2 = [];
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
          recentObservations2.push({
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
      for (const obs of recentObservations2) {
        const text = `[${obs.type}] ${obs.summary}`;
        const tokens = estimateTokens(text);
        if (tokenCount + tokens > this.config.maxContextTokens) break;
        tokenCount += tokens;
      }
      return {
        recentObservations: recentObservations2,
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

// src/utils/compression.ts
var TARGET_COMPRESSED_SIZE = 2e3;
var COMPRESSION_THRESHOLD = 3e3;
function compressToolOutput(toolName, toolInput, output) {
  const originalSize = output.length;
  if (originalSize <= COMPRESSION_THRESHOLD) {
    return { compressed: output, wasCompressed: false, originalSize };
  }
  let compressed;
  switch (toolName) {
    case "Read":
      compressed = compressFileRead(toolInput, output);
      break;
    case "Bash":
      compressed = compressBashOutput(toolInput, output);
      break;
    case "Grep":
      compressed = compressGrepOutput(toolInput, output);
      break;
    case "Glob":
      compressed = compressGlobOutput(toolInput, output);
      break;
    case "Edit":
    case "Write":
      compressed = compressEditOutput(toolInput, output);
      break;
    default:
      compressed = compressGeneric(output);
  }
  return {
    compressed: truncateToTarget(compressed),
    wasCompressed: true,
    originalSize
  };
}
function compressFileRead(toolInput, output) {
  const filePath = toolInput?.file_path || "unknown";
  const fileName = filePath.split("/").pop() || "file";
  const lines = output.split("\n");
  const totalLines = lines.length;
  const imports = extractImports(output);
  const exports$1 = extractExports(output);
  const functions = extractFunctionSignatures(output);
  const classes = extractClassNames(output);
  const errors = extractErrorPatterns(output);
  const parts = [
    `\u{1F4C4} File: ${fileName} (${totalLines} lines)`
  ];
  if (imports.length > 0) {
    parts.push(`
\u{1F4E6} Imports: ${imports.slice(0, 10).join(", ")}${imports.length > 10 ? ` (+${imports.length - 10} more)` : ""}`);
  }
  if (exports$1.length > 0) {
    parts.push(`
\u{1F4E4} Exports: ${exports$1.slice(0, 10).join(", ")}${exports$1.length > 10 ? ` (+${exports$1.length - 10} more)` : ""}`);
  }
  if (functions.length > 0) {
    parts.push(`
\u26A1 Functions: ${functions.slice(0, 10).join(", ")}${functions.length > 10 ? ` (+${functions.length - 10} more)` : ""}`);
  }
  if (classes.length > 0) {
    parts.push(`
\u{1F3D7}\uFE0F Classes: ${classes.join(", ")}`);
  }
  if (errors.length > 0) {
    parts.push(`
\u26A0\uFE0F Errors/TODOs: ${errors.slice(0, 5).join("; ")}`);
  }
  const contextLines = [
    "\n--- First 10 lines ---",
    ...lines.slice(0, 10),
    "\n--- Last 5 lines ---",
    ...lines.slice(-5)
  ];
  parts.push(contextLines.join("\n"));
  return parts.join("");
}
function compressBashOutput(toolInput, output) {
  const command = toolInput?.command || "command";
  const shortCmd = command.split("\n")[0].slice(0, 100);
  const lines = output.split("\n");
  const errorLines = lines.filter(
    (l) => l.toLowerCase().includes("error") || l.toLowerCase().includes("failed") || l.toLowerCase().includes("exception") || l.toLowerCase().includes("warning")
  );
  const successLines = lines.filter(
    (l) => l.toLowerCase().includes("success") || l.toLowerCase().includes("passed") || l.toLowerCase().includes("completed") || l.toLowerCase().includes("done")
  );
  const parts = [`\u{1F5A5}\uFE0F Command: ${shortCmd}`];
  if (errorLines.length > 0) {
    parts.push(`
\u274C Errors (${errorLines.length}):`);
    parts.push(errorLines.slice(0, 10).join("\n"));
  }
  if (successLines.length > 0) {
    parts.push(`
\u2705 Success indicators:`);
    parts.push(successLines.slice(0, 5).join("\n"));
  }
  parts.push(`
\u{1F4CA} Output: ${lines.length} lines total`);
  if (lines.length > 20) {
    parts.push("\n--- First 10 lines ---");
    parts.push(lines.slice(0, 10).join("\n"));
    parts.push("\n--- Last 5 lines ---");
    parts.push(lines.slice(-5).join("\n"));
  } else {
    parts.push("\n--- Full output ---");
    parts.push(lines.join("\n"));
  }
  return parts.join("");
}
function compressGrepOutput(toolInput, output) {
  const pattern = toolInput?.pattern || "pattern";
  const lines = output.split("\n").filter(Boolean);
  const files = /* @__PURE__ */ new Set();
  lines.forEach((line) => {
    const match = line.match(/^([^:]+):/);
    if (match) files.add(match[1]);
  });
  const parts = [
    `\u{1F50D} Grep: "${pattern.slice(0, 50)}"`,
    `\u{1F4C1} Found in ${files.size} files, ${lines.length} matches`
  ];
  if (files.size > 0) {
    parts.push(`
\u{1F4C2} Files: ${Array.from(files).slice(0, 15).join(", ")}${files.size > 15 ? ` (+${files.size - 15} more)` : ""}`);
  }
  parts.push("\n--- Top matches ---");
  parts.push(lines.slice(0, 10).join("\n"));
  if (lines.length > 10) {
    parts.push(`
... and ${lines.length - 10} more matches`);
  }
  return parts.join("");
}
function compressGlobOutput(toolInput, output) {
  const pattern = toolInput?.pattern || "pattern";
  let files = [];
  try {
    const parsed = JSON.parse(output);
    files = parsed.filenames || [];
  } catch {
    files = output.split("\n").filter(Boolean);
  }
  const byDir = {};
  files.forEach((f) => {
    const dir = f.split("/").slice(0, -1).join("/") || "/";
    const file = f.split("/").pop() || f;
    if (!byDir[dir]) byDir[dir] = [];
    byDir[dir].push(file);
  });
  const parts = [
    `\u{1F4C2} Glob: "${pattern.slice(0, 50)}"`,
    `\u{1F4C1} Found ${files.length} files in ${Object.keys(byDir).length} directories`
  ];
  const topDirs = Object.entries(byDir).sort((a, b) => b[1].length - a[1].length).slice(0, 5);
  parts.push("\n--- Top directories ---");
  topDirs.forEach(([dir, dirFiles]) => {
    const shortDir = dir.split("/").slice(-3).join("/");
    parts.push(`${shortDir}/ (${dirFiles.length} files)`);
  });
  parts.push("\n--- Sample files ---");
  parts.push(files.slice(0, 15).map((f) => f.split("/").pop()).join(", "));
  return parts.join("");
}
function compressEditOutput(toolInput, output) {
  const filePath = toolInput?.file_path || "unknown";
  const fileName = filePath.split("/").pop() || "file";
  return [
    `\u270F\uFE0F Edited: ${fileName}`,
    `\u{1F4DD} Changes applied successfully`,
    output.slice(0, 500)
  ].join("\n");
}
function compressGeneric(output) {
  const lines = output.split("\n");
  if (lines.length <= 30) {
    return output;
  }
  return [
    `\u{1F4CA} Output: ${lines.length} lines`,
    "--- First 15 lines ---",
    ...lines.slice(0, 15),
    "--- Last 10 lines ---",
    ...lines.slice(-10)
  ].join("\n");
}
function extractImports(code) {
  const imports = [];
  const patterns = [
    /import\s+(?:{\s*([^}]+)\s*}|(\w+))\s+from\s+['"]([^'"]+)['"]/g,
    /from\s+['"]([^'"]+)['"]\s+import/g,
    /require\s*\(['"]([^'"]+)['"]\)/g,
    /use\s+(\w+(?:::\w+)*)/g
  ];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      imports.push(match[3] || match[1] || match[2] || match[0]);
    }
  });
  return [...new Set(imports)];
}
function extractExports(code) {
  const exports$1 = [];
  const patterns = [
    /export\s+(?:default\s+)?(?:function|class|const|let|var)\s+(\w+)/g,
    /export\s*{\s*([^}]+)\s*}/g,
    /pub\s+(?:fn|struct|enum|trait|mod)\s+(\w+)/g
  ];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      const names = (match[1] || "").split(",").map((s) => s.trim());
      exports$1.push(...names.filter(Boolean));
    }
  });
  return [...new Set(exports$1)];
}
function extractFunctionSignatures(code) {
  const functions = [];
  const patterns = [
    /(?:async\s+)?function\s+(\w+)/g,
    /(\w+)\s*:\s*(?:async\s+)?\([^)]*\)\s*=>/g,
    /(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*=>/g,
    /fn\s+(\w+)/g,
    /def\s+(\w+)/g
  ];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      functions.push(match[1]);
    }
  });
  return [...new Set(functions)];
}
function extractClassNames(code) {
  const classes = [];
  const patterns = [
    /class\s+(\w+)/g,
    /struct\s+(\w+)/g,
    /interface\s+(\w+)/g,
    /type\s+(\w+)\s*=/g
  ];
  patterns.forEach((pattern) => {
    let match;
    while ((match = pattern.exec(code)) !== null) {
      classes.push(match[1]);
    }
  });
  return [...new Set(classes)];
}
function extractErrorPatterns(code) {
  const errors = [];
  const lines = code.split("\n");
  lines.forEach((line) => {
    if (line.includes("TODO") || line.includes("FIXME") || line.includes("HACK") || line.includes("XXX") || line.includes("BUG")) {
      errors.push(line.trim().slice(0, 100));
    }
  });
  return errors.slice(0, 10);
}
function truncateToTarget(text) {
  if (text.length <= TARGET_COMPRESSED_SIZE) {
    return text;
  }
  return text.slice(0, TARGET_COMPRESSED_SIZE - 20) + "\n... (compressed)";
}
function getCompressionStats(originalSize, compressedSize) {
  const saved = originalSize - compressedSize;
  const ratio = originalSize / compressedSize;
  const savedPercent = (saved / originalSize * 100).toFixed(1);
  return { ratio, saved, savedPercent };
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
var OBSERVED_TOOLS = /* @__PURE__ */ new Set([
  "Read",
  "Edit",
  "Write",
  "Update",
  "Bash",
  "Grep",
  "Glob",
  "WebFetch",
  "WebSearch",
  "Task",
  "NotebookEdit"
]);
var MIN_OUTPUT_LENGTH = 50;
var DEDUP_WINDOW_MS = 6e4;
var ALWAYS_CAPTURE_TOOLS = /* @__PURE__ */ new Set(["Edit", "Write", "Update", "NotebookEdit"]);
var MAX_OUTPUT_LENGTH = 2500;
var recentObservations = /* @__PURE__ */ new Map();
function getObservationKey(toolName, toolInput) {
  const inputStr = toolInput ? JSON.stringify(toolInput).slice(0, 200) : "";
  return `${toolName}:${inputStr}`;
}
function isDuplicate(key) {
  const lastSeen = recentObservations.get(key);
  if (!lastSeen) return false;
  return Date.now() - lastSeen < DEDUP_WINDOW_MS;
}
function markObserved(key) {
  recentObservations.set(key, Date.now());
  if (recentObservations.size > 100) {
    const now = Date.now();
    for (const [k, v] of recentObservations.entries()) {
      if (now - v > DEDUP_WINDOW_MS * 2) {
        recentObservations.delete(k);
      }
    }
  }
}
function generateSummary(toolName, toolInput, toolOutput) {
  switch (toolName) {
    case "Read": {
      const path = toolInput?.file_path || toolInput?.filePath;
      const fileName = path?.split("/").pop() || "file";
      const lines = toolOutput.split("\n").length;
      return `Read ${fileName} (${lines} lines)`;
    }
    case "Edit":
    case "Update": {
      const path = toolInput?.file_path || toolInput?.filePath;
      const fileName = path?.split("/").pop() || "file";
      return `Edited ${fileName}`;
    }
    case "Write": {
      const path = toolInput?.file_path || toolInput?.filePath;
      const fileName = path?.split("/").pop() || "file";
      return `Created ${fileName}`;
    }
    case "Bash": {
      const cmd = toolInput?.command;
      const shortCmd = cmd?.split("\n")[0].slice(0, 50) || "command";
      const hasError = toolOutput.toLowerCase().includes("error") || toolOutput.toLowerCase().includes("failed");
      return hasError ? `Command failed: ${shortCmd}` : `Ran: ${shortCmd}`;
    }
    case "Grep": {
      const pattern = toolInput?.pattern;
      const matches = toolOutput.split("\n").filter(Boolean).length;
      return `Found ${matches} matches for "${pattern?.slice(0, 30)}"`;
    }
    case "Glob": {
      const pattern = toolInput?.pattern;
      const matches = toolOutput.split("\n").filter(Boolean).length;
      return `Found ${matches} files matching "${pattern?.slice(0, 30)}"`;
    }
    case "WebFetch":
    case "WebSearch": {
      const url = toolInput?.url || toolInput?.query;
      return `Fetched: ${url?.slice(0, 50)}`;
    }
    default:
      return `${toolName} completed`;
  }
}
function extractMetadata(toolName, toolInput, platform, projectIdentityKey) {
  const metadata = {
    platform,
    projectIdentityKey
  };
  if (!toolInput) return metadata;
  switch (toolName) {
    case "Read":
    case "Edit":
    case "Write":
    case "Update": {
      const filePath = toolInput.file_path || toolInput.filePath;
      if (filePath) {
        metadata.files = [filePath];
      }
      break;
    }
    case "Bash":
      if (toolInput.command) {
        metadata.command = toolInput.command.slice(0, 200);
      }
      break;
    case "Grep":
    case "Glob":
      if (toolInput.pattern) {
        metadata.pattern = toolInput.pattern;
      }
      if (toolInput.path) {
        metadata.searchPath = toolInput.path;
      }
      break;
  }
  return metadata;
}
async function runPostToolUseHook() {
  try {
    const input = await readStdin();
    const hookInput = JSON.parse(input);
    const platform = detectPlatform(hookInput);
    const adapter = getDefaultAdapterRegistry().resolve(platform);
    if (!adapter) {
      debug(`Skipping capture: unsupported platform ${platform}`);
      writeOutput({ continue: true });
      return;
    }
    const normalized = adapter.normalizeToolObservation(hookInput);
    if (!normalized) {
      writeOutput({ continue: true });
      return;
    }
    const pipelineResult = processPlatformEvent(normalized);
    if (pipelineResult.skipped || !pipelineResult.projectIdentityKey) {
      debug(`Skipping event due to pipeline result: ${pipelineResult.reason}`);
      writeOutput({ continue: true });
      return;
    }
    const { toolName, toolInput, toolResponse } = normalized.payload;
    if (!toolName || !OBSERVED_TOOLS.has(toolName)) {
      writeOutput({ continue: true });
      return;
    }
    const dedupKey = getObservationKey(toolName, toolInput);
    if (isDuplicate(dedupKey)) {
      debug(`Skipping duplicate observation: ${toolName}`);
      writeOutput({ continue: true });
      return;
    }
    const rawOutput = typeof toolResponse === "string" ? toolResponse : JSON.stringify(toolResponse, null, 2);
    const alwaysCapture = ALWAYS_CAPTURE_TOOLS.has(toolName);
    if (!alwaysCapture && (!rawOutput || rawOutput.length < MIN_OUTPUT_LENGTH)) {
      writeOutput({ continue: true });
      return;
    }
    let effectiveOutput = rawOutput || "";
    if (alwaysCapture && effectiveOutput.length < MIN_OUTPUT_LENGTH) {
      const filePath = toolInput?.file_path || toolInput?.filePath || "unknown file";
      const fileName = filePath.split("/").pop() || "file";
      effectiveOutput = `File modified: ${fileName}
Path: ${filePath}
Tool: ${toolName}`;
    }
    if (effectiveOutput.includes("<system-reminder>") || effectiveOutput.includes("<memvid-mind-context>")) {
      writeOutput({ continue: true });
      return;
    }
    const { compressed, wasCompressed, originalSize } = compressToolOutput(
      toolName,
      toolInput,
      effectiveOutput
    );
    if (wasCompressed) {
      const stats = getCompressionStats(originalSize, compressed.length);
      debug(`Compression: ${stats.savedPercent}% (${originalSize} -> ${compressed.length})`);
    }
    const mind = await getMind();
    const observationType = classifyObservationType(toolName, compressed);
    const summary = generateSummary(toolName, toolInput, effectiveOutput);
    const content = compressed.length > MAX_OUTPUT_LENGTH ? `${compressed.slice(0, MAX_OUTPUT_LENGTH)}
... (truncated${wasCompressed ? ", compressed" : ""})` : compressed;
    const metadata = extractMetadata(
      toolName,
      toolInput,
      platform,
      pipelineResult.projectIdentityKey
    );
    if (wasCompressed) {
      metadata.compressed = true;
      metadata.originalSize = originalSize;
      metadata.compressedSize = compressed.length;
    }
    await mind.remember({
      type: observationType,
      summary,
      content,
      tool: toolName,
      metadata
    });
    markObserved(dedupKey);
    writeOutput({ continue: true });
  } catch (error) {
    debug(`Error: ${error}`);
    writeOutput({ continue: true });
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runPostToolUseHook();
}

export { runPostToolUseHook };
//# sourceMappingURL=post-tool-use.js.map
//# sourceMappingURL=post-tool-use.js.map