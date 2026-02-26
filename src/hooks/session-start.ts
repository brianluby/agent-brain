#!/usr/bin/env node
/**
 * Memvid Mind - Session Start Hook
 *
 * Lightweight startup path that performs adapter validation,
 * fail-open checks, and context injection without loading the SDK.
 */

import { readStdin, writeOutput, debug } from "../utils/helpers.js";
import type { HookInput } from "../types.js";
import { existsSync, statSync } from "node:fs";
import { basename, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  detectPlatform,
  getDefaultAdapterRegistry,
  processPlatformEvent,
  resolveMemoryPathPolicy,
} from "../platforms/index.js";

function buildContextLines(
  projectName: string,
  memoryDisplayPath: string,
  memoryExists: boolean,
  fileSizeKB: number,
  platform: string,
  warning?: string,
  migrationPrompt?: string
): string[] {
  const contextLines: string[] = [];
  contextLines.push("<memvid-mind-context>");
  const displayName = platform === "claude" ? "Claude" : platform.charAt(0).toUpperCase() + platform.slice(1);
  contextLines.push(memoryExists ? `# 🧠 ${displayName} Mind Active` : `# 🧠 ${displayName} Mind Ready`);
  contextLines.push("");
  contextLines.push(`📁 Project: **${projectName}**`);
  contextLines.push(`🤖 Platform: **${platform}**`);

  if (memoryExists) {
    contextLines.push(`💾 Memory: \`${memoryDisplayPath}\` (${fileSizeKB} KB)`);
  } else {
    contextLines.push(`💾 Memory will be created at: \`${memoryDisplayPath}\``);
  }

  if (warning) {
    contextLines.push("");
    contextLines.push(`⚠️ ${warning}`);
  }

  if (migrationPrompt) {
    contextLines.push("");
    contextLines.push("❓ Legacy memory detected.");
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

export function buildSessionStartOutput(hookInput: HookInput): Record<string, unknown> {
  const projectDir = hookInput.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
  const projectName = basename(projectDir);
  const platform = detectPlatform(hookInput);
  const pathPolicy = resolveMemoryPathPolicy({
    projectDir,
    platform,
    defaultRelativePath: ".agent-brain/mind.mv2",
    legacyRelativePaths: [".claude/mind.mv2"],
    platformRelativePath: process.env.MEMVID_PLATFORM_MEMORY_PATH,
    platformOptIn: process.env.MEMVID_PLATFORM_PATH_OPT_IN === "1",
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

  let warning: string | undefined;
  let migrationPrompt: string | undefined;

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

  const output: Record<string, unknown> = { continue: true };
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
      ).join("\n"),
  };

  return output;
}

export async function runSessionStartHook(): Promise<void> {
  try {
    const input = await readStdin();
    const hookInput: HookInput = JSON.parse(input);
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
