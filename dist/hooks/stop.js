#!/usr/bin/env node
import { constants, readdirSync, unlinkSync, existsSync } from 'fs';
import { dirname, resolve } from 'path';
import { access, readFile, mkdir, open } from 'fs/promises';
import { randomBytes } from 'crypto';
import lockfile from 'proper-lockfile';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

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
  return `.claude/mind-${platform}.mv2`;
}
function resolveMemoryPathPolicy(input) {
  if (input.platformOptIn) {
    const relative = input.platformRelativePath || defaultPlatformRelativePath(input.platform);
    return {
      mode: "platform_opt_in",
      memoryPath: resolve(input.projectDir, relative)
    };
  }
  return {
    mode: "legacy_first",
    memoryPath: resolve(input.projectDir, input.legacyRelativePath)
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
  if (process.env.OPENCODE === "1" || process.env.OPENCODE_SESSION === "1") {
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
        contractVersion: input.contract_version || CONTRACT_VERSION,
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
        contractVersion: input.contract_version || CONTRACT_VERSION,
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
        contractVersion: input.contract_version || CONTRACT_VERSION,
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
    return skipWithDiagnostic(event.platform, "incompatible_contract_major", ["contractVersion"]);
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
    defaultRegistry = new AdapterRegistry();
    defaultRegistry.register(claudeAdapter);
    defaultRegistry.register(opencodeAdapter);
  }
  return defaultRegistry;
}
var MIN_OBSERVATIONS_FOR_SUMMARY = 3;
async function captureFileChanges(mind) {
  try {
    const memoryPath = mind.getMemoryPath();
    const workDir = memoryPath.replace(/\/\.claude\/.*$/, "");
    const allChangedFiles = [];
    let gitDiffContent = "";
    try {
      const diffNames = execSync("git diff --name-only HEAD 2>/dev/null || git diff --name-only 2>/dev/null || echo ''", {
        cwd: workDir,
        encoding: "utf-8",
        timeout: 3e3,
        stdio: ["pipe", "pipe", "pipe"]
      }).trim();
      const stagedNames = execSync("git diff --cached --name-only 2>/dev/null || echo ''", {
        cwd: workDir,
        encoding: "utf-8",
        timeout: 3e3,
        stdio: ["pipe", "pipe", "pipe"]
      }).trim();
      const gitFiles = [.../* @__PURE__ */ new Set([
        ...diffNames.split("\n").filter(Boolean),
        ...stagedNames.split("\n").filter(Boolean)
      ])];
      allChangedFiles.push(...gitFiles);
      if (gitFiles.length > 0) {
        try {
          gitDiffContent = execSync("git diff HEAD --stat 2>/dev/null | head -30", {
            cwd: workDir,
            encoding: "utf-8",
            timeout: 3e3,
            stdio: ["pipe", "pipe", "pipe"]
          }).trim();
        } catch {
        }
      }
    } catch {
    }
    try {
      const recentFiles = execSync(
        `find . -maxdepth 4 -type f \\( -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.md" -o -name "*.json" -o -name "*.py" -o -name "*.rs" \\) -mmin -30 ! -path "*/node_modules/*" ! -path "*/.git/*" ! -path "*/dist/*" ! -path "*/build/*" ! -path "*/.next/*" ! -path "*/target/*" 2>/dev/null | head -30`,
        {
          cwd: workDir,
          encoding: "utf-8",
          timeout: 5e3,
          stdio: ["pipe", "pipe", "pipe"]
        }
      ).trim();
      const recentFilesList = recentFiles.split("\n").filter(Boolean).map((f) => f.replace(/^\.\//, ""));
      for (const file of recentFilesList) {
        if (!allChangedFiles.includes(file)) {
          allChangedFiles.push(file);
        }
      }
    } catch {
    }
    if (allChangedFiles.length === 0) {
      debug("No file changes detected");
      return;
    }
    debug(`Capturing ${allChangedFiles.length} changed files`);
    const contentParts = [`## Files Modified This Session

${allChangedFiles.map((f) => `- ${f}`).join("\n")}`];
    if (gitDiffContent) {
      contentParts.push(`
## Git Changes Summary
\`\`\`
${gitDiffContent}
\`\`\``);
    }
    await mind.remember({
      type: "refactor",
      summary: `Session edits: ${allChangedFiles.length} file(s) modified`,
      content: contentParts.join("\n"),
      tool: "FileChanges",
      metadata: {
        files: allChangedFiles,
        fileCount: allChangedFiles.length,
        captureMethod: "git-diff-plus-recent"
      }
    });
    for (const file of allChangedFiles) {
      const fileName = file.split("/").pop() || file;
      const isImportant = /^(README|CHANGELOG|package\.json|Cargo\.toml|\.env)/i.test(fileName);
      if (isImportant) {
        await mind.remember({
          type: "refactor",
          summary: `Modified ${fileName}`,
          content: `File edited: ${file}
This file was modified during the session.`,
          tool: "FileEdit",
          metadata: {
            files: [file],
            fileName
          }
        });
        debug(`Stored individual edit: ${fileName}`);
      }
    }
    debug(`Stored file changes: ${allChangedFiles.length} files`);
  } catch (error) {
    debug(`Failed to capture file changes: ${error}`);
  }
}
async function runStopHook() {
  try {
    const input = await readStdin();
    const hookInput = JSON.parse(input);
    debug(`Session stopping: ${hookInput.session_id}`);
    const platform = detectPlatform(hookInput);
    const adapter = getDefaultAdapterRegistry().resolve(platform);
    if (!adapter) {
      debug(`Unsupported platform at stop hook: ${platform}`);
      writeOutput({ continue: true });
      return;
    }
    const normalizedStop = adapter.normalizeSessionStop(hookInput);
    const pipelineResult = processPlatformEvent(normalizedStop);
    if (pipelineResult.skipped) {
      debug(`Skipping stop processing: ${pipelineResult.reason}`);
      writeOutput({ continue: true });
      return;
    }
    const mind = await getMind();
    const stats = await mind.stats();
    await captureFileChanges(mind);
    let transcriptContent = "";
    if (hookInput.transcript_path) {
      try {
        await access(hookInput.transcript_path, constants.R_OK);
        transcriptContent = await readFile(hookInput.transcript_path, "utf-8");
      } catch {
      }
    }
    const context = await mind.getContext();
    const sessionObservations = context.recentObservations.filter(
      (obs) => obs.metadata?.sessionId === mind.getSessionId()
    );
    if (sessionObservations.length >= MIN_OBSERVATIONS_FOR_SUMMARY) {
      const summary = generateSessionSummary(
        sessionObservations,
        transcriptContent
      );
      await mind.saveSessionSummary(summary);
      debug(
        `Session summary saved: ${summary.keyDecisions.length} decisions, ${summary.filesModified.length} files`
      );
    }
    debug(
      `Session complete. Total memories: ${stats.totalObservations}, File: ${mind.getMemoryPath()}`
    );
    const output = {
      continue: true
    };
    writeOutput(output);
  } catch (error) {
    debug(`Error: ${error}`);
    writeOutput({ continue: true });
  }
}
function generateSessionSummary(observations, transcript) {
  const keyDecisions = [];
  const filesModified = /* @__PURE__ */ new Set();
  for (const obs of observations) {
    if (obs.type === "decision" || obs.summary.toLowerCase().includes("chose") || obs.summary.toLowerCase().includes("decided")) {
      keyDecisions.push(obs.summary);
    }
    const files = obs.metadata?.files;
    if (files) {
      files.forEach((f) => filesModified.add(f));
    }
  }
  if (transcript) {
    const filePatterns = [
      /(?:Read|Edit|Write)[^"]*"([^"]+)"/g,
      /file_path["\s:]+([^\s"]+)/g
    ];
    for (const pattern of filePatterns) {
      let match;
      while ((match = pattern.exec(transcript)) !== null) {
        const path = match[1];
        if (path && !path.includes("node_modules") && !path.startsWith(".")) {
          filesModified.add(path);
        }
      }
    }
  }
  const typeCounts = {};
  for (const obs of observations) {
    typeCounts[obs.type] = (typeCounts[obs.type] || 0) + 1;
  }
  const summaryParts = [];
  if (typeCounts.feature) {
    summaryParts.push(`Added ${typeCounts.feature} feature(s)`);
  }
  if (typeCounts.bugfix) {
    summaryParts.push(`Fixed ${typeCounts.bugfix} bug(s)`);
  }
  if (typeCounts.refactor) {
    summaryParts.push(`Refactored ${typeCounts.refactor} item(s)`);
  }
  if (typeCounts.discovery) {
    summaryParts.push(`Made ${typeCounts.discovery} discovery(ies)`);
  }
  if (typeCounts.problem) {
    summaryParts.push(`Encountered ${typeCounts.problem} problem(s)`);
  }
  if (typeCounts.solution) {
    summaryParts.push(`Found ${typeCounts.solution} solution(s)`);
  }
  const summary = summaryParts.length > 0 ? summaryParts.join(". ") + "." : `Session with ${observations.length} observations.`;
  return {
    keyDecisions: keyDecisions.slice(0, 10),
    filesModified: Array.from(filesModified).slice(0, 20),
    summary
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runStopHook();
}

export { runStopHook };
//# sourceMappingURL=stop.js.map
//# sourceMappingURL=stop.js.map