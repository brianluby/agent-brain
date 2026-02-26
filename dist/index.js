import { readdirSync, unlinkSync, existsSync } from 'fs';
import { dirname, isAbsolute, resolve, relative, sep } from 'path';
import { mkdir, open } from 'fs/promises';
import { randomBytes } from 'crypto';
import lockfile from 'proper-lockfile';

// src/core/mind.ts

// src/types.ts
var DEFAULT_CONFIG = {
  memoryPath: ".claude/mind.mv2",
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
  return new Promise((resolve4, reject) => {
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve4(Buffer.concat(chunks).toString("utf8")));
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
  const safePlatform = platform.replace(/[^a-z0-9_-]/gi, "-");
  return `.claude/mind-${safePlatform}.mv2`;
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
  if (input.platformOptIn) {
    const relativePath = input.platformRelativePath || defaultPlatformRelativePath(input.platform);
    return {
      mode: "platform_opt_in",
      memoryPath: resolveInsideProject(input.projectDir, relativePath)
    };
  }
  return {
    mode: "legacy_first",
    memoryPath: resolveInsideProject(input.projectDir, input.legacyRelativePath)
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
var Mind = class _Mind {
  memvid;
  config;
  memoryPath;
  sessionId;
  initialized = false;
  constructor(memvid, config, memoryPath) {
    this.memvid = memvid;
    this.config = config;
    this.memoryPath = memoryPath;
    this.sessionId = generateId();
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
    const pathPolicy = resolveMemoryPathPolicy({
      projectDir,
      platform,
      legacyRelativePath: config.memoryPath,
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
      const { statSync, renameSync, unlinkSync: unlinkSync2 } = await import('fs');
      const fileSize = statSync(memoryPath).size;
      const fileSizeMB = fileSize / (1024 * 1024);
      if (fileSizeMB > MAX_FILE_SIZE_MB) {
        console.error(`[memvid-mind] Memory file too large (${fileSizeMB.toFixed(1)}MB), likely corrupted. Creating fresh memory...`);
        const backupPath = `${memoryPath}.backup-${Date.now()}`;
        try {
          renameSync(memoryPath, backupPath);
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
            renameSync(memoryPath, backupPath);
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
        tags: [observation.type, observation.tool].filter(Boolean)
      });
    });
    if (this.config.debug) {
      console.error(`[memvid-mind] Remembered: ${observation.summary}`);
    }
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
    return (results.frames || []).map((frame) => ({
      observation: {
        id: frame.metadata?.observationId || frame.frame_id,
        timestamp: frame.metadata?.timestamp || 0,
        type: frame.label,
        tool: frame.metadata?.tool,
        summary: frame.title?.replace(/^\[.*?\]\s*/, "") || "",
        content: frame.text || "",
        metadata: frame.metadata
      },
      score: frame.score || 0,
      snippet: frame.snippet || frame.text?.slice(0, 200) || ""
    }));
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
      const frames = Array.isArray(timeline) ? timeline : timeline.frames || [];
      const recentObservations = frames.map(
        (frame) => {
          let ts = frame.metadata?.timestamp || frame.timestamp || 0;
          if (ts > 0 && ts < 4102444800) {
            ts = ts * 1e3;
          }
          return {
            id: frame.metadata?.observationId || frame.frame_id,
            timestamp: ts,
            type: frame.label || frame.metadata?.type || "observation",
            tool: frame.metadata?.tool,
            summary: frame.title?.replace(/^\[.*?\]\s*/, "") || frame.preview?.slice(0, 100) || "",
            content: frame.text || frame.preview || "",
            metadata: frame.metadata
          };
        }
      );
      let relevantMemories = [];
      if (query) {
        const searchResults = await this.searchUnlocked(query, 10);
        relevantMemories = searchResults.map((r) => r.observation);
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
        sessionSummaries: [],
        // TODO: Implement session summaries
        tokenCount
      };
    });
  }
  /**
   * Save a session summary
   */
  async saveSessionSummary(summary) {
    const sessionSummary = {
      id: this.sessionId,
      startTime: Date.now() - 36e5,
      // Approximate
      endTime: Date.now(),
      observationCount: 0,
      // TODO: Track this
      keyDecisions: summary.keyDecisions,
      filesModified: summary.filesModified,
      summary: summary.summary
    };
    return this.withLock(async () => {
      return this.memvid.put({
        title: `Session Summary: ${(/* @__PURE__ */ new Date()).toISOString().split("T")[0]}`,
        label: "session",
        text: JSON.stringify(sessionSummary, null, 2),
        metadata: sessionSummary,
        tags: ["session", "summary"]
      });
    });
  }
  /**
   * Get memory statistics
   */
  async stats() {
    return this.withLock(async () => {
      const stats = await this.memvid.stats();
      const timeline = await this.memvid.timeline({ limit: 1, reverse: false });
      const recentTimeline = await this.memvid.timeline({ limit: 1, reverse: true });
      const oldestFrames = Array.isArray(timeline) ? timeline : timeline.frames || [];
      const newestFrames = Array.isArray(recentTimeline) ? recentTimeline : recentTimeline.frames || [];
      return {
        totalObservations: stats.frame_count || 0,
        totalSessions: 0,
        // TODO: Count unique sessions
        oldestMemory: oldestFrames[0]?.metadata?.timestamp || oldestFrames[0]?.timestamp || 0,
        newestMemory: newestFrames[0]?.metadata?.timestamp || newestFrames[0]?.timestamp || 0,
        fileSize: stats.size_bytes || 0,
        topTypes: {}
        // TODO: Aggregate
      };
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

// src/platforms/diagnostic-store.ts
var DAY_MS = 24 * 60 * 60 * 1e3;
function sanitizeFieldNames(fieldNames) {
  if (!fieldNames || fieldNames.length === 0) {
    return void 0;
  }
  return [...new Set(fieldNames)].slice(0, 20);
}
function createRedactedDiagnostic(input) {
  const timestamp = input.now ?? Date.now();
  return {
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