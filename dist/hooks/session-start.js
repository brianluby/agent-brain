#!/usr/bin/env node
import { randomBytes } from 'crypto';
import { existsSync, statSync } from 'fs';
import { basename, resolve } from 'path';
import { fileURLToPath } from 'url';

function generateId() {
  return randomBytes(8).toString("hex");
}
async function readStdin() {
  const chunks = [];
  return new Promise((resolve3, reject) => {
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve3(Buffer.concat(chunks).toString("utf8")));
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

// src/hooks/session-start.ts
function buildContextLines(projectName, memoryDisplayPath, memoryExists, fileSizeKB, platform, warning) {
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
    legacyRelativePath: ".claude/mind.mv2",
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
      pathPolicy.memoryPath.replace(`${projectDir}/`, ""),
      memoryExists,
      fileSizeKB,
      platform,
      warning
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