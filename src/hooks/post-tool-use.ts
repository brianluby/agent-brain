#!/usr/bin/env node
/**
 * Memvid Mind - Post Tool Use Hook
 *
 * Captures observations after each tool execution through
 * platform adapters and a shared fail-open pipeline.
 */

import { getMind } from "../core/mind.js";
import {
  readStdin,
  writeOutput,
  debug,
  classifyObservationType,
} from "../utils/helpers.js";
import {
  compressToolOutput,
  getCompressionStats,
} from "../utils/compression.js";
import type { HookInput } from "../types.js";
import {
  detectPlatform,
  getDefaultAdapterRegistry,
  processPlatformEvent,
} from "../platforms/index.js";
import { fileURLToPath } from "node:url";

const OBSERVED_TOOLS = new Set([
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
  "NotebookEdit",
]);

const MIN_OUTPUT_LENGTH = 50;
const DEDUP_WINDOW_MS = 60000;
const ALWAYS_CAPTURE_TOOLS = new Set(["Edit", "Write", "Update", "NotebookEdit"]);
const MAX_OUTPUT_LENGTH = 2500;

const recentObservations = new Map<string, number>();

function getObservationKey(toolName: string, toolInput: Record<string, unknown> | undefined): string {
  const inputStr = toolInput ? JSON.stringify(toolInput).slice(0, 200) : "";
  return `${toolName}:${inputStr}`;
}

function isDuplicate(key: string): boolean {
  const lastSeen = recentObservations.get(key);
  if (!lastSeen) return false;
  return Date.now() - lastSeen < DEDUP_WINDOW_MS;
}

function markObserved(key: string): void {
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

function generateSummary(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
  toolOutput: string
): string {
  switch (toolName) {
    case "Read": {
      const path = (toolInput?.file_path as string | undefined) ||
        (toolInput?.filePath as string | undefined);
      const fileName = path?.split("/").pop() || "file";
      const lines = toolOutput.split("\n").length;
      return `Read ${fileName} (${lines} lines)`;
    }
    case "Edit":
    case "Update": {
      const path = (toolInput?.file_path as string | undefined) ||
        (toolInput?.filePath as string | undefined);
      const fileName = path?.split("/").pop() || "file";
      return `Edited ${fileName}`;
    }
    case "Write": {
      const path = (toolInput?.file_path as string | undefined) ||
        (toolInput?.filePath as string | undefined);
      const fileName = path?.split("/").pop() || "file";
      return `Created ${fileName}`;
    }
    case "Bash": {
      const cmd = toolInput?.command as string | undefined;
      const shortCmd = cmd?.split("\n")[0].slice(0, 50) || "command";
      const hasError = toolOutput.toLowerCase().includes("error") || toolOutput.toLowerCase().includes("failed");
      return hasError ? `Command failed: ${shortCmd}` : `Ran: ${shortCmd}`;
    }
    case "Grep": {
      const pattern = toolInput?.pattern as string | undefined;
      const matches = toolOutput.split("\n").filter(Boolean).length;
      return `Found ${matches} matches for "${pattern?.slice(0, 30)}"`;
    }
    case "Glob": {
      const pattern = toolInput?.pattern as string | undefined;
      const matches = toolOutput.split("\n").filter(Boolean).length;
      return `Found ${matches} files matching "${pattern?.slice(0, 30)}"`;
    }
    case "WebFetch":
    case "WebSearch": {
      const url = (toolInput?.url as string | undefined) || (toolInput?.query as string | undefined);
      return `Fetched: ${url?.slice(0, 50)}`;
    }
    default:
      return `${toolName} completed`;
  }
}

function extractMetadata(
  toolName: string,
  toolInput: Record<string, unknown> | undefined,
  platform: string,
  projectIdentityKey: string
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    platform,
    projectIdentityKey,
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
        metadata.command = (toolInput.command as string).slice(0, 200);
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

export async function runPostToolUseHook(): Promise<void> {
  try {
    const input = await readStdin();
    const hookInput: HookInput = JSON.parse(input);

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

    const rawOutput = typeof toolResponse === "string"
      ? toolResponse
      : JSON.stringify(toolResponse, null, 2);

    const alwaysCapture = ALWAYS_CAPTURE_TOOLS.has(toolName);
    if (!alwaysCapture && (!rawOutput || rawOutput.length < MIN_OUTPUT_LENGTH)) {
      writeOutput({ continue: true });
      return;
    }

    let effectiveOutput = rawOutput || "";
    if (alwaysCapture && effectiveOutput.length < MIN_OUTPUT_LENGTH) {
      const filePath =
        (toolInput?.file_path as string | undefined) ||
        (toolInput?.filePath as string | undefined) ||
        "unknown file";
      const fileName = filePath.split("/").pop() || "file";
      effectiveOutput = `File modified: ${fileName}\nPath: ${filePath}\nTool: ${toolName}`;
    }

    if (
      effectiveOutput.includes("<system-reminder>") ||
      effectiveOutput.includes("<memvid-mind-context>")
    ) {
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
    const content = compressed.length > MAX_OUTPUT_LENGTH
      ? `${compressed.slice(0, MAX_OUTPUT_LENGTH)}\n... (truncated${wasCompressed ? ', compressed' : ''})`
      : compressed;

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
      metadata,
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
