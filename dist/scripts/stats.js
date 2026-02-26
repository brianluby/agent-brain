#!/usr/bin/env node
import { existsSync, statSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { relative, basename, dirname, resolve, isAbsolute, sep } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

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

// src/scripts/utils.ts
async function createFreshMemory(memoryPath, create) {
  const memoryDir = dirname(memoryPath);
  mkdirSync(memoryDir, { recursive: true });
  await create(memoryPath, "basic");
}
function isCorruptedMemoryError(error) {
  const errorMessage = error instanceof Error ? error.message : String(error);
  return errorMessage.includes("Deserialization") || errorMessage.includes("UnexpectedVariant") || errorMessage.includes("Invalid") || errorMessage.includes("corrupt") || errorMessage.includes("version mismatch") || errorMessage.includes("validation failed") || errorMessage.includes("unable to recover") || errorMessage.includes("table of contents");
}
async function handleCorruptedMemory(memoryPath, create) {
  console.log(
    "\u26A0\uFE0F  Memory file is corrupted or incompatible. Creating fresh memory..."
  );
  const backupPath = `${memoryPath}.backup-${Date.now()}`;
  try {
    renameSync(memoryPath, backupPath);
    console.log(`   Old file backed up to: ${backupPath}`);
  } catch {
    try {
      unlinkSync(memoryPath);
    } catch {
    }
  }
  await createFreshMemory(memoryPath, create);
}
async function openMemorySafely(memoryPath, use, create) {
  if (!existsSync(memoryPath)) {
    console.log("No memory file found. Creating new memory at:", memoryPath);
    await createFreshMemory(memoryPath, create);
    return { memvid: null, isNew: true };
  }
  try {
    const memvid = await use("basic", memoryPath);
    return { memvid, isNew: false };
  } catch (openError) {
    if (isCorruptedMemoryError(openError)) {
      await handleCorruptedMemory(memoryPath, create);
      return { memvid: null, isNew: true };
    }
    throw openError;
  }
}
function resolveScriptMemoryPath(projectDir) {
  const pathPolicy = resolveMemoryPathPolicy({
    projectDir,
    platform: detectPlatformFromEnv(),
    defaultRelativePath: ".agent-brain/mind.mv2",
    legacyRelativePaths: [".claude/mind.mv2"],
    platformRelativePath: process.env.MEMVID_PLATFORM_MEMORY_PATH,
    platformOptIn: process.env.MEMVID_PLATFORM_PATH_OPT_IN === "1"
  });
  if (!pathPolicy.migrationSuggestion) {
    return { memoryPath: pathPolicy.memoryPath };
  }
  const fromDisplay = relative(projectDir, pathPolicy.migrationSuggestion.fromPath) || basename(pathPolicy.migrationSuggestion.fromPath);
  const toDisplay = relative(projectDir, pathPolicy.migrationSuggestion.toPath) || basename(pathPolicy.migrationSuggestion.toPath);
  return {
    memoryPath: pathPolicy.memoryPath,
    migrationPrompt: `mkdir -p "${dirname(toDisplay)}" && mv "${fromDisplay}" "${toDisplay}"`
  };
}

// src/scripts/stats.ts
async function ensureDeps() {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const pluginRoot = resolve(__dirname, "../..");
  const sdkPath = resolve(pluginRoot, "node_modules/@memvid/sdk");
  if (!existsSync(sdkPath)) {
    console.log("Installing dependencies...");
    try {
      execSync("npm install --production --no-fund --no-audit", {
        cwd: pluginRoot,
        stdio: "inherit",
        timeout: 12e4
      });
    } catch {
      console.error("Failed to install dependencies. Please run: npm install");
      process.exit(1);
    }
  }
}
async function loadSDK() {
  await ensureDeps();
  return await import('@memvid/sdk');
}
function formatBytes(bytes) {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}
async function main() {
  const projectDir = process.env.CLAUDE_PROJECT_DIR || process.env.OPENCODE_PROJECT_DIR || process.cwd();
  const { memoryPath, migrationPrompt } = resolveScriptMemoryPath(projectDir);
  if (migrationPrompt) {
    console.log("Legacy memory detected at .claude/mind.mv2.");
    console.log(`Move it to .agent-brain/mind.mv2? Run: ${migrationPrompt}
`);
  }
  const { use, create } = await loadSDK();
  const { memvid, isNew } = await openMemorySafely(memoryPath, use, create);
  if (isNew) {
    console.log("\u2705 Memory initialized! Stats will appear as you work.\n");
  }
  if (!memvid) {
    const newMemvid = await use("basic", memoryPath);
    await showStats(newMemvid, memoryPath);
    return;
  }
  await showStats(memvid, memoryPath);
}
async function showStats(memvid, memoryPath) {
  try {
    const stats = await memvid.stats();
    const fileStats = statSync(memoryPath);
    console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
    console.log("        MEMVID MIND STATISTICS         ");
    console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n");
    console.log(`\u{1F4C1} Memory File: ${memoryPath}`);
    console.log(`\u{1F4CA} Total Frames: ${stats.frame_count || 0}`);
    console.log(`\u{1F4BE} File Size: ${formatBytes(fileStats.size)}`);
    if (stats.capacity_bytes && typeof stats.capacity_bytes === "number") {
      const usagePercent = (fileStats.size / stats.capacity_bytes * 100).toFixed(1);
      console.log(`\u{1F4C8} Capacity Used: ${usagePercent}%`);
    }
    try {
      const timeline = await memvid.timeline({ limit: 1, reverse: true });
      const frames = Array.isArray(timeline) ? timeline : timeline.frames || [];
      if (frames.length > 0) {
        const latest = frames[0];
        const latestDate = latest.timestamp ? new Date(latest.timestamp * 1e3).toLocaleString() : "Unknown";
        console.log(`\u{1F550} Latest Memory: ${latestDate}`);
      }
    } catch {
    }
    console.log("\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  } catch (error) {
    console.error("Error getting stats:", error);
    process.exit(1);
  }
}
main();
//# sourceMappingURL=stats.js.map
//# sourceMappingURL=stats.js.map