#!/usr/bin/env node
import { randomBytes } from 'crypto';
import { existsSync, statSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from 'fs';
import { basename, relative, dirname, isAbsolute, resolve, sep } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import lockfile from 'proper-lockfile';

function generateId() {
  return randomBytes(8).toString("hex");
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

// src/hooks/session-start.ts
function buildContextLines(projectName, memoryDisplayPath, memoryExists, fileSizeKB, platform, warning, migrationPrompt) {
  const contextLines = [];
  contextLines.push("<memvid-mind-context>");
  const displayName = platform === "claude" ? "Claude" : platform.charAt(0).toUpperCase() + platform.slice(1);
  contextLines.push(memoryExists ? `# \u{1F9E0} ${displayName} Mind Active` : `# \u{1F9E0} ${displayName} Mind Ready`);
  contextLines.push("");
  contextLines.push(`\u{1F4C1} Project: **${projectName}**`);
  contextLines.push(`\u{1F916} Platform: **${platform}**`);
  if (memoryExists) {
    contextLines.push(`\u{1F4BE} Memory: \`${memoryDisplayPath}\` (${fileSizeKB} KB)`);
  } else {
    contextLines.push(`\u{1F4BE} Memory will be created at: \`${memoryDisplayPath}\``);
  }
  if (warning) {
    contextLines.push("");
    contextLines.push(`\u26A0\uFE0F ${warning}`);
  }
  if (migrationPrompt) {
    contextLines.push("");
    contextLines.push("\u2753 Legacy memory detected.");
    contextLines.push(`Move it to the platform-agnostic path? Run: \`${migrationPrompt}\``);
  }
  contextLines.push("");
  contextLines.push("**Commands:**");
  contextLines.push("- `/mind:search <query>` - Search memories");
  contextLines.push("- `/mind:ask <question>` - Ask your memory");
  contextLines.push("- `/mind:recent` - View timeline");
  contextLines.push("- `/mind:stats` - View statistics");
  contextLines.push("");
  contextLines.push("_Memories are captured automatically from your tool use._");
  contextLines.push("</memvid-mind-context>");
  return contextLines;
}
function buildSessionStartOutput(hookInput) {
  const projectDir = hookInput.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const projectName = basename(projectDir);
  const platform = detectPlatform(hookInput);
  const pathPolicy = resolveMemoryPathPolicy({
    projectDir,
    platform,
    defaultRelativePath: ".agent-brain/mind.mv2",
    legacyRelativePaths: [".claude/mind.mv2"],
    platformRelativePath: process.env.MEMVID_PLATFORM_MEMORY_PATH,
    platformOptIn: process.env.MEMVID_PLATFORM_PATH_OPT_IN === "1"
  });
  const memoryExists = existsSync(pathPolicy.memoryPath);
  let fileSizeKB = 0;
  if (memoryExists) {
    try {
      fileSizeKB = Math.round(statSync(pathPolicy.memoryPath).size / 1024);
    } catch {
      fileSizeKB = 0;
    }
  }
  const registry = getDefaultAdapterRegistry();
  const adapter = registry.resolve(platform);
  let warning;
  let migrationPrompt;
  if (pathPolicy.migrationSuggestion) {
    const fromDisplay = relative(projectDir, pathPolicy.migrationSuggestion.fromPath) || basename(pathPolicy.migrationSuggestion.fromPath);
    const toDisplay = relative(projectDir, pathPolicy.migrationSuggestion.toPath) || basename(pathPolicy.migrationSuggestion.toPath);
    migrationPrompt = `mkdir -p "${dirname(toDisplay)}" && mv "${fromDisplay}" "${toDisplay}"`;
  }
  if (!adapter) {
    warning = "Unsupported platform detected: memory capture disabled for this session.";
  } else {
    const event = adapter.normalizeSessionStart(hookInput);
    const result = processPlatformEvent(event);
    if (result.skipped) {
      warning = `Memory capture disabled for this session (${result.reason}).`;
    }
  }
  const output = { continue: true };
  output.hookSpecificOutput = {
    hookEventName: "SessionStart",
    additionalContext: buildContextLines(
      projectName,
      relative(projectDir, pathPolicy.memoryPath) || basename(pathPolicy.memoryPath),
      memoryExists,
      fileSizeKB,
      platform,
      warning,
      migrationPrompt
    ).join("\n")
  };
  return output;
}
async function runSessionStartHook() {
  try {
    const input = await readStdin();
    const hookInput = JSON.parse(input);
    debug(`Session starting: ${hookInput.session_id}`);
    writeOutput(buildSessionStartOutput(hookInput));
  } catch (error) {
    debug(`Error: ${error}`);
    writeOutput({ continue: true });
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  void runSessionStartHook();
}

export { buildSessionStartOutput, runSessionStartHook };
//# sourceMappingURL=session-start.js.map
//# sourceMappingURL=session-start.js.map